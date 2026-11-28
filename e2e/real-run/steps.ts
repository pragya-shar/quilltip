/**
 * Setup steps of the real run, through the app's own flows: sign-up, the
 * wallet link (the test wallet signs), the writer's article and its
 * on-chain registration, the reader's balance. Each step checks the page
 * before it acts, so a re-run continues where the last one stopped.
 */
import type { Page } from '@playwright/test'
import type { Account } from './lib'

export async function signUpOrIn(page: Page, account: Account) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: /^(Log in|Sign in)$/ }).click()
  const signedIn = await page
    .waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 30_000,
    })
    .then(() => true)
    .catch(() => false)
  if (signedIn) return 'signed-in'
  await page.goto('/register')
  await page.getByLabel('Your name').fill(account.name)
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/register'), {
    timeout: 30_000,
  })
  return 'registered'
}
