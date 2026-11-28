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
// - the sign-in pages (/signin, its reset page, and the older /login,
//   /register and /reset-password that redirect there) say that signing in
//   needs JavaScript with JavaScript off, and show the form with scripts
//   blocked (an inline script holds a press until they load);
// - an unpublished article, an unknown article and an unknown writer answer
//   404 and show no article text, and no public list names the unpublished
//   article;
// - with scripts on, a signed-in section sends a signed-out reader to sign in;
//   a page a package lists in signedOutLanding instead ends on that
//   package's page, which offers a plain link to sign in, scripts on and off.
// The assertions use roles, link targets and visible text only, never class
// names or file paths, so the same check can run against redesigned pages:
// change READING below.

import { chromium, webkit, type Browser, type Page } from '@playwright/test'
import {
  FIXTURE_ARTICLE_PATH,
  FIXTURE_DRAFT,
  FIXTURE_WRITER,
} from './convex-fixture'
import { startFixtureBackend } from './fixture-backend'
import { startProductionApp } from './production-app'
import { SIGNED_OUT_LANDING } from './routes'

type Role = Parameters<Page['getByRole']>[0]
/** A locator by role and accessible name, inside an optional landmark. */
export type WayHome = { within?: Role; role: Role; name: string }

/** The way-home locator of READING on a page. */
export function wayHomeOn(page: Page, wayHome: WayHome) {
  const scope = wayHome.within ? page.getByRole(wayHome.within) : page
  return scope.getByRole(wayHome.role, { name: wayHome.name, exact: true })
}

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
  /** An unpublished article of the writer: its URL answers 404. */
  draft: {
    path: `/${FIXTURE_WRITER}/${FIXTURE_DRAFT.slug}`,
    title: FIXTURE_DRAFT.title,
    text: FIXTURE_DRAFT.text,
  },
  /** Paths that must answer 404 with no article text. */
  unreachable: [
    `/${FIXTURE_WRITER}/no-such-article`,
    '/no-such-writer-428',
    '/no-such-writer-428/no-such-article',
  ],
  /** Sign-in pages and the older addresses that redirect to them. */
  authPages: [
    '/signin',
    '/signin/reset',
    '/login',
    '/register',
    '/reset-password',
  ],
  /** What a sign-in page says with JavaScript off: signing in cannot work
   * without it, and the page says so instead of showing a dead form. */
  authNeedsScript: /needs JavaScript/,
  /**
   * How a reader finds the way home on a public page at 375 px without
   * scripts: a role and accessible name, inside an optional landmark. v2:
   * the header's wordmark link.
   */
  wayHome: {
    within: 'banner',
    role: 'link',
    name: 'Quilltip home',
  } as WayHome,
  /**
   * A signed-in section and where it sends a signed-out reader. The redirect
   * runs in the browser, so this one load has scripts on.
   */
  signedIn: { path: '/dashboard', signInPath: '/signin' },
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

async function check(
  page: Page,
  failures: string[],
  label: string,
  mode: Mode
) {
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

  const scriptsOff = mode === 'javascript off'
  for (const path of READING.authPages) {
    await page.goto(BASE_URL + path, { waitUntil: 'load' })
    if (!new URL(page.url()).pathname.startsWith('/signin'))
      fail(`${path} ended at ${new URL(page.url()).pathname}, not sign-in`)
    if (scriptsOff) {
      if (!(await shown(page.getByText(READING.authNeedsScript))))
        fail(`${path} does not say that signing in needs JavaScript`)
      if (await page.getByRole('textbox').first().isVisible())
        fail(`${path} shows a form that cannot work without JavaScript`)
    } else if (!(await shown(page.getByRole('textbox'))))
      fail(`${path} shows no form field`)
  }
}

type Landing = (typeof SIGNED_OUT_LANDING)[number]

/**
 * A protected old page that ends, for a signed-out reader, on a package's
 * page that offers sign-in itself: with scripts on and with JavaScript off,
 * the visit ends at `endsAt`, `main` holds the sign-in link back to it and
 * no money, and with no script following the link shows the sign-in form.
 */
