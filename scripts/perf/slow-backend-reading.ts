// Public reading with a slow, silent, failing or wrongly answering backend
// (#428, #609). Runs against the fixture build of perf:budget, after
// perf:no-script-reading; needs no secrets.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run perf:slow-backend-reading
//
// A reader sees one of three states: the page, the in-page readable fallback
// (200, `noindex`), or the outage response (503, `Retry-After: 30`,
// `no-store`). `/` stays 200 in all of them. With the backend:
// - silent, slower than the limit, or failing (5xx): `/articles`, a writer
//   page and an article answer 503 within two read limits plus a margin, and
//   at once while the outage is remembered; with JavaScript off, in Chromium
//   and WebKit, the 503 shows a heading, "Try again" and the way home; a HEAD
//   request gets the same status; no request to the backend stays open;
// - a writer page inside its 60 s "found" window answers its 200 fallback
//   until a checked path has declared the outage, then 503;
// - a link pressed on `/articles` during an outage ends, by a document load,
//   on the readable 503, with no page error;
// - with `/articles` open during an outage, prefetches cost at most one
//   check (two reads) per 5 s;
// - answering wrongly (a function that threw): no outage; the page renders
//   and shows its readable 200 fallback;
// - slow once (the first attempt runs out, the retry answers): the page;
// - answering again: every page shows its content (nothing was cached from
//   the outage).

import { chromium, webkit, type Browser, type Page } from '@playwright/test'
import { rmSync } from 'fs'
import { join } from 'path'
import { PUBLIC_READ_TIMEOUT_MS } from '../../lib/seo/publicReadTimeout'
import { fixtureBackendBehaviour, startFixtureBackend } from './fixture-backend'
import { startProductionApp } from './production-app'
import { READING, wayHomeOn } from './no-script-reading'

/** Rendering and CI noise on top of the read limits. */
const MARGIN_MS = 1000
/** The outage bound: the proxy's check and its one retry. */
const OUTAGE_BOUND_MS = 2 * PUBLIC_READ_TIMEOUT_MS + MARGIN_MS
/** proxy.ts: how long one instance remembers a declared outage. */
const OUTAGE_MEMORY_MS = 5000

/** The checked pages and what each shows when it reads. */
const PAGES = [
  { path: READING.list, content: READING.articleTitle },
  { path: READING.writer, content: READING.writerName },
  { path: READING.article, content: READING.prose },
]
const FALLBACK_TEXT = 'could not be loaded right now'
const RETRY_LINK = 'Try again'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.PERF_APP_PORT ?? 3199)
const BASE_URL = `http://127.0.0.1:${APP_PORT}`
const ENGINES = (process.env.PERF_READING_ENGINES ?? 'chromium,webkit').split(
  ','
)

const failures: string[] = []
const fail = (what: string) => failures.push(what)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (label: string, detail: string) =>
  console.log(`${label.padEnd(58)} ${detail}`)

async function timedFetch(
  path: string,
  init: { method?: string; limitMs?: number } = {}
) {
  const started = performance.now()
  const response = await fetch(BASE_URL + path, {
    method: init.method ?? 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout((init.limitMs ?? OUTAGE_BOUND_MS) + 5000),
  })
  const firstByte = performance.now() - started
  const body = await response.text()
  return { response, body, firstByte, whole: performance.now() - started }
}

/** Waits until the outage memory has expired and the backend answers. */
async function recover() {
  fixtureBackendBehaviour.mode = 'normal'
  await sleep(OUTAGE_MEMORY_MS + 200)
  const { response } = await timedFetch(READING.list)
  if (response.status !== 200)
    fail(`recovery: /articles answered ${response.status} after the memory`)
}

/** Checks a 503 outage response: status, headers, body, and its timing. */
function expectOutage(
  label: string,
  result: Awaited<ReturnType<typeof timedFetch>>,
  boundMs: number
) {
  const { response, body, firstByte, whole } = result
  log(
    label,
    `${response.status}  first byte ${Math.round(firstByte)} ms  whole ${Math.round(whole)} ms  (bound ${boundMs} ms)`
  )
  if (response.status !== 503)
    fail(`${label}: status ${response.status}, expected 503`)
  if (response.headers.get('retry-after') !== '30')
    fail(`${label}: Retry-After is "${response.headers.get('retry-after')}"`)
  if (response.headers.get('cache-control') !== 'no-store')
    fail(
      `${label}: Cache-Control is "${response.headers.get('cache-control')}"`
    )
  if (firstByte > boundMs)
    fail(`${label}: first byte after ${Math.round(firstByte)} ms`)
  if (whole > boundMs)
    fail(`${label}: whole page after ${Math.round(whole)} ms`)
  if (!body.includes(FALLBACK_TEXT)) fail(`${label}: no outage message`)
  if (/<script\b/i.test(body)) fail(`${label}: the outage body has a script`)
}

