// Tap-to-visible-result: the time from a tap to the first frame that shows
// its response, on a slow phone profile, in Chromium and WebKit. Measurement
// only; nothing in the app depends on it.
//
//   bun scripts/perf/tap-to-visible.ts --base-url https://127.0.0.1:3443 \
//     --label change --runs 20 --out tap-change.json
//
// Options (all optional except --base-url):
//   --base-url URL       the site to measure (local proxy, preview, ...)
//   --label NAME         a name for this build in the output (default: host)
//   --runs N             runs per case, mode and browser (default 20)
//   --load-runs N        runs of the no-tap load mode (default 5)
//   --browsers LIST      chromium,webkit (default both)
//   --cases LIST         login,articles-menu,article-menu,landing
//   --modes LIST         paint,t1500,load (default all three)
//   --article-path PATH  the article page (default: the perf fixture article)
//   --email ADDRESS      the address typed into the sign-in form. The default
//                        cannot sign in; against a real backend each run is
//                        one refused sign-in, which counts toward its limits.
//   --out FILE           raw results as JSON (default tap-to-visible.json)
//
// WebKit refuses a ws:// Convex connection from an https:// page, so run
// WebKit against the plain-HTTP server (its network is emulated by request
// interception either way) and Chromium against the HTTP/2 proxy:
//   bun scripts/perf/tap-to-visible.ts --browsers chromium \
//     --base-url https://127.0.0.1:3443 --label change --out chromium.json
//   bun scripts/perf/tap-to-visible.ts --browsers webkit \
//     --base-url http://127.0.0.1:3104 --label change --out webkit.json
//
// Cases: a tap on the `/login` submit button (fields filled first), and on
// the mobile menu button of `/articles` and an article page. `landing` has no
// tap (the landing page has no menu button); it adds `/` to the load mode.
//
// Modes:
// - paint: tap as soon as the control is visible, right after first paint.
// - t1500: tap 1.5 s after navigation start (or when the control appears, if
//   later).
// - load: no tap; FCP, LCP, CLS, the first frame that shows the control
//   (in WebKit, a page that streams its loading fallback first shows
//   nothing until the scripts run) and the time React attaches it.
//
// A tap is "lost" when no response is visible within 20 s, or the page
// navigated away (a native form post). The response is the sign-in form's
// busy label or an error or notice, or the menu sheet inside the viewport.
// For sign-in, the number of sign-in messages sent over the Convex
// connection is recorded (one per answered tap is expected).
//
// Device profile, as in docs/performance/page-load.md and the page-load
// reviews: 375 x 812 px touch screen, Slow 4G as Lighthouse applies it
// (562.5 ms latency, 1.33 Mbit/s down, 0.61 Mbit/s up) with 4x CPU slowdown,
// cold cache on every run.
// - Chromium: network and CPU through the DevTools protocol.
// - WebKit has no such protocol in Playwright: the same latency and a shared
//   download rate are applied to every HTTP response by request
//   interception, with compressed sizes estimated by gzip. There is no CPU
//   slowdown in WebKit, so its times are lower bounds.

