import { expect, test } from '@playwright/test'

// /signin with JavaScript off (e2e/fixtures/signin serves the real route's
// server HTML at /signin-no-script): a real page that says plainly that
// signing in needs JavaScript, with no form that cannot work.

test.skip(
  !process.env.SIGNIN_FIXTURES,
  'Needs the sign-in fixture server (bun run test:e2e:fixtures --suite signin)'
)

test('with no script, /signin says signing in needs JavaScript', async ({
  page,
}) => {
  await page.goto('/signin-no-script?returnTo=%2Farticle')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in to Quilltip' })
  ).toBeVisible()
  // Playwright's text engine skips <noscript>; read it by CSS.
  const note = page.locator('.qt-signin-page__noscript')
  await expect(note).toBeVisible()
  await expect(note).toContainText('Signing in needs JavaScript')
  await expect(page.locator('.qt-signin-page__live')).toBeHidden()
  await expect(page.locator('form:visible')).toHaveCount(0)
})
