import { test, expect } from '@playwright/test'

async function scrollSectionIntoView(
  page: import('@playwright/test').Page,
  selector: string
) {
  const section = page.locator(selector).first()
  await section.scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
}

async function assertRevealContentVisible(
  page: import('@playwright/test').Page,
  selector: string
) {
  const section = page.locator(selector).first()
  await expect(section).toBeVisible()
  const reveal = section.locator('[data-reveal]').first()
  await expect(reveal).toBeVisible()
  await expect(reveal).toHaveCSS('opacity', /^(?!0$)/)
}

test.describe('home landing visual regression', () => {
  test.setTimeout(90_000)

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Reward the words that move you' })
    ).toBeVisible()
  })

  test('full page screenshot', async ({ page }) => {
    await scrollSectionIntoView(page, '#features')
    await expect(page.getByRole('heading', { name: 'Core Features' })).toBeVisible()

    await scrollSectionIntoView(page, '#how-it-works')
    await expect(
      page.getByRole('heading', { name: /From idea to impact/ })
    ).toBeVisible()

    await scrollSectionIntoView(page, '#security')
    await expect(
      page.getByRole('heading', { name: 'Security on testnet' })
    ).toBeVisible()

    await scrollSectionIntoView(page, '#faq')
    await expect(
      page.getByRole('heading', { name: 'Frequently Asked Questions' })
    ).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)

    const snapshotName = `home-full-${test.info().project.name}.png`
    await expect(page).toHaveScreenshot(snapshotName, {
      fullPage: true,
      animations: 'disabled',
      timeout: 60_000,
    })
  })
})

test.describe('landing nav hash navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Reward the words that move you' })
    ).toBeVisible()
  })

  test('desktop menu links reveal section content', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'desktop nav only')

    await page.getByRole('button', { name: 'Product' }).click()
    await page.getByRole('link', { name: 'Rich Editor' }).click()
    await page.waitForTimeout(900)
    await assertRevealContentVisible(page, '#features')

    await page.getByRole('button', { name: 'Resources' }).click()
    await page.getByRole('link', { name: 'Security' }).click()
    await page.waitForTimeout(900)
    await expect(
      page.getByRole('heading', { name: 'Security on testnet' })
    ).toBeVisible()
    await assertRevealContentVisible(page, '#security')
  })

  test('mobile menu links reveal section content', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    await page.getByRole('button', { name: 'Toggle menu' }).click()
    await page.getByRole('link', { name: 'Testnet Tips' }).click()
    await page.waitForTimeout(900)
    await assertRevealContentVisible(page, '#how-it-works')

    await page.getByRole('button', { name: 'Toggle menu' }).click()
    await page.getByRole('link', { name: 'FAQ' }).click()
    await page.waitForTimeout(900)
    await expect(
      page.getByRole('heading', { name: 'Frequently Asked Questions' })
    ).toBeVisible()
    await assertRevealContentVisible(page, '#faq')

    await page.getByRole('button', { name: 'Toggle menu' }).click()
    await page.getByRole('link', { name: 'Arweave Storage' }).click()
    await page.waitForTimeout(900)
    await expect(
      page.getByRole('heading', { name: 'Permanent storage with Arweave' })
    ).toBeVisible()
    await assertRevealContentVisible(page, '#arweave-storage')
  })
})