import {
  chromium,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { writeFile } from 'fs/promises'
import { gzipSync } from 'zlib'
import { FIXTURE_ARTICLE_PATH } from './convex-fixture'

type Mode = 'paint' | 't1500' | 'load'
type BrowserName = 'chromium' | 'webkit'
type CaseId = 'login' | 'articles-menu' | 'article-menu' | 'landing'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')

const BASE_URL = (args.get('base-url') ?? '').replace(/\/$/, '')
if (!BASE_URL) {
  console.error(
    'Usage: bun scripts/perf/tap-to-visible.ts --base-url URL [options]'
  )
  process.exit(2)
}
const LABEL = args.get('label') ?? new URL(BASE_URL).host
const RUNS = Number(args.get('runs') ?? 20)
const LOAD_RUNS = Number(args.get('load-runs') ?? 5)
const BROWSERS = (args.get('browsers') ?? 'chromium,webkit').split(
  ','
) as BrowserName[]
const MODES = (args.get('modes') ?? 'paint,t1500,load').split(',') as Mode[]
const ARTICLE_PATH = args.get('article-path') ?? FIXTURE_ARTICLE_PATH
const EMAIL = args.get('email') ?? 'tap-probe@example.invalid'
const PASSWORD = 'Tap-probe-1234'
const OUT = args.get('out') ?? 'tap-to-visible.json'

const PROFILE = {
  viewport: { width: 375, height: 812 },
  latencyMs: 562.5,
  downloadBytesPerS: ((1.4744 * 1024 * 1024) / 8) * 0.9,
  uploadBytesPerS: ((0.675 * 1024 * 1024) / 8) * 0.9,
  cpuSlowdown: 4,
}
const RESPONSE_TIMEOUT_MS = 20_000

interface Case {
  id: CaseId
  path: string
  /** The control to tap; none for a load-only case. */
  control?: string
  /** Which response counts as visible. */
  response?: 'signin' | 'sheet'
}

const CASES: Case[] = [
  {
    id: 'login',
    path: '/login',
    control: 'form button[type="submit"]',
    response: 'signin',
  },
  {
    id: 'articles-menu',
    path: '/articles',
    control: 'button.app-menu-trigger',
    response: 'sheet',
  },
  {
    id: 'article-menu',
    path: ARTICLE_PATH,
    control: 'button.app-menu-trigger',
    response: 'sheet',
  },
  { id: 'landing', path: '/' },
]
const SELECTED = (args.get('cases') ?? CASES.map((c) => c.id).join(','))
  .split(',')
  .map((id) => {
    const found = CASES.find((c) => c.id === id)
    if (!found) throw new Error(`Unknown case ${id}`)
    return found
  })

/**
 * Runs in the page before its own scripts. Records the tap (pointerdown),
 * the first animation frame that shows the response, paint timings, CLS and
 * when React attaches the control.
 */
function pageProbe({
  control,
  response,
}: {
  control?: string
  response?: string
}) {
  const probe = {
    tapAt: null as number | null,
    shownAt: null as number | null,
    readyAt: null as number | null,
    visibleAt: null as number | null,
    fcp: null as number | null,
    lcp: null as number | null,
    cls: 0,
  }
  ;(window as unknown as { __tap: typeof probe }).__tap = probe
  addEventListener(
    'pointerdown',
    (event) => {
      if (probe.tapAt === null) probe.tapAt = event.timeStamp
    },
    true
  )
  const observe = (type: string, fn: (entry: PerformanceEntry) => void) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({
        type,
        buffered: true,
      })
    } catch {
      /* Not supported in this engine. */
    }
  }
  observe('paint', (entry) => {
    if (entry.name === 'first-contentful-paint') probe.fcp = entry.startTime
  })
  observe('largest-contentful-paint', (entry) => {
    probe.lcp = entry.startTime
  })
  observe('layout-shift', (entry) => {
    const shift = entry as PerformanceEntry & {
      value: number
      hadRecentInput: boolean
    }
    if (!shift.hadRecentInput) probe.cls += shift.value
  })
  const visible = (element: Element | null) => {
    if (!element) return false
    const box = element.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return false
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    return (
      box.left < innerWidth - 1 &&
      box.right > 1 &&
      box.top < innerHeight &&
      box.bottom > 0
    )
  }
  const responseShown = () => {
    if (response === 'sheet')
      return [...document.querySelectorAll('[role="dialog"], dialog')].some(
        visible
      )
    if (response === 'signin') {
      const button = document.querySelector<HTMLElement>(
        'form button[type="submit"]'
      )
      if (button && /One moment/.test(button.innerText)) return true
      return [
        ...document.querySelectorAll('[role="alert"], .account-notice'),
      ].some(visible)
    }
    return false
  }
  const attached = (element: Element | null) =>
    !!element &&
    Object.keys(element).some((key) => key.startsWith('__reactProps'))
  const frame = (now: number) => {
    if (
      control &&
      probe.visibleAt === null &&
      visible(document.querySelector(control))
    )
      probe.visibleAt = now
    if (
      control &&
      probe.readyAt === null &&
      attached(document.querySelector(control))
    )
      probe.readyAt = now
    if (probe.tapAt !== null && probe.shownAt === null && responseShown())
      probe.shownAt = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

type Probe = {
  tapAt: number | null
  shownAt: number | null
  readyAt: number | null
  visibleAt: number | null
  fcp: number | null
  lcp: number | null
  cls: number
}

interface Result {
  label: string
  browser: BrowserName
  case: CaseId
  mode: Mode
  run: number
  lost?: boolean
  tapToVisible?: number | null
  tapAt?: number | null
  readyAt?: number | null
  /** The first frame that shows the control, from navigation start. */
  visibleAt?: number | null
  fcp?: number | null
  lcp?: number | null
  cls?: number
  navigated?: boolean
  signInSent?: number
  stillShown?: boolean
  error?: string
}

/** Same latency and shared download rate for every response (WebKit). */
async function emulateNetwork(context: BrowserContext) {
  let linkFreeAt = 0
  await context.route('**/*', async (route) => {
    const started = Date.now()
    try {
      const response = await route.fetch()
      const body = await response.body()
      const type = response.headers()['content-type'] ?? ''
      const wireBytes = /text|javascript|json|css|svg|xml/.test(type)
        ? gzipSync(body).length
        : body.length
      const firstByte = started + PROFILE.latencyMs
      const start = Math.max(firstByte, linkFreeAt)
      const done = start + (wireBytes / PROFILE.downloadBytesPerS) * 1000
      linkFreeAt = done
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, done - Date.now()))
      )
      await route.fulfill({ response, body })
    } catch {
      await route.abort().catch(() => {})
    }
  })
}

