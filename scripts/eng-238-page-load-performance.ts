import { chromium, type Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const ISSUE_ID = 'ENG-238'
const TARGET_LOAD_MS = 2_000
const DEFAULT_BASE_URL =
  process.env.BASE_URL ??
  process.env.PLAYWRIGHT_BASE_URL ??
  'http://127.0.0.1:3100'
const DEFAULT_OUTPUT_PATH = 'docs/eng-238-page-load-performance.md'

const RESERVED_TOP_LEVEL_ROUTES = new Set([
  'api',
  'articles',
  'contact',
  'drafts',
  'guide',
  'login',
  'privacy',
  'profile',
  'register',
  'settings',
  'status',
  'support',
  'terms',
  'write',
])

type EnvironmentDetails = {
  device: string
  network: string
  tool: string
}

export type PageLoadMeasurement = {
  name: string
  path: string
  url: string
  status: number | null
  domContentLoadedMs: number
  loadEventMs: number
  readyMs: number
  transferSize: number
  encodedBodySize: number
  consoleErrors: string[]
  failedRequests: string[]
}

type PerformanceReport = {
  capturedAt: string
  branch: string
  commit: string
  baseUrl: string
  environment: EnvironmentDetails
  measurements: PageLoadMeasurement[]
}

type MeasurementTarget = {
  name: string
  path: string
}

type CliOptions = {
  baseUrl: string
  outputPath: string
  articlePath?: string
  profilePath?: string
  help: boolean
}

export type MeasurementSummary = {
  targetMet: boolean
  targetMetric: 'loadEventMs'
  targetMs: number
  blockingIssues: string[]
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function normalizeInternalPath(href: string): string | null {
  try {
    const url = new URL(href, 'https://quilltip.local')
    if (url.origin !== 'https://quilltip.local') return null
    return url.pathname
  } catch {
    return null
  }
}

function splitPath(pathValue: string): string[] {
  return pathValue.split('/').filter(Boolean)
}

function isArticlePath(pathValue: string): boolean {
  const segments = splitPath(pathValue)
  if (segments.length !== 2) return false

  const [username] = segments
  return Boolean(username && !RESERVED_TOP_LEVEL_ROUTES.has(username))
}

export function pickArticlePathFromLinks(links: string[]): string | null {
  const paths = unique(
    links
      .map((href) => normalizeInternalPath(href))
      .filter((href): href is string => Boolean(href))
  )

  return paths.find(isArticlePath) ?? null
}

export function pickProfilePathFromArticlePath(
  articlePath: string
): string | null {
  if (!isArticlePath(articlePath)) return null

  const [username] = splitPath(articlePath)
  return username ? `/${username}` : null
}

export function summarizeMeasurement(
  measurement: PageLoadMeasurement
): MeasurementSummary {
  const blockingIssues: string[] = []
  const targetMet = measurement.loadEventMs <= TARGET_LOAD_MS

  if (!targetMet) {
    blockingIssues.push(
      `Load event was ${measurement.loadEventMs} ms, above the ${TARGET_LOAD_MS} ms target`
    )
  }

  if (measurement.status !== null && measurement.status >= 400) {
    blockingIssues.push(`Navigation returned HTTP ${measurement.status}`)
  }

  if (measurement.consoleErrors.length > 0) {
    blockingIssues.push(
      `${measurement.consoleErrors.length} console error(s) captured`
    )
  }

  if (measurement.failedRequests.length > 0) {
    blockingIssues.push(
      `${measurement.failedRequests.length} failed or >=400 request(s) captured`
    )
  }

  return {
    targetMet,
    targetMetric: 'loadEventMs',
    targetMs: TARGET_LOAD_MS,
    blockingIssues,
  }
}

function passFail(measurement: PageLoadMeasurement): 'Pass' | 'Fail' {
  return summarizeMeasurement(measurement).targetMet ? 'Pass' : 'Fail'
}

function formatIssueList(items: string[]): string {
  if (items.length === 0) return '  - None'
  return items.map((item) => `  - ${item}`).join('\n')
}

function hasLocalAnalyticsScriptNoise(measurements: PageLoadMeasurement[]) {
  return measurements.some((measurement) =>
    [...measurement.consoleErrors, ...measurement.failedRequests].some((item) =>
      item.includes('/_vercel/insights/script.js')
    )
  )
}

export function buildPerformanceReportMarkdown(
  report: PerformanceReport
): string {
  const lines = [
    '# ENG-238 Page-Load Performance Evidence',
    '',
    `- **Captured:** ${report.capturedAt}`,
    `- **Branch:** ${report.branch}`,
    `- **Commit:** ${report.commit}`,
    `- **Base URL:** ${report.baseUrl}`,
    `- **Device:** ${report.environment.device}`,
    `- **Network:** ${report.environment.network}`,
    `- **Tool:** ${report.environment.tool}`,
    `- **Target:** load event at or under ${TARGET_LOAD_MS} ms`,
    '',
    '## Measurements',
    '',
    '| Page | Path | Load event (ms) | DOM content loaded (ms) | Ready (ms) | Target |',
    '| --- | --- | ---: | ---: | ---: | --- |',
  ]

  for (const measurement of report.measurements) {
    lines.push(
      `| ${measurement.name} | \`${measurement.path}\` | ${measurement.loadEventMs} | ${measurement.domContentLoadedMs} | ${measurement.readyMs} | ${passFail(measurement)} |`
    )
  }

  lines.push('', '## Console And Network Watch', '')

  for (const measurement of report.measurements) {
    lines.push(`### ${measurement.name} (\`${measurement.path}\`)`, '')
    lines.push(`- HTTP status: ${measurement.status ?? 'not available'}`)
    lines.push(`- Transfer size: ${measurement.transferSize} bytes`)
    lines.push(`- Encoded body size: ${measurement.encodedBodySize} bytes`)
    lines.push('- Console errors:')
    lines.push(formatIssueList(measurement.consoleErrors))
    lines.push('- Failed or >=400 requests:')
    lines.push(formatIssueList(measurement.failedRequests))
    lines.push('')
  }

  if (hasLocalAnalyticsScriptNoise(report.measurements)) {
    lines.push('## Local Environment Notes', '')
    lines.push(
      '- `/_vercel/insights/script.js` returned 404 under local `next start`; this is Vercel Analytics infrastructure noise for the local production server, not a page rendering blocker in the measured app routes.'
    )
    lines.push('')
  }

  const failedMeasurements = report.measurements.filter(
    (measurement) => !summarizeMeasurement(measurement).targetMet
  )

  lines.push('## Fix Decision', '')

  if (failedMeasurements.length === 0) {
    lines.push(
      'No measured page missed the under-2-second load-event target in this run, so ENG-238 did not require an avoidable performance fix.'
    )
  } else {
    lines.push(
      'The following page(s) missed the under-2-second load-event target and need targeted follow-up before using the claim:'
    )
    for (const measurement of failedMeasurements) {
      lines.push(
        `- ${measurement.name} (\`${measurement.path}\`): ${summarizeMeasurement(measurement).blockingIssues.join('; ')}`
      )
    }
  }

  return `${lines.join('\n')}\n`
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: DEFAULT_BASE_URL,
    outputPath: DEFAULT_OUTPUT_PATH,
    articlePath: process.env.ENG238_ARTICLE_PATH,
    profilePath: process.env.ENG238_PROFILE_PATH,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--base-url' && next) {
      options.baseUrl = next
      i++
    } else if (arg === '--out' && next) {
      options.outputPath = next
      i++
    } else if (arg === '--article-path' && next) {
      options.articlePath = next
      i++
    } else if (arg === '--profile-path' && next) {
      options.profilePath = next
      i++
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }

  return options
}

function buildHelpText(): string {
  return [
    'Usage: bun scripts/eng-238-page-load-performance.ts [options]',
    '',
    'Options:',
    '  --base-url <url>       Local app URL. Default: http://127.0.0.1:3100',
    '  --out <path>           Markdown report path. Default: docs/eng-238-page-load-performance.md',
    '  --article-path <path>  Article route to measure. Default: auto-discover from /articles',
    '  --profile-path <path>  Profile route to measure. Default: author profile from article path',
    '  --help                 Show this help text',
  ].join('\n')
}

function readGitValue(args: string[], fallback: string): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim() || fallback
  } catch {
    return fallback
  }
}

