/**
 * Known failure, kept as an expected failure: a reader who signs in on the
 * way to a protected money screen is sent back to /login (issue 575). The
 * login form returns to the protected URL as soon as sign-in resolves, before
 * the client reports the new session, and the dashboard guard redirects.
 * When issue 575 is fixed this case passes, Playwright reports it as an
 * unexpected pass, and the `test.fail` line comes out.
 */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

/** The reader's login from the slice accounts file (KEY=value lines). */
function readerLogin(file: string) {
  const env: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) env[match[1]!] = match[2]!.replace(/^(["'])(.*)\1$/, '$2')
  }
  return {
    email: env.SLICE_READER_EMAIL!,
    password: env.SLICE_READER_PASSWORD!,
  }
}

test('a reader who signs in on the way to the balance screen stays on it', async ({
  page,
}) => {
  test.fail(
    true,
    'Issue 575: the sign-in redirect lands before the session settles.'
  )
  const reader = readerLogin(process.env.REAL_RUN_ACCOUNTS!)
  await page.goto('/dashboard/balance')
  await page.waitForURL(/\/login/, { timeout: 30_000 })
  await page.getByLabel('Email', { exact: true }).fill(reader.email)
  await page.getByLabel('Password', { exact: true }).fill(reader.password)
  await page.getByRole('button', { name: /^(Log in|Sign in)$/ }).tap()
  await page
    .waitForURL((u) => u.pathname === '/dashboard/balance', {
      timeout: 30_000,
    })
    .catch(() => {})
  await page.waitForTimeout(8_000)
  await expect(page).toHaveURL(/\/dashboard\/balance$/)
  await expect(page.getByTestId('balance-screen')).toBeVisible()
})
