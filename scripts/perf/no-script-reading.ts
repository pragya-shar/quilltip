// Public reading without scripts (#428): a reader whose scripts never run can
// still find and read a public article. Runs against a production build with
// the fixture backend of perf:budget; needs no secrets.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run perf:no-script-reading
//
// In Chromium and WebKit, at 375 px, with JavaScript disabled and with every
// /_next/static script blocked:
// - the home page shows a link to the article list;
// - the list shows a link named after the article, and following it by
//   native navigation shows the article's title and prose;
// - the writer's page shows the writer and a link to the article;
// - a draft or unknown article, and an unknown writer, answer 404 and show
//   no article text.
// The assertions use roles, link targets and visible text only, never class
// names or file paths, so the same check can run against redesigned pages:
// change READING below.

import { chromium, webkit, type Browser, type Page } from '@playwright/test'
import {
  FIXTURE_ARTICLE_PATH,
  FIXTURE_SLUG,
  FIXTURE_WRITER,
} from './convex-fixture'
import { startFixtureBackend } from './fixture-backend'
import { startProductionApp } from './production-app'

/** The public reading routes and what a reader must see on them. */
export const READING = {
  home: '/',
  list: '/articles',
  writer: `/${FIXTURE_WRITER}`,
  writerName: 'Fixture Writer',
  article: FIXTURE_ARTICLE_PATH,
  articleTitle: 'The Lamp on Orchard Street',
  /** A sentence from the article's body. */
  prose: 'came on every evening at a quarter past six',
  /** Paths that must answer 404 with no article text. */
  unreachable: [
    `/${FIXTURE_WRITER}/${FIXTURE_SLUG}-draft`,
    '/no-such-writer-428',
    '/no-such-writer-428/no-such-article',
  ],
}

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.PERF_APP_PORT ?? 3199)
const BASE_URL = `http://127.0.0.1:${APP_PORT}`
const ENGINES = (process.env.PERF_READING_ENGINES ?? 'chromium,webkit').split(
  ','
)

type Mode = 'javascript off' | 'scripts blocked'

async function newPage(browser: Browser, mode: Mode): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    javaScriptEnabled: mode !== 'javascript off',
  })
  if (mode === 'scripts blocked')
    await context.route(/\/_next\/static\/.*\.js(\?|$)/, (route) =>
      route.abort()
    )
  return context.newPage()
}

/** Visible within 2 s (no script needed: the HTML must already show it). */
const shown = (locator: ReturnType<Page['locator']>) =>
  locator
    .first()
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true)
    .catch(() => false)

async function check(page: Page, failures: string[], label: string) {
  const fail = (what: string) => failures.push(`${label}: ${what}`)

  await page.goto(BASE_URL + READING.home, { waitUntil: 'load' })
  if (!(await shown(page.locator(`a[href="${READING.list}"]`))))
    fail(`${READING.home} shows no link to ${READING.list}`)

  await page.goto(BASE_URL + READING.list, { waitUntil: 'load' })
  const articleLink = page.getByRole('link', { name: READING.articleTitle })
  if (!(await shown(articleLink))) {
    fail(`${READING.list} shows no link named "${READING.articleTitle}"`)
  } else {
    await articleLink.first().click()
    await page
      .waitForURL((url) => url.pathname === READING.article, {
        timeout: 20_000,
      })
      .catch(() => {})
    if (new URL(page.url()).pathname !== READING.article)
      fail(`following the article link did not open ${READING.article}`)
  }

  await page.goto(BASE_URL + READING.article, { waitUntil: 'load' })
  if (
    !(await shown(
      page.getByRole('heading', { level: 1, name: READING.articleTitle })
    ))
  )
    fail(`${READING.article} shows no heading "${READING.articleTitle}"`)
  if (!(await shown(page.getByText(READING.prose))))
    fail(`${READING.article} shows no prose ("${READING.prose}")`)

  await page.goto(BASE_URL + READING.writer, { waitUntil: 'load' })
  if (!(await shown(page.getByText(READING.writerName))))
    fail(`${READING.writer} does not show "${READING.writerName}"`)
  if (!(await shown(page.getByRole('link', { name: READING.articleTitle }))))
    fail(`${READING.writer} shows no link named "${READING.articleTitle}"`)
}

async function main() {
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL)
  const failures: string[] = []
  try {
    // Guards: no article text on a draft or unknown path, and a 404.
    for (const path of READING.unreachable) {
      const response = await fetch(BASE_URL + path, { redirect: 'manual' })
      const body = await response.text()
      if (response.status !== 404)
        failures.push(`${path}: status ${response.status}, expected 404`)
      if (body.includes(READING.prose) || body.includes(READING.articleTitle))
        failures.push(`${path}: the response contains article text`)
    }
    for (const name of ENGINES) {
      const browser = await (name === 'webkit' ? webkit : chromium).launch()
      try {
        for (const mode of ['javascript off', 'scripts blocked'] as Mode[]) {
          const page = await newPage(browser, mode)
          const before = failures.length
          await check(page, failures, `${name}, ${mode}`)
          console.log(
            `${name.padEnd(9)} ${mode.padEnd(16)} ${failures.length === before ? 'reads' : 'FAILS'}`
          )
          await page.context().close()
        }
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
    console.error(
      `\nNo-script reading check failed:\n- ${failures.join('\n- ')}`
    )
    process.exit(1)
  }
  console.log('\nNo-script reading check passed.')
  process.exit(0)
}

if (import.meta.main) await main()
