// Page-load budget check for a local production build. It needs no secrets:
// a small stand-in answers the public Convex queries from synthetic fixtures.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run perf:budget
//
// The gate uses quantities that do not depend on how fast the machine is:
// - the bytes of the scripts and stylesheets the server HTML references,
// - the fonts the rendered page requests,
// - the number of render-blocking stylesheets,
// - whether the LCP element (and an LCP image's URL) is in the server HTML,
// - layout shift (CLS).
// LCP time is measured on every run with Lighthouse's mobile throttling and
// reported, with a warning when the median misses the target, but it does not
// fail the check: on shared CI runners it varies with machine load. See
// docs/performance/page-load.md.

import { chromium, type Browser, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'child_process'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { FIXTURE_ARTICLE_PATH } from './convex-fixture'
import { startFixtureBackend } from './fixture-backend'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.PERF_APP_PORT ?? 3199)
const BASE_URL = process.env.PERF_BASE_URL ?? `http://127.0.0.1:${APP_PORT}`
const RUNS = Number(process.env.PERF_RUNS ?? 3)
const OUTPUT = process.env.PERF_OUTPUT ?? 'perf-budget-results.json'

const ROUTES = [
  { name: 'landing', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'articles', path: '/articles' },
  { name: 'article', path: FIXTURE_ARTICLE_PATH },
] as const

type DeviceName = 'mobile' | 'desktop'

/** Lighthouse's default mobile profile (Moto G Power) and desktop preset. */
const DEVICES: Record<
  DeviceName,
  {
    viewport: { width: number; height: number }
    deviceScaleFactor: number
    isMobile: boolean
    hasTouch: boolean
    throttle?: {
      latencyMs: number
      downloadKbps: number
      uploadKbps: number
      cpu: number
    }
  }
> = {
  mobile: {
    viewport: { width: 412, height: 823 },
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
    throttle: { latencyMs: 150, downloadKbps: 1638, uploadKbps: 750, cpu: 4 },
  },
  desktop: {
    viewport: { width: 1350, height: 940 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
}

/**
 * Gated budgets. Byte budgets are compressed sizes as served by `next start`.
 * `scriptKb` and `cssKb` count only files the server HTML references, so a
 * chunk loaded later (after hydration, on idle) never counts, however fast or
 * slow the runner is. `fontKb` counts every font the page requests within the
 * settle window, which depends on layout, not on timing.
 */
const BUDGETS = {
  // Heaviest route: 261 KB (article).
  scriptKb: 280,
  // Heaviest route: 43 KB (landing).
  cssKb: 50,
  // Heaviest route: 181 KB (landing, ten faces).
  fontKb: 220,
  // Heaviest route: 4 (landing).
  renderBlockingStylesheets: 6,
  cls: 0.1,
}

/** LCP targets. Reported, and a warning when a median misses; not gated. */
const LCP_TARGET_MS: Record<DeviceName, number> = {
  mobile: 2000,
  desktop: 1000,
}

type HtmlRefs = {
  scripts: Set<string>
  stylesheets: Set<string>
  html: string
}

type Run = {
  lcpMs: number
  cls: number
  scriptKb: number
  cssKb: number
  fontKb: number
  lateScriptKb: number
  lcpElement: string
  lcpInServerHtml: boolean
  lcpImageInServerHtml: boolean
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
}

/** Scripts and stylesheets referenced by the server HTML, as pathnames. */
async function htmlRefs(routePath: string): Promise<HtmlRefs> {
  const html = await (await fetch(BASE_URL + routePath)).text()
  const scripts = new Set<string>()
  const stylesheets = new Set<string>()
  for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
    const src = attribute(tag, 'src')
    if (src) scripts.add(new URL(src, BASE_URL).pathname)
  }
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    const href = attribute(tag, 'href')
    if (href && /\srel="stylesheet"/.test(tag))
      stylesheets.add(new URL(href, BASE_URL).pathname)
  }
  return { scripts, stylesheets, html }
}

