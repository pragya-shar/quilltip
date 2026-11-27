import {
  chromium,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

// Measures page load for the landing page, an article, a profile and
// (optionally) the signed-in dashboard, on desktop and throttled mobile.
// Every run uses a fresh browser context, so each load starts with a cold cache.

const TARGET_MS = 2_000
const DEFAULT_BASE_URL =
  process.env.BASE_URL ??
  process.env.PLAYWRIGHT_BASE_URL ??
  'https://www.quilltip.me'
const DEFAULT_OUTPUT_PATH = 'docs/performance/page-load-live.md'
const DEFAULT_RUNS = 3

const RESERVED_TOP_LEVEL_ROUTES = new Set([
  'api',
  'articles',
  'contact',
  'dashboard',
  'demo',
  'drafts',
  'guide',
  'library',
  'login',
  'privacy',
  'profile',
  'register',
  'settings',
  'status',
  'support',
  'terms',
  'wallet',
  'write',
])

type Throttle = {
  latencyMs: number
  downloadKbps: number
  uploadKbps: number
  cpuSlowdown: number
}

type DeviceProfile = {
  id: 'desktop' | 'mobile'
  device: string
  network: string
  context: BrowserContextOptions
  throttle?: Throttle
}

// Mobile matches Lighthouse's default mobile run: Slow 4G and 4x CPU slowdown.
export const DEVICE_PROFILES: DeviceProfile[] = [
  {
    id: 'desktop',
    device: 'Desktop Chromium, 1280x900 viewport',
    network: 'Unthrottled connection from the measuring machine',
    context: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
  },
  {
    id: 'mobile',
    device: 'Mobile emulation, 375x812 viewport, 2x DPR, touch',
    network:
      'Slow 4G (150 ms RTT, 1.6 Mbps down, 750 kbps up), 4x CPU slowdown',
    context: {
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
    throttle: {
      latencyMs: 150,
      downloadKbps: 1_600,
      uploadKbps: 750,
      cpuSlowdown: 4,
    },
  },
]

export type RunTiming = {
  status: number | null
  finalPath: string
  domContentLoadedMs: number
  loadEventMs: number
  firstContentfulPaintMs: number | null
  largestContentfulPaintMs: number | null
  contentReadyMs: number | null
  readyMs: number
  transferSize: number
}

export type PageLoadMeasurement = {
  name: string
  path: string
  profile: DeviceProfile['id']
  runs: RunTiming[]
  consoleErrors: string[]
  failedRequests: string[]
}

type MeasurementTarget = {
  name: string
  path: string
  signedIn?: boolean
  // Rendered only once client data loads; LCP alone can settle on a skeleton.
  contentSelector?: string
}

type CliOptions = {
  baseUrl: string
  outputPath: string
  runs: number
  articlePath?: string
  profilePath?: string
  authStatePath?: string
  commit?: string
  login: boolean
  help: boolean
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

function medianOf(
  runs: RunTiming[],
  pick: (run: RunTiming) => number | null
): number | null {
  const values = runs
    .map(pick)
    .filter((value): value is number => value !== null)
  return values.length ? median(values) : null
}

// A page meets the goal when its load event, largest contentful paint and
// (where measured) content-ready time all finish within 2 s, as medians of
// the runs. The load event alone misses content rendered after hydration.
export function summarizeMeasurement(measurement: PageLoadMeasurement) {
  const timings: [string, number | null][] = [
    ['load event', medianOf(measurement.runs, (run) => run.loadEventMs)],
    ['LCP', medianOf(measurement.runs, (run) => run.largestContentfulPaintMs)],
    ['content ready', medianOf(measurement.runs, (run) => run.contentReadyMs)],
  ]
  const [slowestName, slowest] = timings.reduce((a, b) =>
    (b[1] ?? 0) > (a[1] ?? 0) ? b : a
  )
  const slowestMs = slowest ?? 0
  const problems: string[] = []
  if (slowestMs > TARGET_MS) {
    problems.push(
      `median ${slowestName} ${slowestMs} ms is above ${TARGET_MS} ms`
    )
  }
  const statuses = measurement.runs
    .map((run) => run.status)
    .filter((status): status is number => status !== null && status >= 400)
  if (statuses.length) problems.push(`HTTP ${statuses[0]} on navigation`)
  return { targetMet: problems.length === 0, slowestMs, problems }
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

const formatMs = (value: number | null) => (value === null ? 'n/a' : `${value}`)

function formatIssueList(items: string[]): string {
  if (items.length === 0) return '  - None'
  return items.map((item) => `  - ${item}`).join('\n')
}

export function buildPerformanceReportMarkdown(report: {
  capturedAt: string
  commit: string
  baseUrl: string
  runs: number
  tool: string
  profiles: DeviceProfile[]
  measurements: PageLoadMeasurement[]
  notes: string[]
}): string {
  const lines = [
    '# Page-Load Performance',
    '',
    `- **Captured:** ${report.capturedAt}`,
    `- **Commit:** ${report.commit}`,
    `- **Base URL:** ${report.baseUrl}`,
    `- **Tool:** ${report.tool}`,
    `- **Runs:** ${report.runs} cold loads per page and device; tables show the median`,
    `- **Goal:** median load event, largest contentful paint (LCP) and, where measured, content ready all at or under ${TARGET_MS} ms`,
    '- **Content ready:** time until the page can be used: the landing intro has finished, or the dashboard stats have loaded',
    '',
    '## Devices and networks',
    '',
    ...report.profiles.map(
      (profile) => `- **${profile.id}:** ${profile.device}; ${profile.network}`
    ),
    '',
  ]

  for (const profile of report.profiles) {
    lines.push(
      `## ${profile.id === 'desktop' ? 'Desktop' : 'Throttled mobile'}`,
      '',
      '| Page | Path | Load event (ms) | FCP (ms) | LCP (ms) | Content ready (ms) | DOM content loaded (ms) | Network idle (ms) | Goal |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |'
    )
    for (const measurement of report.measurements.filter(
      (m) => m.profile === profile.id
    )) {
      const { targetMet } = summarizeMeasurement(measurement)
      const runs = measurement.runs
      lines.push(
        `| ${measurement.name} | \`${measurement.path}\` | ${formatMs(medianOf(runs, (r) => r.loadEventMs))} | ${formatMs(medianOf(runs, (r) => r.firstContentfulPaintMs))} | ${formatMs(medianOf(runs, (r) => r.largestContentfulPaintMs))} | ${formatMs(medianOf(runs, (r) => r.contentReadyMs))} | ${formatMs(medianOf(runs, (r) => r.domContentLoadedMs))} | ${formatMs(medianOf(runs, (r) => r.readyMs))} | ${targetMet ? 'Pass' : 'Over'} |`
      )
    }
    lines.push('')
  }

  lines.push('## Console and network watch', '')
  for (const measurement of report.measurements) {
    const finalPaths = unique(measurement.runs.map((run) => run.finalPath))
    lines.push(
      `### ${measurement.name} (\`${measurement.path}\`, ${measurement.profile})`,
      '',
      `- HTTP status: ${unique(measurement.runs.map((run) => String(run.status ?? 'n/a'))).join(', ')}`,
      `- Final path: ${finalPaths.map((p) => `\`${p}\``).join(', ')}`,
      `- Document transfer size (median): ${median(measurement.runs.map((run) => run.transferSize))} bytes`,
      '- Console errors:',
      formatIssueList(measurement.consoleErrors),
      '- Failed or >=400 requests:',
      formatIssueList(measurement.failedRequests),
      ''
    )
  }

  if (report.notes.length) {
    lines.push('## Notes', '', ...report.notes.map((note) => `- ${note}`), '')
  }

  const over = report.measurements.filter(
    (measurement) => !summarizeMeasurement(measurement).targetMet
  )
  lines.push('## Result', '')
  if (over.length === 0) {
    lines.push(`Every measured page met the ${TARGET_MS} ms goal in this run.`)
  } else {
    lines.push(`These pages missed the ${TARGET_MS} ms goal in this run:`, '')
    for (const measurement of over) {
      lines.push(
        `- ${measurement.name} (\`${measurement.path}\`, ${measurement.profile}): ${summarizeMeasurement(measurement).problems.join('; ')}`
      )
    }
  }

  return `${lines.join('\n')}\n`
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: DEFAULT_BASE_URL,
    outputPath: DEFAULT_OUTPUT_PATH,
    runs: DEFAULT_RUNS,
    articlePath: process.env.PAGE_LOAD_ARTICLE_PATH,
    profilePath: process.env.PAGE_LOAD_PROFILE_PATH,
    authStatePath: process.env.PAGE_LOAD_AUTH_STATE,
    commit: process.env.PAGE_LOAD_COMMIT,
    login: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--login') {
      options.login = true
    } else if (arg === '--base-url' && next) {
      options.baseUrl = next
      i++
    } else if (arg === '--out' && next) {
      options.outputPath = next
      i++
    } else if (arg === '--runs' && next && Number(next) >= 1) {
      options.runs = Math.floor(Number(next))
      i++
    } else if (arg === '--article-path' && next) {
      options.articlePath = next
      i++
    } else if (arg === '--profile-path' && next) {
      options.profilePath = next
      i++
    } else if (arg === '--commit' && next) {
      options.commit = next
      i++
    } else if (arg === '--auth-state' && next) {
      options.authStatePath = next
      i++
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }

  return options
}

function buildHelpText(): string {
  return [
    'Usage: bun scripts/page-load-performance.ts [options]',
    '',
    'Options:',
    `  --base-url <url>       Site to measure. Default: ${DEFAULT_BASE_URL}`,
    `  --out <path>           Markdown report path. Default: ${DEFAULT_OUTPUT_PATH}`,
    `  --runs <n>             Cold loads per page and device. Default: ${DEFAULT_RUNS}`,
    '  --article-path <path>  Article route. Default: first article on /articles',
    "  --profile-path <path>  Profile route. Default: the article's writer",
    '  --commit <sha>         Commit the measured site serves (check the hosting\n' +
      '                         dashboard). Default for remote sites: unknown',
    '  --auth-state <file>    Saved browser session for /dashboard. Keep it outside',
    '                         the repository: it holds sign-in tokens.',
    '  --login                Open a browser window, wait for you to sign in, and',
    '                         save the session to --auth-state, then exit.',
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

async function saveSignedInState(options: CliOptions) {
  if (!options.authStatePath) {
    throw new Error('--login needs --auth-state <file> to save the session.')
  }
  const browser = await chromium.launch({ headless: false })
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    })
    const page = await context.newPage()
    await page.goto(new URL('/login', options.baseUrl).toString())
    console.log('Sign in with a test account in the opened window.')
    await page.waitForURL(
      (url) => !/^\/(login|register)\b/.test(url.pathname),
      { timeout: 10 * 60_000 }
    )
    await page.goto(new URL('/dashboard', options.baseUrl).toString())
    await page.waitForURL((url) => url.pathname.startsWith('/dashboard/'), {
      timeout: 60_000,
    })
    await mkdir(path.dirname(options.authStatePath), { recursive: true })
    await context.storageState({ path: options.authStatePath })
    console.log(`Saved the signed-in session to ${options.authStatePath}`)
  } finally {
    await browser.close()
  }
}

