import { expect, test } from '@playwright/test'

// /pocket with JavaScript off (e2e/fixtures/pocket serves the page's
// server HTML at /pocket-no-script): who is here is known only after a
// script runs, so the page asks to sign in, and holds no skeleton that
// would never fill.

test.skip(
  !process.env.POCKET_FIXTURES,
  'Needs the Pocket fixture server (bun run test:e2e:fixtures --suite pocket)'
)

test('with no script, /pocket asks to sign in and shows no figures', async ({
  page,
}) => {
  await page.goto('/pocket-no-script')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Balance' })
  ).toBeVisible()
  const prompt = page.locator(
    '[data-session-switch] > [data-when="signed-out"]'
  )
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('Sign in to tip and keep your lines.')
  await expect(prompt.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/login'
  )
  await expect(
    page.locator('[data-session-switch] > [data-when="held"]')
  ).toBeHidden()
  await expect(
    page.locator('.qt-skeleton:visible, [data-skeleton]:visible')
  ).toHaveCount(0)
  expect(await page.locator('main').innerText()).not.toMatch(/\$\s?\d/)
  expect(await page.locator('main').innerText()).not.toContain('Ready to tip')
})
