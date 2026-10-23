import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'

// Opt in against a development backend: this flow creates a real QA account.
test.describe('sign-up without the retired intent chooser', () => {
  test.skip(
    process.env.PLAYWRIGHT_TEST_SIGNUP !== '1',
    'Set PLAYWRIGHT_TEST_SIGNUP=1 with a development Convex backend.'
  )
  test.use({ reducedMotion: 'reduce' })

  test('new and returning incomplete accounts can read, write and practice from home', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto('/register', { waitUntil: 'networkidle' })
    await page
      .getByLabel('Your name', { exact: true })
      .fill('Intent chooser QA')
    await page
      .getByLabel('Email', { exact: true })
      .fill(`intent-chooser-${randomUUID()}@example.com`)
    await page
      .getByLabel('Password', { exact: true })
      .fill(`Qa1!${randomUUID()}`)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/\/$/)

    const account = page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Account', exact: true })
    await expect(account).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Value for writing', exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole('radiogroup', { name: 'Choose where to start' })
    ).toHaveCount(0)

    // The account still has no onboarding-completed flag after a fresh session.
    await page.reload()
    await expect(account).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Value for writing', exact: true })
    ).toBeVisible()

    const footer = page.getByRole('contentinfo')
    await footer.getByRole('link', { name: 'Read', exact: true }).click()
    await expect(page).toHaveURL(/\/articles$/)
    await expect(page.getByRole('main')).toBeVisible()
    await page.goto('/')
    await footer.getByRole('link', { name: 'Write', exact: true }).click()
    await expect(page).toHaveURL(/\/write$/)
    await expect(page.getByRole('main')).toBeVisible()
    await page.goto('/')
    await footer
      .getByRole('link', { name: 'Wallet & Stellar demo', exact: true })
      .click()
    await expect(page).toHaveURL(/\/wallet\/practice\?returnTo=%2F%23try-it$/)
    await expect(
      page.getByRole('heading', { name: 'Try your first wallet transfer.' })
    ).toBeVisible()
  })
})