async function discoverArticlePath(
  page: Page,
  baseUrl: string
): Promise<string> {
  await page.goto(new URL('/articles', baseUrl).toString(), {
    waitUntil: 'load',
    timeout: 60_000,
  })
  await page
    .waitForLoadState('networkidle', { timeout: 15_000 })
    .catch(() => {})

  const links = await page
    .locator('a[href^="/"]')
    .evaluateAll((anchors) =>
      anchors
        .map((anchor) => anchor.getAttribute('href'))
        .filter((href): href is string => Boolean(href))
    )

  const articlePath = pickArticlePathFromLinks(links)
  if (!articlePath) {
    throw new Error(
      'Could not auto-discover an article route from /articles. Pass --article-path /author/slug.'
    )
  }

  return articlePath
}

async function measureTarget(
  page: Page,
  baseUrl: string,
  target: MeasurementTarget
): Promise<PageLoadMeasurement> {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  const url = new URL(target.path, baseUrl).toString()

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })

  page.on('requestfailed', (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'failed'}`
    )
  })

  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`HTTP ${response.status()} ${response.url()}`)
    }
  })

  const startedAt = Date.now()
  const response = await page.goto(url, {
    waitUntil: 'load',
    timeout: 60_000,
  })
  await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 })
  await page
    .waitForLoadState('networkidle', { timeout: 15_000 })
    .catch(() => {})

  const readyMs = Date.now() - startedAt
  const timing = await page.evaluate(() => {
    const entry = performance.getEntriesByType(
      'navigation'
    )[0] as PerformanceNavigationTiming

    return {
      domContentLoadedMs: Math.round(
        entry.domContentLoadedEventEnd - entry.startTime
      ),
      loadEventMs: Math.round(entry.loadEventEnd - entry.startTime),
      transferSize: Math.round(entry.transferSize || 0),
      encodedBodySize: Math.round(entry.encodedBodySize || 0),
    }
  })

  return {
    name: target.name,
    path: target.path,
    url,
    status: response?.status() ?? null,
    ...timing,
    readyMs,
    consoleErrors: unique(consoleErrors),
    failedRequests: unique(failedRequests),
  }
}

async function run(options: CliOptions): Promise<void> {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  })

  try {
    const discoveryPage = await context.newPage()
    const articlePath =
      options.articlePath ??
      (await discoverArticlePath(discoveryPage, options.baseUrl))
    await discoveryPage.close()

    const profilePath =
      options.profilePath ?? pickProfilePathFromArticlePath(articlePath)

    if (!profilePath) {
      throw new Error(
        'Could not derive a profile route. Pass --profile-path /username.'
      )
    }

    const targets: MeasurementTarget[] = [
      { name: 'landing', path: '/' },
      { name: 'article', path: articlePath },
      { name: 'profile/dashboard', path: profilePath },
    ]
    const measurements: PageLoadMeasurement[] = []

    for (const target of targets) {
      const page = await context.newPage()
      try {
        measurements.push(await measureTarget(page, options.baseUrl, target))
      } finally {
        await page.close()
      }
    }

    const report = buildPerformanceReportMarkdown({
      capturedAt: new Date().toISOString(),
      branch: readGitValue(['branch', '--show-current'], 'unknown'),
      commit: readGitValue(['rev-parse', '--short', 'HEAD'], 'unknown'),
      baseUrl: options.baseUrl,
      environment: {
        device: 'Desktop Chromium, 1280x900 viewport',
        network: 'Local loopback, no throttling',
        tool: 'Playwright Chromium + Navigation Timing API',
      },
      measurements,
    })

    await mkdir(path.dirname(options.outputPath), { recursive: true })
    await writeFile(options.outputPath, report, 'utf8')

    console.log(`Wrote ${options.outputPath}`)
    console.log(
      JSON.stringify(
        {
          issue: ISSUE_ID,
          targetMs: TARGET_LOAD_MS,
          measurements: measurements.map((measurement) => ({
            name: measurement.name,
            path: measurement.path,
            loadEventMs: measurement.loadEventMs,
            targetMet: summarizeMeasurement(measurement).targetMet,
            consoleErrors: measurement.consoleErrors.length,
            failedRequests: measurement.failedRequests.length,
          })),
        },
        null,
        2
      )
    )
  } finally {
    await context.close()
    await browser.close()
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2))
  if (options.help) {
    console.log(buildHelpText())
    return
  }

  await run(options)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
const modulePath = fileURLToPath(import.meta.url)

if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
