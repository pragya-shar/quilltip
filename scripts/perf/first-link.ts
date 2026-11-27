// Time to reading (#428): on a slow phone profile, when does a reader see the
// first thing they came for, and does a tap on it open the article?
// Measurement only; not part of CI. Run it on a quiet machine.
//
//   bun scripts/perf/first-link.ts \
//     --targets base=http://127.0.0.1:3304,change=http://127.0.0.1:3306 \
//     --browsers webkit,chromium --modes delayed,blocked,nojs \
//     --paths /,/articles,/some-writer/some-article --runs 10 --out out.json
//
// What counts as "reading" depends on the path:
// - `/`: the first visible link in <main> to /articles or to a demo reading;
// - a path with one segment (`/articles`, a writer): the first visible link in
//   <main> whose path is /<writer>/<slug>;
// - a path with two segments (an article): the first paragraph in <main> with
//   more than 80 characters of text.
//
// Modes:
// - delayed: the page's scripts load as usual on the slow profile;
// - blocked: requests for /_next/static scripts fail; inline scripts still run;
// - nojs: JavaScript is disabled in the browser.
//
// Per run: TTFB of the document, FCP (not available with nojs), the time the
// target is first inside the viewport, and for a link target whether a tap on
// it as soon as it is visible starts a navigation to the article. With
// scripts, an animation-frame probe in the page records the frame; with nojs,
// the script polls the page every 50 ms. Times are from navigation start.
// Targets alternate run by run. Every row records the load average.
import {
  chromium,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { writeFile } from 'fs/promises'
import { loadavg } from 'os'
import { gzipSync } from 'zlib'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')
const list = (key: string, fallback: string) =>
  (args.get(key) ?? fallback).split(',').filter(Boolean)

const TARGETS = list('targets', '').map((entry) => {
  const [label, url] = entry.split('=')
  return { label: label!, url: url!.replace(/\/$/, '') }
})
const BROWSERS = list('browsers', 'webkit')
const MODES = list('modes', 'delayed,blocked,nojs') as Mode[]
const PATHS = list('paths', '/articles')
const RUNS = Number(args.get('runs') ?? 10)
const OUT = args.get('out') ?? 'first-link.json'

type Mode = 'delayed' | 'blocked' | 'nojs'
type Kind = 'home-link' | 'article-link' | 'prose'

/** A mid-range phone on a slow 4G connection (Lighthouse mobile). */
const PROFILE = {
  viewport: { width: 375, height: 812 },
  latencyMs: 562.5,
  downloadBytesPerS: ((1.4744 * 1024 * 1024) / 8) * 0.9,
  uploadBytesPerS: ((0.675 * 1024 * 1024) / 8) * 0.9,
  cpuSlowdown: 4,
}

/** First path segments that are app routes, not writers. */
const RESERVED = [
  '_next',
  'api',
  'articles',
  'dashboard',
  'demo',
  'demos',
  'drafts',
  'forgot-password',
  'library',
  'login',
  'ops',
  'profile',
  'register',
  'reset-password',
  'settings',
  'welcome',
  'write',
]

function kindFor(path: string): Kind {
  const parts = path.split('?')[0]!.split('/').filter(Boolean)
  if (parts.length === 0) return 'home-link'
  return parts.length === 1 ? 'article-link' : 'prose'
}

/** Whether a link's path is the reading target for this kind of page. */
function isTargetHref(kind: Kind, href: string, reserved: string[]) {
  if (!href.startsWith('/')) return false
  const path = href.split(/[?#]/)[0]!
  if (kind === 'home-link')
    return path === '/articles' || path.startsWith('/demos/')
  const parts = path.split('/').filter(Boolean)
  return parts.length === 2 && !reserved.includes(parts[0]!)
}

/** In-page probe (pages with scripts): the frame the target first shows. */
function frameProbe({ kind, reserved }: { kind: Kind; reserved: string[] }) {
  const state = {
    fcp: null as number | null,
    shownAt: null as number | null,
  }
  ;(window as unknown as { __reading: typeof state }).__reading = state
  try {
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries())
        if (entry.name === 'first-contentful-paint') state.fcp = entry.startTime
    }).observe({ type: 'paint', buffered: true })
  } catch {}
  const inView = (el: Element) => {
    const box = el.getBoundingClientRect()
    if (!box.width || !box.height) return false
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    return box.top < innerHeight && box.bottom > 0
  }
  const isTarget = (href: string) => {
    if (!href.startsWith('/')) return false
    const path = href.split(/[?#]/)[0]!
    if (kind === 'home-link')
      return path === '/articles' || path.startsWith('/demos/')
    const parts = path.split('/').filter(Boolean)
    return parts.length === 2 && !reserved.includes(parts[0]!)
  }
  const shown = () => {
    if (kind === 'prose') {
      for (const p of document.querySelectorAll('main p'))
        if ((p.textContent ?? '').trim().length > 80 && inView(p)) return true
      return false
    }
    for (const a of document.querySelectorAll('main a[href]'))
      if (isTarget(a.getAttribute('href') ?? '') && inView(a)) {
        a.setAttribute('data-reading-target', '')
        return true
      }
    return false
  }
  const frame = (now: number) => {
    if (state.shownAt === null && shown()) state.shownAt = now
    if (state.shownAt === null) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

/** Poll from outside the page (nojs): the index of the visible target. */
async function findShown(page: Page, kind: Kind): Promise<number | null> {
  if (kind === 'prose') {
    const paragraphs = page.locator('main p').filter({ hasText: /.{81,}/ })
    const count = await paragraphs.count()
    for (let i = 0; i < count; i++)
      if (await inViewport(page, paragraphs.nth(i))) return i
    return null
  }
  const links = page.locator('main a[href]')
  const count = await links.count()
  for (let i = 0; i < count; i++) {
    const href = (await links.nth(i).getAttribute('href')) ?? ''
    if (
      isTargetHref(kind, href, RESERVED) &&
      (await inViewport(page, links.nth(i)))
    )
      return i
  }
  return null
}

async function inViewport(page: Page, locator: ReturnType<Page['locator']>) {
  if (!(await locator.isVisible())) return false
  const box = await locator.boundingBox()
  return (
    !!box &&
    box.width > 0 &&
    box.y < PROFILE.viewport.height &&
    box.y + box.height > 0
  )
}

/**
 * WebKit has no network emulation: delay each response by the latency and
 * its compressed size over a single shared link.
 */
async function emulateNetwork(context: BrowserContext) {
  let linkFreeAt = 0
  await context.route('**/*', async (route) => {
    const started = Date.now()
    try {
      const response = await route.fetch()
      const body = await response.body()
      const type = response.headers()['content-type'] ?? ''
      const wire = /text|javascript|json|css|svg|xml/.test(type)
        ? gzipSync(body).length
        : body.length
      const start = Math.max(started + PROFILE.latencyMs, linkFreeAt)
      const done = start + (wire / PROFILE.downloadBytesPerS) * 1000
      linkFreeAt = done
      await new Promise((r) => setTimeout(r, Math.max(0, done - Date.now())))
      await route.fulfill({ response, body })
    } catch {
      await route.abort().catch(() => {})
    }
  })
}

type Row = {
  target: string
  browser: string
  mode: Mode
  path: string
  kind: Kind
  run: number
  load1: number
  ttfb: number | null
  fcp: number | null
  shownAt: number | null
  opened: boolean | null
  openAt: number | null
  error?: string
}

async function runOnce(
  browser: Browser,
  engine: string,
  target: { label: string; url: string },
  mode: Mode,
  path: string,
  run: number
): Promise<Row> {
  const kind = kindFor(path)
  const row: Row = {
    target: target.label,
    browser: engine,
    mode,
    path,
    kind,
    run,
    load1: Math.round(loadavg()[0]! * 10) / 10,
    ttfb: null,
    fcp: null,
    shownAt: null,
    opened: kind === 'prose' ? null : false,
    openAt: null,
  }
  const context = await browser.newContext({
    viewport: PROFILE.viewport,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: engine === 'chromium',
    javaScriptEnabled: mode !== 'nojs',
    ignoreHTTPSErrors: true,
  })
  try {
    const page = await context.newPage()
    if (engine === 'chromium') {
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
    // Registered after the emulation route, so it runs first.
    if (mode === 'blocked')
      await context.route(/\/_next\/static\/.*\.js(\?|$)/, (r) => r.abort())
    if (mode !== 'nojs')
      await page.addInitScript(frameProbe, { kind, reserved: RESERVED })

    const t0 = Date.now()
    let navigatedAt: number | null = null
    const response = await page.goto(target.url + path, {
      waitUntil: 'commit',
      timeout: 60_000,
    })
    const timing = response?.request().timing()
    if (timing && timing.responseStart >= 0)
      row.ttfb = Math.round(timing.responseStart)
    page.on('request', (request) => {
      if (
        navigatedAt === null &&
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame()
      )
        navigatedAt = Date.now()
    })

    const deadline = Date.now() + 30_000
    let shownIndex: number | null = null
    while (Date.now() < deadline) {
      if (mode === 'nojs') {
        shownIndex = await findShown(page, kind)
        if (shownIndex !== null) {
          row.shownAt = Date.now() - t0
          break
        }
      } else {
        const state = await page
          .evaluate(
            () =>
              (
                window as unknown as {
                  __reading?: { fcp: number | null; shownAt: number | null }
                }
              ).__reading ?? null
          )
          .catch(() => null)
        if (state?.shownAt != null) {
          row.shownAt = Math.round(state.shownAt)
          row.fcp = state.fcp === null ? null : Math.round(state.fcp)
          break
        }
      }
      await page.waitForTimeout(50)
    }
    if (row.shownAt === null) return { ...row, error: 'not shown in 30 s' }
    if (kind === 'prose') return row

    // Tap the link and wait for a navigation (document or client-side).
    const link =
      mode === 'nojs'
        ? page.locator('main a[href]').nth(shownIndex!)
        : page.locator('[data-reading-target]').first()
    await link.tap({ noWaitAfter: true, timeout: 10_000 }).catch(() => {})
    const end = Date.now() + 20_000
    while (Date.now() < end && navigatedAt === null) {
      if (new URL(page.url()).pathname !== path.split('?')[0])
        navigatedAt = Date.now()
      else await page.waitForTimeout(25)
    }
    row.opened = navigatedAt !== null
    row.openAt = navigatedAt === null ? null : navigatedAt - t0
    return row
  } catch (error) {
    return { ...row, error: String(error).slice(0, 200) }
  } finally {
    await context.close()
  }
}

async function main() {
  if (TARGETS.length === 0) {
    console.error('Pass --targets label=url[,label=url]')
    process.exit(1)
  }
  const rows: Row[] = []
  for (const engine of BROWSERS) {
    const browser = await (engine === 'chromium' ? chromium : webkit).launch()
    try {
      for (const path of PATHS)
        for (const mode of MODES)
          for (let run = 0; run < RUNS; run++)
            for (const target of TARGETS) {
              const row = await runOnce(
                browser,
                engine,
                target,
                mode,
                path,
                run
              )
              rows.push(row)
              console.log(
                `${engine} ${path} ${mode} ${target.label} #${run} (load ${row.load1}): ` +
                  `ttfb ${row.ttfb ?? '-'} fcp ${row.fcp ?? '-'} shown ${row.shownAt ?? '-'}` +
                  (row.opened === null
                    ? ''
                    : ` opened ${row.opened} at ${row.openAt ?? '-'}`) +
                  (row.error ? ` ${row.error}` : '')
              )
            }
    } finally {
      await browser.close()
    }
  }
  await writeFile(OUT, JSON.stringify(rows, null, 2))

  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted.length
      ? Math.round(sorted[Math.floor(sorted.length / 2)]!)
      : null
  }
  console.log(
    '\n| Browser | Path | Mode | Target | Load | TTFB | FCP | Shown | Opened |\n' +
      '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |'
  )
  for (const engine of BROWSERS)
    for (const path of PATHS)
      for (const mode of MODES)
        for (const target of TARGETS) {
          const set = rows.filter(
            (r) =>
              r.browser === engine &&
              r.path === path &&
              r.mode === mode &&
              r.target === target.label
          )
          const num = (key: 'ttfb' | 'fcp' | 'shownAt' | 'load1') =>
            median(
              set.map((r) => r[key]).filter((v): v is number => v !== null)
            )
          const opened =
            set[0]?.opened === null
              ? '-'
              : `${set.filter((r) => r.opened).length}/${set.length}`
          console.log(
            `| ${engine} | ${path} | ${mode} | ${target.label} | ${num('load1') ?? '-'} | ` +
              `${num('ttfb') ?? '-'} | ${num('fcp') ?? '-'} | ${num('shownAt') ?? 'never'} | ${opened} |`
          )
        }
}

if (import.meta.main) await main()
