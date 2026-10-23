import { test, expect } from '@playwright/test'

for (const width of [390, 1280]) {
  test(`support resources and private reporting remain accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/support')
    const main = page.getByRole('main')
    const resources = main.getByRole('navigation', { name: 'Quick links' })
    await expect(
      resources.getByRole('link', { name: 'GitHub Issues', exact: true })
    ).toHaveAttribute('href', 'https://github.com/pragya-shar/quilltip/issues')
    await expect(
      main.getByRole('link', { name: 'security@quilltip.me', exact: true })
    ).toHaveAttribute('href', 'mailto:security@quilltip.me')
    await expect(
      main.getByText(/Do not post security vulnerabilities/)
    ).toBeVisible()
    await expect(main.locator('a[href="/guide"]')).toHaveCount(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width)

    await resources
      .getByRole('link', { name: 'Wallet setup and practice' })
      .click()
    await expect(page).toHaveURL(/\/wallet\/practice#wallet-help$/)
    await expect(
      page.getByText(
        'Reading is free. A wallet is only needed to send or receive tips.',
        { exact: true }
      )
    ).toBeVisible()

    await page.goBack()
    await resources.getByRole('link', { name: 'FAQ on homepage' }).click()
    await expect(page).toHaveURL(/\/#faq$/)
    await expect(
      page.getByRole('heading', { name: 'A few questions.', exact: true })
    ).toBeInViewport()

    await page.goBack()
    await main
      .getByRole('link', { name: 'Contact the team', exact: true })
      .click()
    await expect(page).toHaveURL(/\/contact$/)
    await expect(
      main.getByRole('heading', { name: 'Contact', exact: true })
    ).toBeVisible()
  })

  test(`contact preserves selectable email destinations and section navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/contact')
    const main = page.getByRole('main')
    for (const email of ['legal@quilltip.me', 'security@quilltip.me']) {
      const link = main.getByRole('link', { name: email, exact: true })
      await expect(link).toHaveAttribute('href', `mailto:${email}`)
      await expect(link).toHaveText(email)
      const bounds = await link.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(bounds!.height).toBeGreaterThanOrEqual(44)
    }
    const security = main
      .getByRole('navigation', { name: 'On this page' })
      .getByRole('link', { name: 'Security reports' })
    await security.press('Enter')
    await expect(page).toHaveURL(/\/contact#security$/)
    await expect(
      main.getByRole('heading', { name: 'Security reports', exact: true })
    ).toBeInViewport()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width)
  })
}
