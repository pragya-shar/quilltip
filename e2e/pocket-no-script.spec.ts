import { expect, test } from '@playwright/test'

// /pocket with JavaScript off (e2e/fixtures/pocket serves the page's
// server HTML at /pocket-no-script): it explains itself and links to sign
// in, and holds no skeleton that would never fill.

test.skip(
  !process.env.POCKET_FIXTURES,
  'Needs the Pocket fixture server (bun run test:e2e:fixtures --suite pocket)'
)

test('with no script, /pocket explains itself and links to sign in', async ({
  page,
}) => {
  await page.goto('/pocket-no-script')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Balance' })
  ).toBeVisible()
  // Playwright's text and role engines skip <noscript>; the browser draws
  // it with scripts off, so these read it by CSS.
  const note = page.locator('.qt-pocket-page__noscript')
  await expect(note).toBeVisible()
  await expect(note).toContainText('show here when JavaScript is on')
  await expect(note).toContainText('Testnet. Practice money only.')
  await expect(note.locator('a.qt-button')).toHaveText('Sign in')
  await expect(note.locator('a.qt-button')).toHaveAttribute('href', '/login')
  await expect(page.locator('.qt-pocket-page__live')).toBeHidden()
  await expect(
    page.locator('.qt-skeleton:visible, [data-skeleton]:visible')
  ).toHaveCount(0)
  expect(await page.locator('main').innerText()).not.toMatch(/\$\s?\d/)
  expect(await page.locator('main').innerText()).not.toContain('Ready to tip')
})
