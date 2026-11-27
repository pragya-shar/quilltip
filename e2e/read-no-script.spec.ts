import { expect, test } from '@playwright/test'
import {
  FIXTURE_ARTICLE_PATH,
  FIXTURE_WRITER,
} from '../scripts/perf/convex-fixture'

// The article view on a production build with JavaScript off (public pages must read without scripts), in
// Chromium and WebKit: the title, the byline and the full text are in the
// first response and readable; an unknown article is a real 404; the
// route's content security policy holds. Run by
// scripts/system/no-script-check.ts against the fixture backend.

test.skip(
  !process.env.NO_SCRIPT_CHECK,
  'Needs a production build (bun scripts/system/no-script-check.ts)'
)

const TITLE = 'The Lamp on Orchard Street'
const OPENING =
  'The lamp on Orchard Street came on every evening at a quarter past six'
const LAST =
  'Sometimes she thinks about writing to Ade again, just to say thank you properly'

test('the first response holds the title, the byline and the full text', async ({
  request,
}) => {
  const response = await request.get(FIXTURE_ARTICLE_PATH)
  expect(response.status()).toBe(200)
  const html = await response.text()
  const body = html.slice(html.indexOf('<body'))
  for (const text of [TITLE, 'Fixture Writer', OPENING, LAST])
    expect(body, text).toContain(text)
  // No streamed boundary that only a script reveals.
  expect(body).not.toContain('<template id="B:')
  expect(body).not.toContain('<div hidden id="S:')
  expect(html).toContain(`<link rel="canonical" href="https://`)
})

test('the article reads with no script, with plain links', async ({ page }) => {
  await page.goto(FIXTURE_ARTICLE_PATH)
  await expect(
    page.getByRole('heading', { level: 1, name: TITLE })
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Fixture Writer' })
  ).toHaveAttribute('href', `/${FIXTURE_WRITER}`)
  await expect(page.getByText(OPENING)).toBeVisible()
  await page.getByText(LAST).scrollIntoViewIfNeeded()
  await expect(page.getByText(LAST)).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Back to Today' })
  ).toHaveAttribute('href', '/')
  // No horizontal page scroll on a phone.
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(0)
})

for (const path of [
  `/${FIXTURE_WRITER}/no-such-article`,
  '/nobody-writes-here/an-article',
]) {
  test(`${path} is a real 404`, async ({ request }) => {
    const response = await request.get(path)
    expect(response.status()).toBe(404)
    expect(await response.text()).not.toContain(OPENING)
  })
}

test('the route sends a nonce policy and every script carries the nonce', async ({
  request,
}) => {
  const response = await request.get(FIXTURE_ARTICLE_PATH)
  const policy = response.headers()['content-security-policy'] ?? ''
  const scriptSrc = /script-src ([^;]+)/.exec(policy)?.[1] ?? ''
  const nonce = /'nonce-([^']+)'/.exec(scriptSrc)?.[1]
  expect(nonce, policy).toBeTruthy()
  expect(scriptSrc).not.toContain("'unsafe-inline'")
  const html = await response.text()
  const scripts = html.match(/<script\b[^>]*>/g) ?? []
  expect(scripts.length).toBeGreaterThan(0)
  for (const tag of scripts) expect(tag, tag).toContain(`nonce="${nonce}"`)
  // A second response gets a fresh nonce.
  const again = (await request.get(FIXTURE_ARTICLE_PATH)).headers()[
    'content-security-policy'
  ]
  expect(again).not.toContain(nonce!)
})

test('a paragraph anchor is in the HTML and lands with no script', async ({
  page,
  request,
}) => {
  const html = await (await request.get(FIXTURE_ARTICLE_PATH)).text()
  expect(html).toContain('<p id="s-0-0">')
  expect(html).toContain('<p id="s-12-0">')
  await page.goto(`${FIXTURE_ARTICLE_PATH}#s-12-0`)
  const top = await page.evaluate(
    () => document.getElementById('s-12-0')!.getBoundingClientRect().top
  )
  expect(top).toBeGreaterThanOrEqual(0)
  expect(top).toBeLessThan(120)
})
