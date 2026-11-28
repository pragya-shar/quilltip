import { expect, test } from '@playwright/test'

// /signin and /signin/reset on a production build with JavaScript off: the
// server's own response says plainly that signing in needs JavaScript, with
// no form that cannot work; and the older sign-in pages redirect here with
// only a safe way back.

test.skip(
  !process.env.NO_SCRIPT_CHECK,
  'Needs a production build (bun scripts/app-checks/run.ts)'
)

for (const [path, heading, words] of [
  ['/signin', 'Sign in to Quilltip', 'Signing in needs JavaScript'],
  [
    '/signin/reset',
    'Choose a new password',
    'Resetting a password needs JavaScript',
  ],
] as const)
  test(`with no script, ${path} says it needs JavaScript`, async ({ page }) => {
    await page.goto(path)
    await expect(
      page.getByRole('heading', { level: 1, name: heading })
    ).toBeVisible()
    // Playwright's text engine skips <noscript>; read it by CSS.
    const note = page.locator('.qt-signin-page__noscript')
    await expect(note).toBeVisible()
    await expect(note).toContainText(words)
    await expect(page.locator('.qt-signin-page__live')).toBeHidden()
    await expect(page.locator('form:visible')).toHaveCount(0)
  })

test('the older sign-in pages redirect with only a safe way back', async ({
  request,
}) => {
  const location = async (path: string) =>
    (await request.get(path, { maxRedirects: 0 })).headers().location
  expect(await location('/login?next=%2Fshelf&x=1')).toBe(
    '/signin?returnTo=%2Fshelf'
  )
  expect(await location('/login?redirect=https%3A%2F%2Fevil.example')).toBe(
    '/signin'
  )
  expect(await location('/register?returnTo=%2Fwrite')).toBe(
    '/signin?mode=create&returnTo=%2Fwrite'
  )
  expect(await location('/forgot-password?next=%2Fa')).toBe(
    '/signin/reset?returnTo=%2Fa'
  )
})