async function startApp(): Promise<ChildProcess | undefined> {
  if (process.env.PERF_BASE_URL) return undefined
  const app = spawn('bunx', ['next', 'start', '-p', String(APP_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  app.stderr?.on('data', (chunk) => process.stderr.write(chunk))
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/login`)
      if (response.ok) return app
    } catch {
      /* Not listening yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  app.kill()
  throw new Error(`The app did not start on ${BASE_URL}`)
}

async function throttle(page: Page, device: DeviceName) {
  const settings = DEVICES[device].throttle
  if (!settings) return
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: settings.latencyMs,
    downloadThroughput: (settings.downloadKbps * 1024) / 8,
    uploadThroughput: (settings.uploadKbps * 1024) / 8,
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: settings.cpu })
}

async function measure(
  browser: Browser,
  route: (typeof ROUTES)[number],
  device: DeviceName,
  refs: HtmlRefs
): Promise<Run> {
  const { throttle: _throttle, ...contextOptions } = DEVICES[device]
  const context = await browser.newContext(contextOptions)
  try {
    const page = await context.newPage()
    await page.addInitScript(() => {
      const state = window as unknown as {
        __perf: { lcp: number; cls: number; element: string; text: string }
      }
      state.__perf = { lcp: 0, cls: 0, element: '', text: '' }
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEntry[] &
          { element?: Element | null; url?: string }[]) {
          state.__perf.lcp = entry.startTime
          const element = entry.element
          state.__perf.element = element
            ? `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).split(' ')[0]}` : ''}`
            : ''
          state.__perf.text =
            element?.tagName === 'IMG'
              ? (element as HTMLImageElement).getAttribute('src') || ''
              : (element?.textContent || '').trim().slice(0, 40)
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number
          hadRecentInput: boolean
        })[]) {
          if (!entry.hadRecentInput) state.__perf.cls += entry.value
        }
      }).observe({ type: 'layout-shift', buffered: true })
    })
    await throttle(page, device)
    await page.goto(BASE_URL + route.path, {
      waitUntil: 'load',
      timeout: 120_000,
    })
    // Let late work (editor swap, lazy chunks, fonts) settle so shifts and
    // font requests count.
    await page.waitForTimeout(device === 'mobile' ? 5000 : 2500)
    const result = await page.evaluate(() => {
      const state = window as unknown as {
        __perf: { lcp: number; cls: number; element: string; text: string }
      }
      // Every request in the settle window, regardless of when it finished.
      const resources = (
        performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      ).map((entry) => ({
        path: new URL(entry.name).pathname,
        bytes: entry.encodedBodySize,
      }))
      return { ...state.__perf, resources }
    })
    const kb = (match: (resourcePath: string) => boolean) => {
      const seen = new Map<string, number>()
      for (const resource of result.resources)
        if (match(resource.path))
          seen.set(
            resource.path,
            Math.max(seen.get(resource.path) ?? 0, resource.bytes)
          )
      return [...seen.values()].reduce((sum, bytes) => sum + bytes, 0) / 1024
    }
    const isScript = (resourcePath: string) => /\.js$/.test(resourcePath)
    const needle = result.text.replace(/&/g, '&amp;').slice(0, 30)
    const isImage = result.element.startsWith('img')
    return {
      lcpMs: Math.round(result.lcp),
      cls: Number(result.cls.toFixed(3)),
      scriptKb: Math.round(kb((p) => refs.scripts.has(p))),
      cssKb: Math.round(kb((p) => refs.stylesheets.has(p))),
      fontKb: Math.round(kb((p) => /\.woff2?$/.test(p))),
      lateScriptKb: Math.round(kb((p) => isScript(p) && !refs.scripts.has(p))),
      lcpElement: `${result.element} "${result.text.slice(0, 40)}"`,
      lcpInServerHtml: needle.length > 0 && refs.html.includes(needle),
      // An LCP image is discoverable when the server HTML carries its URL.
      lcpImageInServerHtml: !isImage || refs.html.includes(needle),
    }
  } finally {
    await context.close()
  }
}

function warn(message: string) {
  // GitHub Actions shows ::warning:: lines as annotations on the run.
  console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message)
}

