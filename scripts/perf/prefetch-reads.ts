// Backend reads made by one view of /articles (#630). Article and writer
// links do not prefetch (lib/articles/linkPrefetch.ts), so having every card
// in view and the pointer over each link costs no backend read; a click
// costs one route check and at most one article read. Runs against the
// fixture build of perf:budget; needs no secrets.
//
// "At most one article read" holds while the server's copy of the article is
// under 60 s old, as on a fresh build. A request that meets an older copy
// makes two (lib/seo/publicContent.ts, cachedFor: the direct read and the
// cache's background refresh), so a rerun against an old .next/cache can
// fail here without a prefetch.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run perf:prefetch-reads
//   PERF_PREFETCH_MEASURE=1 bun run perf:prefetch-reads   # print only
//
// The fixture backend counts the queries the server makes (the proxy's
// route check and the page's reads); the browser's live queries use its
// silent WebSocket and are not counted.

import { chromium, webkit, type Page } from '@playwright/test'
import {
  fixtureBackendReads,
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

const ROUTE_CHECK = 'publicRoutes:resolvePublicRoute'
const ARTICLE_READ = 'articles:getArticleBySlug'
const WRITER_READ = 'users:getUserByUsername'

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

async function main() {
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL)
  const failures: string[] = []
  try {
    for (const engine of ENGINES) {
      const browser = await (engine === 'webkit' ? webkit : chromium).launch()
      try {
        const page = await browser.newPage({
          viewport: { width: 1280, height: 900 },
        })
        resetFixtureBackendReads()
        await page.goto(BASE_URL + READING.list, { waitUntil: 'load' })
        await sleep(1500) // hydration and any viewport prefetches
        const load = snapshot()

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

        if (MEASURE_ONLY) continue
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
      }
    }
  } finally {
    app?.kill()
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