async function readable(page: Page): Promise<string[]> {
  const visible = (locator: ReturnType<Page['locator']>) =>
    locator
      .first()
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false)
  const missing: string[] = []
  if (!(await visible(page.getByRole('heading', { name: FALLBACK_TEXT }))))
    missing.push(`no heading "… ${FALLBACK_TEXT}."`)
  if (!(await visible(page.getByRole('link', { name: RETRY_LINK }))))
    missing.push(`no "${RETRY_LINK}" link`)
  if (!(await visible(wayHomeOn(page, READING.wayHome))))
    missing.push(`no way home (${READING.wayHome.name})`)
  return missing
}

/** With JavaScript off: each page loads and reads as the expected state. */
async function readableWithoutScripts(
  browser: Browser,
  engine: string,
  state: string,
  expectedStatus: number,
  /** A URL of the same page, for a cache key of its own. */
  urlFor: (path: string) => string = (path) => path
) {
  for (const { path } of PAGES) {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      javaScriptEnabled: false,
    })
    const page = await context.newPage()
    const label = `${state}, ${engine}, javascript off, ${path}`
    const response = await page
      .goto(BASE_URL + urlFor(path), {
        waitUntil: 'load',
        timeout: OUTAGE_BOUND_MS + 5000,
      })
      .catch(() => null)
    const missing = response ? await readable(page) : ['the page did not load']
    if (response && response.status() !== expectedStatus)
      missing.push(`status ${response.status()}, expected ${expectedStatus}`)
    log(label, missing.length ? 'FAILS' : 'reads')
    for (const what of missing) fail(`${label}: ${what}`)
    await context.close()
  }
}