async function checkLanding(
  browser: Browser,
  landing: Landing,
  failures: string[]
) {
  const signIn = READING.signedIn.signInPath
  const href = `${signIn}?returnTo=${encodeURIComponent(landing.endsAt)}`
  for (const scripts of [true, false]) {
    const label = `${landing.path}, signed out, scripts ${scripts ? 'on' : 'off'}`
    const fail = (what: string) => failures.push(`${label}: ${what}`)
    const context = await browser.newContext({ javaScriptEnabled: scripts })
    try {
      const page = await context.newPage()
      await page.goto(BASE_URL + landing.path)
      await page
        .waitForURL((url) => url.pathname === landing.endsAt, {
          timeout: 15_000,
        })
        .catch(() => {})
      const reached = new URL(page.url()).pathname
      console.log(`${label} -> ${reached}`)
      if (reached !== landing.endsAt) {
        fail(`ended at ${reached}, expected ${landing.endsAt}`)
        continue
      }
      const main = page.getByRole('main')
      const link = main.getByRole('link', {
        name: landing.signInLink,
        exact: true,
      })
      if (!(await shown(link))) {
        fail(`main shows no link named "${landing.signInLink}"`)
        continue
      }
      const target = await link.first().getAttribute('href')
      if (target !== href)
        fail(`the sign-in link goes to ${target}, expected ${href}`)
      if (/\$\s?\d/.test(await main.innerText()))
        fail('main shows a money figure')
      if (scripts) continue
      await link.first().click()
      await page
        .waitForURL((url) => url.pathname === signIn, { timeout: 15_000 })
        .catch(() => {})
      const after = new URL(page.url())
      if (after.pathname !== signIn)
        fail(`following the sign-in link ended at ${after.pathname}`)
      else if (!(await shown(page.getByRole('textbox'))))
        fail(`${signIn} shows no form field`)
    } finally {
      await context.close()
    }
  }
}

async function main() {
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL)
  const failures: string[] = []
  try {
    // Guards: no article text on a draft or unknown path, and a 404.
    for (const path of [READING.draft.path, ...READING.unreachable]) {
      const response = await fetch(BASE_URL + path, { redirect: 'manual' })
      const body = await response.text()
      if (response.status !== 404)
        failures.push(`${path}: status ${response.status}, expected 404`)
      if (
        body.includes(READING.prose) ||
        body.includes(READING.articleTitle) ||
        body.includes(READING.draft.title) ||
        body.includes(READING.draft.text)
      )
        failures.push(`${path}: the response contains article text`)
    }
    // Guard: the draft is in no public list.
    for (const path of [READING.home, READING.list, READING.writer]) {
      const body = await (await fetch(BASE_URL + path)).text()
      if (
        body.includes(READING.draft.title) ||
        body.includes(READING.draft.path)
      )
        failures.push(`${path}: the response names the unpublished article`)
    }
    // Guard: a page a package lists ends on that package's page, which
    // offers sign-in itself (signedOutLanding).
    const landing = SIGNED_OUT_LANDING.find(
      (entry) => entry.path === READING.signedIn.path
    )
    if (landing) {
      const browser = await chromium.launch()
      try {
        await checkLanding(browser, landing, failures)
      } finally {
        await browser.close()
      }
    }
    // Guard: a signed-in section still sends a signed-out reader to sign in.
    if (!landing) {
      const browser = await chromium.launch()
      try {
        const page = await browser.newPage()
        await page.goto(BASE_URL + READING.signedIn.path)
        await page
          .waitForURL((url) => url.pathname === READING.signedIn.signInPath, {
            timeout: 15_000,
          })
          .catch(() => {})
        const reached = new URL(page.url()).pathname
        console.log(`signed out ${READING.signedIn.path} -> ${reached}`)
        if (reached !== READING.signedIn.signInPath)
          failures.push(
            `${READING.signedIn.path}: signed out, ended at ${reached}, expected ${READING.signedIn.signInPath}`
          )
      } finally {
        await browser.close()
      }
    }
    for (const name of ENGINES) {
      const browser = await (name === 'webkit' ? webkit : chromium).launch()
      try {
        for (const mode of ['javascript off', 'scripts blocked'] as Mode[]) {
          const page = await newPage(browser, mode)
          const before = failures.length
          await check(page, failures, `${name}, ${mode}`, mode)
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