async function newPage(browser: Browser, name: BrowserName, item: Case) {
  const context = await browser.newContext({
    viewport: PROFILE.viewport,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: name === 'chromium',
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()
  if (name === 'chromium') {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: PROFILE.latencyMs,
      downloadThroughput: PROFILE.downloadBytesPerS,
      uploadThroughput: PROFILE.uploadBytesPerS,
    })
    await cdp.send('Emulation.setCPUThrottlingRate', {
      rate: PROFILE.cpuSlowdown,
    })
  } else {
    await emulateNetwork(context)
  }
  await page.addInitScript(pageProbe, {
    control: item.control,
    response: item.response,
  })
  return { context, page }
}

const readProbe = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tap: Probe }).__tap)

async function runOnce(
  browser: Browser,
  name: BrowserName,
  item: Case,
  mode: Mode,
  run: number
): Promise<Result> {
  const base: Result = { label: LABEL, browser: name, case: item.id, mode, run }
  const { context, page } = await newPage(browser, name, item)
  let signInSent = 0
  page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => {
      if (String(frame.payload).includes('"auth:signIn"')) signInSent++
    })
  )
  // Document requests (a native form post, a reload), not the history
  // updates the router makes in the same document.
  let documents = 0
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documents++
  })
  try {
    await page.goto(BASE_URL + item.path, {
      waitUntil: 'commit',
      timeout: 60_000,
    })
    if (mode === 'load' || !item.control) {
      await page.waitForLoadState('load', { timeout: 60_000 })
      await page.waitForTimeout(3000)
      const probe = await readProbe(page)
      return {
        ...base,
        fcp: probe.fcp,
        lcp: probe.lcp,
        cls: probe.cls,
        readyAt: probe.readyAt,
        visibleAt: probe.visibleAt,
      }
    }
    const control = page.locator(item.control).first()
    await control.waitFor({ state: 'visible', timeout: 60_000 })
    if (item.id === 'login') {
      await page.locator('#email').fill(EMAIL)
      await page.locator('#password').fill(PASSWORD)
    }
    if (mode === 't1500') {
      const now = await page.evaluate(() => performance.now())
      if (now < 1500) await page.waitForTimeout(1500 - now)
    }
    const documentsBeforeTap = documents
    await control.tap({ timeout: 10_000 })
    let shown = false
    const deadline = Date.now() + RESPONSE_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (documents > documentsBeforeTap) break
      const probe = await readProbe(page).catch(() => null)
      if (probe?.shownAt != null) {
        shown = true
        break
      }
      await page.waitForTimeout(50)
    }
    const navigated = documents > documentsBeforeTap
    if (navigated || !shown) {
      return {
        ...base,
        lost: true,
        navigated,
        signInSent,
        tapToVisible: null,
        tapAt: (await readProbe(page).catch(() => null))?.tapAt ?? null,
      }
    }
    const probe = await readProbe(page)
    // Wait for the scripts, then check the response is still there (no
    // second toggle) and how many sign-ins were sent.
    await page
      .waitForFunction(
        () => (window as unknown as { __tap: Probe }).__tap.readyAt !== null,
        null,
        {
          timeout: 30_000,
        }
      )
      .catch(() => {})
    await page.waitForTimeout(2500)
    const after = await readProbe(page)
    const stillShown =
      item.response === 'sheet'
        ? await page
            .locator('[role="dialog"], dialog')
            .evaluateAll((elements) =>
              elements.some((e) => e.getClientRects().length > 0)
            )
        : undefined
    return {
      ...base,
      lost: false,
      navigated: documents > documentsBeforeTap,
      tapAt: probe.tapAt,
      tapToVisible:
        probe.tapAt != null && probe.shownAt != null
          ? Math.max(0, probe.shownAt - probe.tapAt)
          : null,
      readyAt: after.readyAt,
      visibleAt: probe.visibleAt,
      fcp: probe.fcp,
      signInSent: item.id === 'login' ? signInSent : undefined,
      stillShown,
    }
  } catch (error) {
    return { ...base, error: String(error).slice(0, 200) }
  } finally {
    await context.close()
  }
}

