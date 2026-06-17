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
    await expect(
      page.getByRole('heading', { name: 'Why Quilltip' })
    ).toBeVisible()

    await scrollSectionIntoView(page, '#how-it-works')
    await expect(
      page.getByRole('heading', { name: 'How tipping works' })
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
    await page.getByRole('link', { name: 'FAQ' }).click()
    await page.waitForTimeout(900)
    await expect(
      page.getByRole('heading', { name: 'Frequently Asked Questions' })
    ).toBeVisible()
    await assertRevealContentVisible(page, '#faq')
  })

  test('mobile menu links reveal section content', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const cases: {
      linkName: string
      hash: string
      heading: string | RegExp
      section: string
    }[] = [
      {
        linkName: 'Rich Editor',
        hash: '#features',
        heading: 'Why Quilltip',
        section: '#features',
      },
      {
        linkName: 'How tipping works',
        hash: '#how-it-works',
        heading: 'How tipping works',
        section: '#how-it-works',
      },
      {
        linkName: 'FAQ',
        hash: '#faq',
        heading: 'Frequently Asked Questions',
        section: '#faq',
      },
    ]

    for (const { linkName, hash, heading, section } of cases) {
      await page.getByRole('button', { name: 'Toggle menu' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('link', { name: linkName }).click()
      await expect(page).toHaveURL(new RegExp(`${hash}$`))
      await expect(page.getByRole('dialog')).not.toBeVisible()
      await page.waitForTimeout(900)
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      await assertRevealContentVisible(page, section)
    }
  })

  test('mobile menu section links work from mid-page scroll position', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await scrollSectionIntoView(page, '#faq')
    await page.waitForTimeout(200)

    await page.getByRole('button', { name: 'Toggle menu' }).click()
    await page.getByRole('link', { name: 'Rich Editor' }).click()
    await expect(page).toHaveURL(/#features$/)
    await page.waitForTimeout(900)
    await expect(
      page.getByRole('heading', { name: 'Why Quilltip' })
    ).toBeVisible()
    await assertRevealContentVisible(page, '#features')
  })
})

test.describe('landing how it works', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#how-it-works')
    await expect(
      page.getByRole('heading', { name: 'How tipping works' })
    ).toBeVisible()
  })

  test('desktop accordion steps update selection and panel content', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })

    const steps = page.getByLabel('How it works steps')
    const tip = steps.getByRole('button', { name: 'Tip' })
    await tip.click()

    await expect(tip).toHaveAttribute('aria-expanded', 'true')
    await expect(
      page.getByText(
        "Install Freighter, fund with free testnet XLM, and send tips that settle in about 3 seconds."
      )
    ).toBeVisible()
  })

  test('desktop accordion steps toggle with Enter keyboard interaction', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })

    const steps = page.getByLabel('How it works steps')
    const browse = steps.getByRole('button', { name: 'Browse' })
    await browse.focus()
    await page.keyboard.press('Enter')

    await expect(browse).toHaveAttribute('aria-expanded', 'false')
  })

  test('mobile accordion steps update selection and panel content', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const steps = page.getByLabel('How it works steps')
    const publish = steps.getByRole('button', { name: 'Publish & earn' })
    await publish.click()

    await expect(publish).toHaveAttribute('aria-expanded', 'true')
    await expect(
      page.getByText(
        'Use the rich editor to publish your work. Tips go directly to your wallet with near-zero fees.'
      )
    ).toBeVisible()
  })
})

test.describe('home landing footer links', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Reward the words that move you' })
    ).toBeVisible()
  })

  test('footer includes trust and support destinations', async ({ page }) => {
    const footer = page.getByRole('navigation', { name: 'Footer' })
    await footer.scrollIntoViewIfNeeded()

    for (const label of [
      'Terms of Service',
      'Privacy Policy',
      'Help & Support',
      'Wallet Guide',
      'Contact',
      'Platform Status',
    ]) {
      await expect(footer.getByRole('link', { name: label })).toBeVisible()
    }
  })
})
