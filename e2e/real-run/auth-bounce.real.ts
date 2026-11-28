/**
 * Known failure, kept as an expected failure: a reader who signs in on the
 * way to a protected money screen is sent back to /login (issue 575). The
 * login form returns to the protected URL as soon as sign-in resolves, before
 * the client reports the new session, and the dashboard guard redirects.
 * The bounce is a race (WebKit misses it now and then), so the case signs in
 * three times in fresh contexts and expects every one to stay. When issue
 * 575 is fixed this case passes, Playwright reports an unexpected pass, and
 * the `test.fail` line comes out.
 */
import { expect, test } from '@playwright/test'
import { testLogin } from './login'

test('a reader who signs in on the way to the balance screen stays on it', async ({
  browser,
}, info) => {
  test.fail(
    true,
    'Issue 575: the sign-in redirect lands before the session settles.'
  )
  test.setTimeout(180_000)
  const reader = testLogin(process.env.REAL_RUN_ACCOUNTS!, 'READER')
  const stayed: boolean[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    const context = await browser.newContext(info.project.use)
    const page = await context.newPage()
    await page.goto('/dashboard/balance')
    await page.waitForURL(/\/(login|signin)/, { timeout: 30_000 })
    await page.getByLabel('Email', { exact: true }).fill(reader.email)
    await page.getByLabel('Password', { exact: true }).fill(reader.password)
    await page.getByRole('button', { name: /^(Log in|Sign in)$/ }).tap()
    await page
      .waitForURL((u) => u.pathname === '/dashboard/balance', {
        timeout: 30_000,
      })
      .catch(() => {})
    await page.waitForTimeout(8_000)
    stayed.push(
      new URL(page.url()).pathname === '/dashboard/balance' &&
        (await page.getByTestId('balance-screen').isVisible())
    )
    await context.close()
  }
  expect(stayed).toEqual([true, true, true])
})