async function discoverArticlePath(
  browser: Browser,
  baseUrl: string
): Promise<string> {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(new URL('/articles', baseUrl).toString(), {
      waitUntil: 'load',
      timeout: 60_000,
    })
    await page
      .locator('.reading-room-card a[href^="/"]')
      .first()
      .waitFor({ timeout: 30_000 })
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
        'Could not find an article on /articles. Pass --article-path /writer/slug.'
      )
    }
    return articlePath
  } finally {
    await context.close()
  }
}

async function applyThrottle(page: Page, throttle?: Throttle) {
  if (!throttle) return
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: throttle.latencyMs,
    downloadThroughput: (throttle.downloadKbps * 1024) / 8,
    uploadThroughput: (throttle.uploadKbps * 1024) / 8,
  })
  await cdp.send('Emulation.setCPUThrottlingRate', {
    rate: throttle.cpuSlowdown,
  })
}

async function measureRun(
  browser: Browser,
  baseUrl: string,
  target: MeasurementTarget,
  profile: DeviceProfile,
  authStatePath: string | undefined,
  consoleErrors: string[],
  failedRequests: string[]
): Promise<RunTiming> {
  const context = await browser.newContext({
    ...profile.context,
    storageState: target.signedIn ? authStatePath : undefined,
  })
  try {
    const page = await context.newPage()
    await page.addInitScript(() => {
      const state = window as unknown as { __lcp?: number }
      new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const last = entries[entries.length - 1]
        if (last) state.__lcp = last.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    })
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('requestfailed', (request) => {
      const error = request.failure()?.errorText ?? 'failed'
      // Next.js cancels link prefetches when the page closes; not a failure.
      if (error.includes('ERR_ABORTED') && request.url().includes('_rsc=')) {
        return
      }
      failedRequests.push(`${request.method()} ${request.url()} ${error}`)
    })
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedRequests.push(`HTTP ${response.status()} ${response.url()}`)
      }
    })
    await applyThrottle(page, profile.throttle)

    const startedAt = Date.now()
    const response = await page.goto(new URL(target.path, baseUrl).toString(), {
      waitUntil: 'load',
      timeout: 120_000,
    })
    let contentReadyMs: number | null = null
    if (target.contentSelector) {
      await page
        .locator(target.contentSelector)
        .first()
        .waitFor({ state: 'visible', timeout: 60_000 })
      contentReadyMs = Math.round(await page.evaluate(() => performance.now()))
    }
    await page
      .waitForLoadState('networkidle', { timeout: 30_000 })
      .catch(() => {})
    const readyMs = Date.now() - startedAt

    const timing = await page.evaluate(() => {
      const entry = performance.getEntriesByType(
        'navigation'
      )[0] as PerformanceNavigationTiming
      const fcp = performance
        .getEntriesByType('paint')
        .find((paint) => paint.name === 'first-contentful-paint')
      const lcp = (window as unknown as { __lcp?: number }).__lcp
      return {
        domContentLoadedMs: Math.round(
          entry.domContentLoadedEventEnd - entry.startTime
        ),
        loadEventMs: Math.round(entry.loadEventEnd - entry.startTime),
        firstContentfulPaintMs: fcp ? Math.round(fcp.startTime) : null,
        largestContentfulPaintMs:
          typeof lcp === 'number' ? Math.round(lcp) : null,
        transferSize: Math.round(entry.transferSize || 0),
      }
    })

    return {
      status: response?.status() ?? null,
      finalPath: new URL(page.url()).pathname,
      readyMs,
      contentReadyMs,
      ...timing,
    }
  } finally {
    await context.close()
  }
}

