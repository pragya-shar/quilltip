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
      page.getByRole('heading', { name: 'Core Features' })
    ).toBeVisible()

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

    const cases: {
      linkName: string
      hash: string
      heading: string | RegExp
      section: string
    }[] = [
      {
        linkName: 'Rich Editor',
        hash: '#features',
        heading: 'Core Features',
        section: '#features',
      },
      {
        linkName: 'Testnet Tips',
        hash: '#how-it-works',
        heading: /From idea to impact/,
        section: '#how-it-works',
      },
      {
        linkName: 'FAQ',
        hash: '#faq',
        heading: 'Frequently Asked Questions',
        section: '#faq',
      },
      {
        linkName: 'Security',
        hash: '#security',
        heading: 'Security on testnet',
        section: '#security',
      },
      {
        linkName: 'Arweave Storage',
        hash: '#arweave-storage',
        heading: 'Permanent storage with Arweave',
        section: '#arweave-storage',
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
      page.getByRole('heading', { name: 'Core Features' })
    ).toBeVisible()
    await assertRevealContentVisible(page, '#features')
  })
})

test.describe('landing how it works', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#how-it-works')
    await expect(
      page.getByRole('heading', { name: /From idea to impact/ })
    ).toBeVisible()
  })

  test('desktop step cards update selection and panel content', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })

    const writerSteps = page.getByRole('tablist', { name: 'Writer steps' })
    const write = writerSteps.getByRole('tab', { name: 'Write' })
    await write.click()

    await expect(write).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByText(
        'Full markdown support, code blocks, media embeds, and a distraction-free writing experience.'
      )
    ).toBeVisible()

    await page.getByRole('tab', { name: 'For Readers' }).click()
    const readerSteps = page.getByRole('tablist', { name: 'Reader steps' })
    const browse = readerSteps.getByRole('tab', { name: 'Browse' })
    await expect(browse).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByText(
        'All articles are free to read. Explore by topic, trending, or latest. No paywalls, ever.'
      )
    ).toBeVisible()
  })

  test('desktop step cards respond to ArrowRight keyboard navigation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })

    const writerSteps = page.getByRole('tablist', { name: 'Writer steps' })
    const signUp = writerSteps.getByRole('tab', { name: 'Sign Up' })
    await signUp.focus()
    await page.keyboard.press('ArrowRight')

    const write = writerSteps.getByRole('tab', { name: 'Write' })
    await expect(write).toBeFocused()
    await expect(write).toHaveAttribute('aria-selected', 'true')
  })

  test('mobile step cards update selection and panel content', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    const writerSteps = page.getByRole('tablist', { name: 'Writer steps' })
    const publish = writerSteps.getByRole('tab', { name: 'Publish' })
    await publish.click()

    await expect(publish).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByText(
        'Your article is stored permanently on Arweave. A tamper-proof record of your creative work, forever.'
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
