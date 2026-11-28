// Backend reads made by one view of /articles (#630). Article and writer
// links do not prefetch (lib/articles/linkPrefetch.ts), so having every card
// in view and the pointer over each link costs no backend read; a click
// costs one route check and at most one article read. Runs against the
// fixture build of perf:budget; needs no secrets.
//
// "At most one article read" holds while the server's copy of the article is
// under 60 s old. A request that meets an older copy makes two
// (lib/seo/publicContent.ts, cachedFor: the direct read and the cache's
// background refresh; #674). So the check owns that precondition: for each
// engine it empties the server's data cache (.next/cache/fetch-cache) and
// starts a fresh app, and the click meets no copy at all. A rerun against an
// old .next/cache then counts as CI does.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run perf:prefetch-reads
//   PERF_PREFETCH_MEASURE=1 bun run perf:prefetch-reads   # print only
//
// The fixture backend counts the queries the server makes (the proxy's
// route check and the page's reads); the browser's live queries use its
// silent WebSocket and are not counted.

import { readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { chromium, webkit, type Page } from '@playwright/test'
import { randomUUID } from 'crypto'
import {
  fixtureBackendReads,
  fixtureRun,
  foreignBackendReads,
  resetFixtureBackendReads,
  startFixtureBackend,
} from './fixture-backend'
import { startProductionApp } from './production-app'
import { READING } from './no-script-reading'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.PERF_APP_PORT ?? 3199)
const BASE_URL = `http://127.0.0.1:${APP_PORT}`
const ENGINES = (process.env.PERF_READING_ENGINES ?? 'chromium,webkit').split(
  ','
)
const MEASURE_ONLY = process.env.PERF_PREFETCH_MEASURE === '1'
/** The server's data cache (unstable_cache entries), kept across restarts. */
const DATA_CACHE = join(process.cwd(), '.next', 'cache', 'fetch-cache')

/** Empties the server's data cache and says how many entries it held. */
function emptyDataCache(): number {
  let entries = 0
  try {
    entries = readdirSync(DATA_CACHE).length
  } catch {
    return 0
  }
  rmSync(DATA_CACHE, { recursive: true, force: true })
  return entries
}

const ROUTE_CHECK = 'publicRoutes:resolvePublicRoute'
const ARTICLE_READ = 'articles:getArticleBySlug'
const WRITER_READ = 'users:getUserByUsername'
const LIST_READ = 'articles:listArticles'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const snapshot = () => Object.fromEntries(fixtureBackendReads)
const count = (reads: Record<string, number>, path: string) => reads[path] ?? 0
const describeReads = (reads: Record<string, number>) =>
  Object.entries(reads)
    .map(([path, n]) => `${path} ${n}`)
    .join(', ') || 'none'