const median = (values: number[]) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}
const fmt = (value: number | null, digits = 0) =>
  value === null ? 'n/a' : value.toFixed(digits)

async function main() {
  const results: Result[] = []
  for (const name of BROWSERS) {
    const browser = await (name === 'chromium' ? chromium : webkit).launch({
      args: name === 'chromium' ? ['--ignore-certificate-errors'] : [],
    })
    try {
      for (const item of SELECTED) {
        for (const mode of MODES) {
          if (mode !== 'load' && !item.control) continue
          const runs = mode === 'load' ? LOAD_RUNS : RUNS
          for (let run = 1; run <= runs; run++) {
            const result = await runOnce(browser, name, item, mode, run)
            results.push(result)
            console.log(JSON.stringify(result))
          }
        }
      }
    } finally {
      await browser.close()
    }
  }
  await writeFile(
    OUT,
    JSON.stringify(
      { baseUrl: BASE_URL, label: LABEL, profile: PROFILE, results },
      null,
      2
    )
  )

  console.log(`\n${LABEL} (${BASE_URL}), raw results in ${OUT}\n`)
  console.log(
    '| Browser | Case | Mode | Runs | Lost | Tap to visible, median (min-max) ms | Ready median ms | Sign-ins sent |'
  )
  console.log('| --- | --- | --- | ---: | ---: | --- | ---: | --- |')
  for (const name of BROWSERS)
    for (const item of SELECTED)
      for (const mode of MODES) {
        if (mode === 'load') continue
        const rows = results.filter(
          (r) => r.browser === name && r.case === item.id && r.mode === mode
        )
        if (rows.length === 0) continue
        const times = rows.flatMap((r) =>
          r.tapToVisible != null ? [r.tapToVisible] : []
        )
        const lost = rows.filter((r) => r.lost || r.error).length
        const ready = rows.flatMap((r) =>
          r.readyAt != null ? [r.readyAt] : []
        )
        const sent = rows.flatMap((r) =>
          r.signInSent != null ? [r.signInSent] : []
        )
        const range = times.length
          ? ` (${fmt(Math.min(...times))}-${fmt(Math.max(...times))})`
          : ''
        console.log(
          `| ${name} | ${item.id} | ${mode} | ${rows.length} | ${lost} | ${fmt(median(times))}${range} | ${fmt(median(ready))} | ${sent.length ? sent.join(' ') : ''} |`
        )
      }
  console.log(
    '\n| Browser | Route | Runs | FCP median ms | LCP median ms | CLS max | Control visible median ms | Ready median ms |'
  )
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const name of BROWSERS)
    for (const item of SELECTED) {
      const rows = results.filter(
        (r) =>
          r.browser === name &&
          r.case === item.id &&
          r.mode === 'load' &&
          !r.error
      )
      if (rows.length === 0) continue
      const pick = (key: 'fcp' | 'lcp' | 'readyAt' | 'visibleAt') =>
        median(rows.flatMap((r) => (r[key] != null ? [r[key] as number] : [])))
      const cls = rows.flatMap((r) => (r.cls != null ? [r.cls] : []))
      console.log(
        `| ${name} | ${item.path} | ${rows.length} | ${fmt(pick('fcp'))} | ${fmt(pick('lcp'))} | ${cls.length ? Math.max(...cls).toFixed(4) : 'n/a'} | ${fmt(pick('visibleAt'))} | ${fmt(pick('readyAt'))} |`
      )
    }
}

await main()
