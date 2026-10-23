import { test, expect } from '@playwright/test'

test.describe('current landing navigation and footer', () => {
  test.use({ reducedMotion: 'reduce' })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Value for writing', exact: true })
    ).toBeVisible()
  })

  test('desktop navigation preserves reading, library, writing and auth destinations', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const navigation = page.getByRole('navigation', {
      name: 'Main navigation',
      exact: true,
    })
    for (const [name, href] of [
      ['Articles', '/articles'],
      ['Your library', '/library'],
      ['Writing desk', '/write'],
      ['Log in', '/login'],
      ['Sign up', '/register'],
    ] as const) {
      const link = navigation.getByRole('link', { name, exact: true })
      await expect(link).toBeVisible()
      await expect(link).toHaveAttribute('href', href)
    }
  })

  for (const width of [375, 390, 1280]) {
    test(`landing footer preserves active destinations and fits at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 844 })
      const footer = page.getByRole('contentinfo')
      await footer.scrollIntoViewIfNeeded()
      for (const [name, href] of [
        ['Read', '/articles'],
        ['Write', '/write'],
        ['How it works', '/#try-it'],
        ['Questions', '/#questions'],
        ['Support', '/support'],
        ['Contact', '/contact'],
        ['Privacy', '/privacy'],
        ['Terms', '/terms'],
      ] as const) {
        const link = footer.getByRole('link', { name, exact: true })
        await expect(link).toBeVisible()
        await expect(link).toHaveAttribute('href', href)
      }
      await expect(
        footer.getByRole('link', { name: 'Wallet & Stellar demo', exact: true })
      ).toHaveAttribute('href', '/wallet/practice?returnTo=%2F%23try-it')
      await expect(
        footer.locator('a[href="/status"], a[href="/guide"]')
      ).toHaveCount(0)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual(width)
      await page.screenshot({
        path: testInfo.outputPath(`landing-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      })
    })
  }

  for (const width of [390, 1280]) {
    test(`footer section links reveal the reading sample and questions at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 })
      const footer = page.getByRole('contentinfo')
      await footer
        .getByRole('link', { name: 'How it works', exact: true })
        .click()
      await expect(page).toHaveURL(/\/#try-it$/)
      await expect(
        page.getByRole('heading', { name: 'The words we carry', exact: true })
      ).toBeInViewport()
      await footer.getByRole('link', { name: 'Questions', exact: true }).click()
      await expect(page).toHaveURL(/\/#questions$/)
      await expect(
        page.getByRole('heading', { name: 'A few questions.', exact: true })
      ).toBeInViewport()
    })
  }
})