/** Brings every card into view and moves the pointer over each link. */
async function scrollAndHover(page: Page) {
  const height = await page.evaluate(() => document.body.scrollHeight)
  for (let y = 0; y <= height; y += 300) {
    await page.evaluate((top) => window.scrollTo(0, top), y)
    await sleep(150)
  }
  const links = page.locator('main a[href]')
  const total = await links.count()
  for (let i = 0; i < total; i++) {
    const href = (await links.nth(i).getAttribute('href')) ?? ''
    const parts = href.split(/[?#]/)[0]!.split('/').filter(Boolean)
    // Writer (/name) and article (/name/slug) links only.
    if (!href.startsWith('/') || parts.length < 1 || parts.length > 2) continue
    if (parts[0] === 'articles') continue
    await links
      .nth(i)
      .hover({ timeout: 1000 })
      .catch(() => {})
    await sleep(100)
  }
}

/**
 * Stops the app and waits until its port is free, so the next engine gets a
 * fresh app. Fails rather than measure against an app still serving.
 */
async function stopApp(app: Awaited<ReturnType<typeof startProductionApp>>) {
  if (!app) return
  try {
    // The whole process group when the app has its own (next-server runs
    // as a grandchild of `bunx`); otherwise this throws and kill() remains.
    if (app.pid) process.kill(-app.pid, 'SIGTERM')
  } catch {
    /* No process group of its own. */
  }
  app.kill()
  await waitUntilStopped(BASE_URL)
}

/**
 * Waits until nothing answers on `baseUrl` (at most `tries` × 100 ms of
 * answers). Each probe gives up after 1 s, so a stopping server that accepts
 * the connection but never answers ends the wait too.
 */
export async function waitUntilStopped(baseUrl: string, tries = 100) {
  for (let i = 0; i < tries; i++) {
    const answering = await fetch(baseUrl + '/login', {
      signal: AbortSignal.timeout(1000),
    })
      .then(() => true)
      .catch(() => false)
    if (!answering) return
    await sleep(100)
  }
  throw new Error(`The app on ${baseUrl} still answers after it was stopped`)
}

async function main() {
  const backend = startFixtureBackend(CONVEX_PORT)
  const failures: string[] = []
  try {
    for (const engine of ENGINES) {
      if (process.env.PERF_BASE_URL)
        console.log(
          `${engine}: PERF_BASE_URL is set, so the server cache is not emptied; a click may meet an old copy (#674)`
        )
      else
        console.log(
          `${engine}: emptied the server data cache (${emptyDataCache()} entries) and started a fresh app`
        )
      // This run's id: the app's server sends it on every read, and the
      // fixture backend counts only reads that carry it.
      fixtureRun.token = process.env.PERF_RUN_TOKEN = randomUUID()
      const app = await startProductionApp(APP_PORT, BASE_URL)
      const browser = await (engine === 'webkit' ? webkit : chromium).launch()
      try {
        const page = await browser.newPage({
          viewport: { width: 1280, height: 900 },
        })
        resetFixtureBackendReads()
        await page.goto(BASE_URL + READING.list, { waitUntil: 'load' })
        await sleep(1500) // hydration and any viewport prefetches
        const load = snapshot()
        const foreign = Object.fromEntries(foreignBackendReads)

        resetFixtureBackendReads()
        await scrollAndHover(page)
        await sleep(3000) // let prefetches started by the pointer finish
        const prefetches = snapshot()

        resetFixtureBackendReads()
        await page
          .getByRole('link', { name: READING.articleTitle })
          .first()
          .click()
        await page
          .waitForURL((url) => url.pathname === READING.article, {
            timeout: 15_000,
          })
          .catch(() => {})
        await sleep(1000)
        const click = snapshot()

        console.log(`${engine}, view of /articles: ${describeReads(load)}`)
        console.log(
          `${engine}, every card in view and hovered: ${describeReads(prefetches)}`
        )
        console.log(`${engine}, click on an article: ${describeReads(click)}`)

        if (Object.keys(foreign).length > 0)
          console.log(
            `${engine}, reads from another process (not counted): ${describeReads(foreign)}`
          )
        if (MEASURE_ONLY) continue
        // The view's own list read proves this run's app served /articles.
        if (count(load, LIST_READ) === 0)
          failures.push(
            `${engine}: no read of this run reached the backend for the view of /articles (another server on ${BASE_URL}?)`
          )
        // The view's own reads are publicRouteExists and listArticles; a route
        // check, an article or a writer read while the page loads comes from
        // viewport prefetches of its links.
        for (const path of [ROUTE_CHECK, ARTICLE_READ, WRITER_READ])
          if (count(load, path) > 0)
            failures.push(
              `${engine}: the view of /articles made ${count(load, path)} ${path} reads`
            )
        for (const path of [ROUTE_CHECK, ARTICLE_READ, WRITER_READ])
          if (count(prefetches, path) > 0)
            failures.push(
              `${engine}: prefetches made ${count(prefetches, path)} ${path} reads`
            )
        if (count(click, ROUTE_CHECK) > 1)
          failures.push(
            `${engine}: a click made ${count(click, ROUTE_CHECK)} route checks`
          )
        if (count(click, ARTICLE_READ) > 1)
          failures.push(
            `${engine}: a click made ${count(click, ARTICLE_READ)} article reads`
          )
        if (new URL(page.url()).pathname !== READING.article)
          failures.push(`${engine}: the click did not open the article`)
      } finally {
        await browser.close()
        await stopApp(app)
      }
    }
  } finally {
    backend.closeAllConnections()
    backend.close()
  }
  if (failures.length > 0) {
    console.error(`\nPrefetch reads check failed:\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }
  console.log(
    MEASURE_ONLY
      ? '\nPrefetch reads measured.'
      : '\nPrefetch reads check passed.'
  )
  process.exit(0)
}

if (import.meta.main) await main()
