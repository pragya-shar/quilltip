import { expect, test } from '@playwright/test'

// /pocket on a production build with JavaScript off: the server's own
// response explains itself and links to sign in, with no money and no
// placeholder that never fills; and the legacy dashboard paths that only
// forwarded to the stats page answer 308 to the balance.

test.skip(
  !process.env.NO_SCRIPT_CHECK,
  'Needs a production build (bun scripts/app-checks/run.ts)'
)

test('the first response of /pocket explains itself and links to sign in', async ({
  request,
}) => {
  const response = await request.get('/pocket')
  expect(response.status()).toBe(200)
  const html = await response.text()
  expect(html).toContain('<noscript>')
  expect(html).toContain('show here when JavaScript is on')
  expect(html).toContain('href="/login"')
  expect(html).not.toContain('Ready to tip')
  expect(html).not.toMatch(/Pocket</)
})

test('with no script, /pocket shows its title, the explanation and Sign in', async ({
  page,
}) => {
  await page.goto('/pocket')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Balance' })
  ).toBeVisible()
  // Playwright's text and role engines skip <noscript>; the browser draws it
  // with scripts off, so these read it by CSS.
  const note = page.locator('.qt-pocket-page__noscript')
  await expect(note).toBeVisible()
  await expect(note.locator('a.qt-button')).toHaveAttribute('href', '/login')
  await expect(page.locator('.qt-pocket-page__live')).toBeHidden()
  expect(await page.locator('main').innerText()).not.toMatch(/\$\s?\d/)
})

for (const from of ['/dashboard', '/dashboard/earnings'])
  test(`${from} answers 308 to the balance`, async ({ request }) => {
    const response = await request.get(from, { maxRedirects: 0 })
    expect(response.status()).toBe(308)
    expect(new URL(response.headers()['location']!, 'http://x').pathname).toBe(
      '/pocket'
    )
  })
