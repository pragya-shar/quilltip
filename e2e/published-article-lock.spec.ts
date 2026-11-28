import { expect, test } from '@playwright/test'

// Needs a disposable development QA account with at least one published
// article. Set PLAYWRIGHT_PUBLISHED_ARTICLE_ID to that article's id to also
// check the read-only editor state.
const email = process.env.PLAYWRIGHT_QA_EMAIL
const password = process.env.PLAYWRIGHT_QA_PASSWORD
const publishedId = process.env.PLAYWRIGHT_PUBLISHED_ARTICLE_ID

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test.describe(`Published article lock at ${viewport.width}px`, () => {
    test.use({ viewport })
    test.skip(
      !email || !password,
      'Requires a disposable development QA account.'
    )

    test.beforeEach(async ({ page }) => {
      await page.goto('/login')
      await page.getByLabel('Email', { exact: true }).fill(email!)
      await page.getByLabel('Password', { exact: true }).fill(password!)
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      await page.waitForURL((url) => url.pathname !== '/login')
    })

    test('the writing desk offers no edit link for published articles', async ({
      page,
    }) => {
      await page.goto('/write?desk=writing')
      const desk = page.getByRole('dialog', { name: 'Your writing' })
      const rows = desk.locator('.publication-row')
      await expect(desk.getByText(/can.t be changed or deleted/)).toBeVisible()
      await expect(rows.getByRole('link', { name: 'Edit' })).toHaveCount(0)
    })

    test('opening a published article shows it read-only', async ({ page }) => {
      test.skip(!publishedId, 'Set PLAYWRIGHT_PUBLISHED_ARTICLE_ID.')
      await page.goto(`/write?id=${encodeURIComponent(publishedId!)}`)
      await expect(
        page.getByRole('heading', {
          name: 'This article is published and can’t be changed.',
        })
      ).toBeVisible()
      await expect(page.getByRole('textbox')).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: 'Save draft' })
      ).toHaveCount(0)
      const link = page.getByRole('link', { name: 'View article' })
      await link.focus()
      await expect(link).toBeFocused()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true)
    })
  })
}