async function main() {
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startApp()
  const browser = await chromium.launch()
  const failures: string[] = []
  const report: Record<string, unknown>[] = []
  try {
    for (const route of ROUTES) {
      const refs = await htmlRefs(route.path)
      const renderBlocking = refs.stylesheets.size
      if (renderBlocking > BUDGETS.renderBlockingStylesheets)
        failures.push(
          `${route.name}: ${renderBlocking} render-blocking stylesheets > ${BUDGETS.renderBlockingStylesheets}`
        )
      for (const device of ['mobile', 'desktop'] as const) {
        // One unmeasured load warms the server's route and data caches.
        await measure(browser, route, device, refs)
        const runs: Run[] = []
        for (let index = 0; index < RUNS; index++) {
          runs.push(await measure(browser, route, device, refs))
        }
        const lcpValues = runs.map((run) => run.lcpMs)
        const summary = {
          route: route.path,
          device,
          lcpMs: median(lcpValues),
          lcpRangeMs: [Math.min(...lcpValues), Math.max(...lcpValues)],
          cls: median(runs.map((run) => run.cls)),
          scriptKb: median(runs.map((run) => run.scriptKb)),
          cssKb: median(runs.map((run) => run.cssKb)),
          fontKb: median(runs.map((run) => run.fontKb)),
          lateScriptKb: median(runs.map((run) => run.lateScriptKb)),
          renderBlocking,
          lcpElement: runs[0]?.lcpElement ?? '',
          lcpInServerHtml: runs.every((run) => run.lcpInServerHtml),
          lcpImageInServerHtml: runs.every((run) => run.lcpImageInServerHtml),
        }
        report.push(summary)
        const label = `${route.name} (${device})`
        if (summary.scriptKb > BUDGETS.scriptKb)
          failures.push(
            `${label}: ${summary.scriptKb} KB of scripts in the server HTML > ${BUDGETS.scriptKb}`
          )
        if (summary.cssKb > BUDGETS.cssKb)
          failures.push(
            `${label}: ${summary.cssKb} KB of stylesheets > ${BUDGETS.cssKb}`
          )
        if (summary.fontKb > BUDGETS.fontKb)
          failures.push(
            `${label}: ${summary.fontKb} KB of fonts > ${BUDGETS.fontKb}`
          )
        if (summary.cls > BUDGETS.cls)
          failures.push(`${label}: CLS ${summary.cls} > ${BUDGETS.cls}`)
        if (!summary.lcpInServerHtml)
          failures.push(
            `${label}: LCP element ${summary.lcpElement} is not in the server HTML`
          )
        if (!summary.lcpImageInServerHtml)
          failures.push(
            `${label}: LCP image ${summary.lcpElement} is not discoverable in the server HTML`
          )
        if (summary.lcpMs > LCP_TARGET_MS[device])
          warn(
            `${label}: median LCP ${summary.lcpMs} ms is over the ${LCP_TARGET_MS[device]} ms target (not gated)`
          )
        console.log(
          `${label.padEnd(20)} LCP ${String(summary.lcpMs).padStart(5)} ms (${summary.lcpRangeMs.join('-')})  CLS ${summary.cls.toFixed(3)}  script ${summary.scriptKb} KB  css ${summary.cssKb} KB  fonts ${summary.fontKb} KB  late script ${summary.lateScriptKb} KB  blocking ${renderBlocking}  ${summary.lcpElement}`
        )
      }
    }
  } finally {
    await browser.close()
    app?.kill()
    backend.closeAllConnections()
    backend.close()
  }
  await mkdir(path.dirname(path.resolve(OUTPUT)), { recursive: true })
  await writeFile(
    OUTPUT,
    JSON.stringify({ runs: RUNS, budgets: BUDGETS, report }, null, 2)
  )
  if (failures.length > 0) {
    console.error(`\nPage-load budget failed:\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }
  console.log('\nPage-load budget passed.')
  // Open sync sockets would keep the process alive.
  process.exit(0)
}

await main()
