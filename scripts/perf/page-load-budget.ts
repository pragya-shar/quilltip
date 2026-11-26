// Page-load budget check for a local production build. It needs no secrets:
// a small stand-in answers the public Convex queries from synthetic fixtures.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run perf:budget
//
// For each route and device it loads the page cold, three times, in Chromium
// with Lighthouse's mobile network and CPU throttling (Slow 4G, 4x CPU), and
// fails when the median breaks a budget in BUDGETS below. See
// docs/performance/page-load.md for the method and the recorded results.

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
 * Budgets per device. LCP and CLS are the page-load targets. Script and font
 * budgets cap the compressed bytes of the initial load, which slow phones
 * wait on; they fail on a new heavy import before LCP visibly drifts.
 */
const BUDGETS: Record<
  DeviceName,
  { lcpMs: number; cls: number; scriptKb: number; fontKb: number }
> = {
  mobile: { lcpMs: 2000, cls: 0.1, scriptKb: 280, fontKb: 180 },
  desktop: { lcpMs: 1000, cls: 0.1, scriptKb: 280, fontKb: 180 },
}

type Run = {
  lcpMs: number
  cls: number
  scriptKb: number
  fontKb: number
  lcpElement: string
  lcpInServerHtml: boolean
  /** Scripts counted in scriptKb, largest first, for failure reports. */
  scripts: string[]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
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
  device: DeviceName
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
    const response = await page.goto(BASE_URL + route.path, {
      waitUntil: 'load',
      timeout: 120_000,
    })
    const html = (await response?.text()) ?? ''
    // Let late work (editor swap, lazy chunks, fonts) settle so shifts count.
    await page.waitForTimeout(device === 'mobile' ? 5000 : 2500)
    const result = await page.evaluate(() => {
      const state = window as unknown as {
        __perf: { lcp: number; cls: number; element: string; text: string }
      }
      const resources = performance.getEntriesByType(
        'resource'
      ) as PerformanceResourceTiming[]
      // Bytes of the initial load (everything that delays the load event).
      const navigation = performance.getEntriesByType(
        'navigation'
      )[0] as PerformanceNavigationTiming
      const before = resources.filter(
        (entry) => entry.responseEnd <= navigation.loadEventStart
      )
      const kb = (type: RegExp) =>
        before
          .filter((entry) => type.test(entry.name))
          .reduce((sum, entry) => sum + entry.encodedBodySize, 0) / 1024
      return {
        ...state.__perf,
        scriptKb: kb(/\.js(\?|$)/),
        fontKb: kb(/\.woff2?(\?|$)/),
        scripts: before
          .filter((entry) => /\.js(\?|$)/.test(entry.name))
          .sort((a, b) => b.encodedBodySize - a.encodedBodySize)
          .map(
            (entry) =>
              `${Math.round(entry.encodedBodySize / 1024)} KB ${new URL(entry.name).pathname} (${entry.initiatorType}, ${Math.round(entry.startTime)}-${Math.round(entry.responseEnd)} ms, load ${Math.round(navigation.loadEventStart)} ms)`
          ),
      }
    })
    const needle = result.text.replace(/&/g, '&amp;').slice(0, 30)
    return {
      lcpMs: Math.round(result.lcp),
      cls: Number(result.cls.toFixed(3)),
      scriptKb: Math.round(result.scriptKb),
      fontKb: Math.round(result.fontKb),
      lcpElement: `${result.element} "${result.text.slice(0, 40)}"`,
      lcpInServerHtml: needle.length > 0 && html.includes(needle),
      scripts: result.scripts,
    }
  } finally {
    await context.close()
  }
}

async function main() {
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startApp()
  const browser = await chromium.launch()
  const failures: string[] = []
  const report: Record<string, unknown>[] = []
  try {
    for (const route of ROUTES) {
      for (const device of ['mobile', 'desktop'] as const) {
        const runs: Run[] = []
        for (let index = 0; index < RUNS; index++) {
          runs.push(await measure(browser, route, device))
        }
        const budget = BUDGETS[device]
        const summary = {
          route: route.path,
          device,
          lcpMs: median(runs.map((run) => run.lcpMs)),
          cls: median(runs.map((run) => run.cls)),
          scriptKb: median(runs.map((run) => run.scriptKb)),
          fontKb: median(runs.map((run) => run.fontKb)),
          lcpElement: runs[0]?.lcpElement ?? '',
          lcpInServerHtml: runs.every((run) => run.lcpInServerHtml),
        }
        report.push(summary)
        const label = `${route.name} (${device})`
        if (summary.lcpMs > budget.lcpMs)
          failures.push(`${label}: LCP ${summary.lcpMs} ms > ${budget.lcpMs}`)
        if (summary.cls > budget.cls)
          failures.push(`${label}: CLS ${summary.cls} > ${budget.cls}`)
        if (summary.scriptKb > budget.scriptKb) {
          const heaviest = [...runs].sort((a, b) => b.scriptKb - a.scriptKb)[0]
          failures.push(
            `${label}: ${summary.scriptKb} KB initial script > ${budget.scriptKb}\n    ${heaviest?.scripts.slice(0, 12).join('\n    ')}`
          )
        }
        if (summary.fontKb > budget.fontKb)
          failures.push(
            `${label}: ${summary.fontKb} KB initial fonts > ${budget.fontKb}`
          )
        if (!summary.lcpInServerHtml)
          failures.push(
            `${label}: LCP element ${summary.lcpElement} is not in the server HTML`
          )
        console.log(
          `${label.padEnd(20)} LCP ${String(summary.lcpMs).padStart(5)} ms  CLS ${summary.cls.toFixed(3)}  script ${summary.scriptKb} KB  fonts ${summary.fontKb} KB  ${summary.lcpElement}`
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
  await writeFile(OUTPUT, JSON.stringify({ runs: RUNS, report }, null, 2))
  if (failures.length > 0) {
    console.error(`\nPage-load budget failed:\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }
  console.log('\nPage-load budget passed.')
  // Open sync sockets would keep the process alive.
  process.exit(0)
}

await main()
