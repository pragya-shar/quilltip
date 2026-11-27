/**
 * Test account logins for the Playwright real-run cases (KEY=value lines in
 * the local accounts file). Kept apart from `lib.ts`, which is an ES
 * module the Playwright loader cannot read.
 */
import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

export function testLogin(file: string, role: 'READER' | 'WRITER') {
  const env: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) env[match[1]!] = match[2]!.replace(/^(["'])(.*)\1$/, '$2')
  }
  return {
    email: env[`SLICE_${role}_EMAIL`]!,
    password: env[`SLICE_${role}_PASSWORD`]!,
  }
}

/**
 * Signs in and lands on /articles before any protected route (a sign-in on
 * the way to a protected URL bounces back to /login: issue 575).
 */
export async function signInViaArticles(
  page: Page,
  login: { email: string; password: string }
) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(login.email)
  await page.getByLabel('Password', { exact: true }).fill(login.password)
  await page.getByRole('button', { name: /^(Log in|Sign in)$/ }).tap()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
    timeout: 30_000,
  })
  await page.goto('/articles')
  await expect(page.getByRole('link', { name: /^Log in$/ })).toHaveCount(0, {
    timeout: 30_000,
  })
}