async function main() {
  // Start from an empty data cache, so the pages really read the backend.
  rmSync(join(process.cwd(), '.next', 'cache', 'fetch-cache'), {
    recursive: true,
    force: true,
  })
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL)
  const browsers = new Map<string, Browser>()
  try {
    for (const engine of ENGINES)
      browsers.set(
        engine,
        await (engine === 'webkit' ? webkit : chromium).launch()
      )

    // 1. A writer page found while the backend answers starts its 60 s
    //    "found" window; inside it the page skips the check.
    fixtureBackendBehaviour.mode = 'normal'
    const found = await timedFetch(READING.writer)
    if (found.response.status !== 200)
      fail(`writer page while answering: status ${found.response.status}`)

    // 2. Silent backend.
    fixtureBackendBehaviour.mode = 'silent'
    const gap = await timedFetch(READING.writer)
    log(
      'silent backend, writer page inside its found window',
      `${gap.response.status}  ${gap.body.includes(FALLBACK_TEXT) ? 'fallback' : 'NO FALLBACK'}`
    )
    if (gap.response.status !== 200 || !gap.body.includes(FALLBACK_TEXT))
      fail('writer page inside its found window: expected its 200 fallback')
    expectOutage(
      'silent backend, /articles (declares the outage)',
      await timedFetch(READING.list),
      OUTAGE_BOUND_MS
    )
    for (const { path } of PAGES)
      expectOutage(
        `silent backend, ${path} (remembered)`,
        await timedFetch(path),
        MARGIN_MS
      )
    const head = await timedFetch(READING.article, { method: 'HEAD' })
    log('silent backend, HEAD article', `${head.response.status}`)
    if (head.response.status !== 503 || head.body !== '')
      fail(
        `HEAD during an outage: ${head.response.status}, body "${head.body}"`
      )
    const home = await timedFetch(READING.home)
    log('silent backend, /', `${home.response.status}`)
    if (home.response.status !== 200 || !home.body.includes('href="/articles"'))
      fail(`/ during an outage: status ${home.response.status}`)
    for (const [engine, browser] of browsers)
      await readableWithoutScripts(browser, engine, 'silent backend', 503)
    await sleep(500)
    log(
      'silent backend, backend requests still open',
      `${fixtureBackendBehaviour.open}`
    )
    if (fixtureBackendBehaviour.open !== 0)
      fail(
        `silent backend: ${fixtureBackendBehaviour.open} backend requests still open`
      )
    await recover()

    // 3. A link pressed on /articles during an outage, and prefetches.
    for (const [engine, browser] of browsers) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      })
      const page = await context.newPage()
      // Errors while the page is in use. Once the document load starts, the
      // old page is torn down and WebKit reports its cancelled prefetches as
      // errors ("access control checks"); those are logged, not failures.
      const pageErrors: string[] = []
      const unloadErrors: string[] = []
      let documentLoads = 0
      page.on('pageerror', (error) =>
        (documentLoads > 0 ? unloadErrors : pageErrors).push(
          String(error).slice(0, 160)
        )
      )
      await page.goto(BASE_URL + READING.list, { waitUntil: 'load' })
      await sleep(1500) // hydration and viewport prefetches, backend answering
      fixtureBackendBehaviour.mode = 'silent'
      const readsBefore = fixtureBackendBehaviour.reads
      // Prefetches with the links in view and the pointer over them.
      const link = page
        .getByRole('link', { name: READING.articleTitle })
        .first()
      await link.hover().catch(() => {})
      await sleep(6000)
      const prefetchReads = fixtureBackendBehaviour.reads - readsBefore
      log(
        `outage, ${engine}, backend reads by prefetches in 6 s`,
        `${prefetchReads}`
      )
      // One check (two reads) per 5 s of memory: at most two windows here.
      if (prefetchReads > 4)
        fail(`${engine}: prefetches made ${prefetchReads} backend reads in 6 s`)
      let documentStatus: number | null = null
      page.on('request', (request) => {
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame()
        )
          documentLoads += 1
      })
      page.on('response', (response) => {
        if (response.request().isNavigationRequest())
          documentStatus = response.status()
      })
      await link.click()
      await page
        .waitForURL((url) => url.pathname === READING.article, {
          timeout: OUTAGE_BOUND_MS + 5000,
        })
        .catch(() => {})
      const missing = await readable(page)
      if (documentStatus !== 503)
        missing.push(`document status ${documentStatus}, expected 503`)
      if (pageErrors.length)
        missing.push(`a page error (${pageErrors.join(' | ')})`)
      // One document load, the router's fall back to the 503: no loop.
      await sleep(1500)
      if (documentLoads !== 1)
        missing.push(`${documentLoads} document loads, expected 1`)
      if (unloadErrors.length)
        log(
          `outage, ${engine}, errors while the old page unloaded`,
          `${unloadErrors.length} (cancelled prefetches)`
        )
      log(
        `outage, ${engine}, link pressed on /articles`,
        missing.length ? `FAILS (${missing.join('; ')})` : 'readable 503'
      )
      for (const what of missing) fail(`${engine}, link pressed: ${what}`)
      await context.close()
      await recover()
    }

    // 4. Failing (5xx) and slower than the limit.
    for (const mode of ['error', 'slow'] as const) {
      fixtureBackendBehaviour.mode = mode
      fixtureBackendBehaviour.delayMs = 2 * PUBLIC_READ_TIMEOUT_MS
      fixtureBackendBehaviour.slowPaths = undefined
      const name = mode === 'error' ? 'failing' : 'slow'
      expectOutage(
        `${name} backend, /articles`,
        await timedFetch(READING.list),
        mode === 'error' ? MARGIN_MS : OUTAGE_BOUND_MS
      )
      await recover()
    }

    // 5. Answering wrongly: no outage, the page's readable 200 fallback. The
    //    list uses a key of its own: recovery above cached the plain list.
    fixtureBackendBehaviour.mode = 'wrong'
    for (const { path } of PAGES) {
      const { response, body } = await timedFetch(
        path === READING.list ? `${path}?tag=wrong-answers` : path
      )
      const ok =
        response.status === 200 &&
        body.includes(FALLBACK_TEXT) &&
        /<meta name="robots" content="noindex"/.test(body)
      log(
        `wrong answers, ${path}`,
        `${response.status}  ${ok ? 'readable 200 fallback' : 'FAILS'}`
      )
      if (!ok)
        fail(`wrong answers, ${path}: expected the readable 200 fallback`)
    }
    for (const [engine, browser] of browsers)
      await readableWithoutScripts(
        browser,
        engine,
        'wrong answers',
        200,
        (path) =>
          path === READING.list ? `${path}?tag=wrong-answers-${engine}` : path
      )
    fixtureBackendBehaviour.mode = 'normal'

    // 6. Slow once: the first attempt runs out, the retry answers.
    fixtureBackendBehaviour.mode = 'slow-once'
    fixtureBackendBehaviour.delayMs = 2 * PUBLIC_READ_TIMEOUT_MS
    const once = await timedFetch(READING.article)
    log(
      'slow once, article',
      `${once.response.status}  first byte ${Math.round(once.firstByte)} ms`
    )
    if (once.response.status !== 200 || !once.body.includes(READING.prose))
      fail(`slow once: status ${once.response.status}, expected the article`)
    fixtureBackendBehaviour.mode = 'normal'

    // 7. Answering again: every page shows its content.
    for (const { path, content } of PAGES) {
      const { response, body } = await timedFetch(path, { limitMs: 10_000 })
      const ok = body.includes(content) && !body.includes(FALLBACK_TEXT)
      log(
        `answering backend, ${path}`,
        `${response.status}  ${ok ? 'content' : 'FAILS'}`
      )
      if (!ok) fail(`answering backend, ${path}: no content`)
    }
  } finally {
    for (const browser of browsers.values()) await browser.close()
    app?.kill()
    backend.closeAllConnections()
    backend.close()
  }
  if (failures.length > 0) {
    console.error(
      `\nSlow-backend reading check failed:\n- ${failures.join('\n- ')}`
    )
    process.exit(1)
  }
  console.log('\nSlow-backend reading check passed.')
  process.exit(0)
}

if (import.meta.main) await main()
