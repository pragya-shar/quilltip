import { expect, test } from '@playwright/test'

// Waitlist checks run without an account. Submitting stores a row, so the
// submit step runs only when PLAYWRIGHT_ALLOW_WRITES=1 against a local or
// development backend. Feedback needs a disposable development QA account.
const email = process.env.PLAYWRIGHT_QA_EMAIL
const password = process.env.PLAYWRIGHT_QA_PASSWORD

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test.describe(`Beta programme at ${viewport.width}px`, () => {
    test.use({ viewport })

    test('waitlist validates late, hides the honeypot and fits the screen', async ({
      page,
    }) => {
      await page.goto('/waitlist')
      await expect(
        page.getByRole('heading', { level: 1, name: 'Join the beta.' })
      ).toBeVisible()
      await expect(page.getByLabel('Website')).toHaveCount(1)
      await expect(page.getByLabel('Website')).not.toBeInViewport()

      const field = page.getByLabel('Email', { exact: true })
      await field.fill('reader@')
      await expect(page.getByText('Enter a valid email address.')).toHaveCount(
        0
      )
      await page.getByRole('button', { name: 'Join the waitlist' }).click()
      await expect(page.getByText('Enter a valid email address.')).toBeVisible()
      await expect(field).toBeFocused()
      await expect(field).toHaveAttribute('aria-invalid', 'true')

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true)

      test.skip(!process.env.PLAYWRIGHT_ALLOW_WRITES, 'Read-only run.')
      await field.fill(`qa+${Date.now()}@example.test`)
      await page.waitForTimeout(2_100)
      await page.getByRole('button', { name: 'Join the waitlist' }).click()
      await expect(
        page.getByRole('heading', { name: 'Thanks. You’re on the list.' })
      ).toBeFocused()
    })

    test('feedback form is keyboard usable', async ({ page }) => {
      test.skip(
        !email || !password,
        'Requires a disposable development QA account.'
      )
      await page.goto('/signin')
      await page.getByLabel('Email', { exact: true }).fill(email!)
      await page.getByLabel('Password', { exact: true }).fill(password!)
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.waitForURL((url) => url.pathname !== '/signin')
      await page.goto('/dashboard/feedback')
      await expect(
        page.getByRole('link', { name: 'Feedback' })
      ).toHaveAttribute('aria-current', 'page')
      await page.getByLabel('An idea or request').check()
      const message = page.getByLabel('Tell us more')
      await message.fill('short')
      await page.getByRole('button', { name: 'Send feedback' }).click()
      await expect(page.getByText(/at least 10 characters/)).toBeVisible()
      await expect(message).toBeFocused()
      test.skip(!process.env.PLAYWRIGHT_ALLOW_WRITES, 'Read-only run.')
      await message.fill('Playwright check: the feedback form works.')
      await message.press('ControlOrMeta+Enter')
      await expect(
        page.getByRole('heading', { name: 'Thanks. We read every message.' })
      ).toBeFocused()
    })
  })
}