async function run(options: CliOptions): Promise<void> {
  if (options.authStatePath && !existsSync(options.authStatePath)) {
    throw new Error(
      `No saved session at ${options.authStatePath}. Create it with --login.`
    )
  }
  const signedIn = Boolean(options.authStatePath)
  const browser = await chromium.launch()

  try {
    const articlePath =
      options.articlePath ??
      (await discoverArticlePath(browser, options.baseUrl))
    const profilePath =
      options.profilePath ?? pickProfilePathFromArticlePath(articlePath)
    if (!profilePath) {
      throw new Error('Could not derive a profile route. Pass --profile-path.')
    }

    const targets: MeasurementTarget[] = [
      // First visits play a skippable intro; the page stays inert until it ends.
      {
        name: 'landing',
        path: '/',
        contentSelector: '[data-opening-ready="true"]',
      },
      { name: 'article', path: articlePath },
      { name: 'profile', path: profilePath },
    ]
    if (signedIn) {
      targets.push({
        name: 'dashboard',
        path: '/dashboard',
        signedIn: true,
        contentSelector: '.account-stats h1',
      })
    }

    const measurements: PageLoadMeasurement[] = []
    for (const profile of DEVICE_PROFILES) {
      for (const target of targets) {
        const consoleErrors: string[] = []
        const failedRequests: string[] = []
        const runs: RunTiming[] = []
        for (let i = 0; i < options.runs; i++) {
          runs.push(
            await measureRun(
              browser,
              options.baseUrl,
              target,
              profile,
              options.authStatePath,
              consoleErrors,
              failedRequests
            )
          )
        }
        const measurement: PageLoadMeasurement = {
          name: target.name,
          path: target.path,
          profile: profile.id,
          runs,
          consoleErrors: unique(consoleErrors),
          failedRequests: unique(failedRequests),
        }
        measurements.push(measurement)
        const summary = summarizeMeasurement(measurement)
        console.log(
          `${profile.id} ${target.path}: ${summary.slowestMs} ms ${summary.targetMet ? 'pass' : 'over'}`
        )
      }
    }

    const dashboard = measurements.find((m) => m.name === 'dashboard')
    if (dashboard?.runs.some((r) => !r.finalPath.startsWith('/dashboard'))) {
      throw new Error(
        'The dashboard run was not signed in. Refresh the session with --login.'
      )
    }

    const notes = signedIn
      ? [
          '`/dashboard` redirects in the browser to `/dashboard/stats`; its timings cover that redirect, and LCP covers the stats content.',
        ]
      : [
          'The signed-in dashboard was not measured: no saved session was given (`--auth-state`).',
        ]

    const report = buildPerformanceReportMarkdown({
      capturedAt: new Date().toISOString(),
      commit: measuredCommit(options.baseUrl, options.commit),
      baseUrl: options.baseUrl,
      runs: options.runs,
      tool: `Playwright ${chromium.name()} (headless) with Navigation Timing, Paint Timing and LCP APIs`,
      profiles: DEVICE_PROFILES,
      measurements,
      notes,
    })

    await mkdir(path.dirname(options.outputPath), { recursive: true })
    await writeFile(options.outputPath, report, 'utf8')
    console.log(`Wrote ${options.outputPath}`)
  } finally {
    await browser.close()
  }
}

// A remote site may serve any build, so only a commit passed in is recorded.
function measuredCommit(baseUrl: string, commit?: string) {
  if (commit) return commit
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl)
  return local
    ? `${readGitValue(['rev-parse', '--short', 'HEAD'], 'unknown')} (local checkout)`
    : 'unknown (pass --commit)'
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2))
  if (options.help) {
    console.log(buildHelpText())
    return
  }
  if (options.login) {
    await saveSignedInState(options)
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
