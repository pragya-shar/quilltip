import { test, expect } from '@playwright/test'

test('mobile menu close control has a touch-sized target', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/support')
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  const close = page.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toBeVisible()
  const bounds = await close.boundingBox()
  expect(bounds?.width).toBeGreaterThanOrEqual(44)
  expect(bounds?.height).toBeGreaterThanOrEqual(44)
})

for (const width of [375, 390]) {
  test(`guest menu supports keyboard, focus return and navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/privacy')
    const trigger = page.getByRole('button', { name: 'Open navigation menu' })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Find your way' })
    await expect(dialog).toBeVisible()
    for (const label of [
      'Articles',
      'Your library',
      'Writing desk',
      'Log in',
      'Sign up',
      'Help & support',
    ]) {
      await expect(
        dialog.getByRole('link', { name: label, exact: true })
      ).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await trigger.press('Enter')
    await expect(dialog).toBeVisible()
    await dialog
      .getByRole('link', { name: 'Help & support', exact: true })
      .click()
    await expect(page).toHaveURL(/\/support$/)
    await expect(dialog).toBeHidden()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width)
  })
}

for (const path of ['/support', '/contact', '/privacy', '/terms']) {
  test(`guest ${path} uses shared branding and active footer destinations`, async ({
    page,
  }) => {
    await page.goto(path)
    const navigation = page.getByRole('navigation', {
      name: 'Main navigation',
      exact: true,
    })
    await expect(
      navigation.getByRole('link', { name: 'Log in', exact: true })
    ).toBeVisible()
    await expect(
      navigation.getByRole('link', { name: 'Sign up', exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Product', exact: true })
    ).toHaveCount(0)
    await expect(
      navigation.getByRole('button', { name: /Switch to (dark|light) mode/ })
    ).toBeVisible()
    expect(
      await page
        .locator('.app-site-header-inner')
        .evaluate((element) => element.getBoundingClientRect().height)
    ).toBe(64)
    const footer = page.getByRole('navigation', { name: 'Footer', exact: true })
    for (const [label, href] of [
      ['Help & Support', '/support'],
      ['Wallet & Stellar demo', '/wallet/practice'],
      ['Terms of Service', '/terms'],
      ['Privacy Policy', '/privacy'],
      ['Contact', '/contact'],
    ]) {
      await expect(
        footer.getByRole('link', { name: label, exact: true })
      ).toHaveAttribute('href', href!)
    }
    await expect(
      footer.locator('a[href="/status"], a[href="/guide"]')
    ).toHaveCount(0)
    for (const width of [375, 390, 900, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual(width)
    }
  })
}

test('status redirects to wallet practice while network guidance remains available', async ({
  page,
}) => {
  await page.goto('/status')
  await expect(page).toHaveURL(/\/wallet\/practice$/)
  await expect(
    page.getByRole('heading', {
      name: 'Try your first wallet transfer.',
      exact: true,
    })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Platform Status', exact: true })
  ).toHaveCount(0)
  await page.goto('/support')
  await expect(
    page.getByRole('heading', { name: 'Help & Support', exact: true })
  ).toBeVisible()
  await expect(
    page.getByText(
      'Quilltip runs on Stellar testnet. Tips use free test XLM for practice—not real money.',
      { exact: true }
    )
  ).toBeVisible()
})

test('legacy guide reaches public wallet help and installation preserves the task', async ({
  page,
}) => {
  await page.goto('/guide')
  await expect(page).toHaveURL(/\/wallet\/practice#wallet-help$/)
  await expect(
    page.getByText(
      'Reading is free. A wallet is only needed to send or receive tips.',
      { exact: true }
    )
  ).toBeVisible()
  const trigger = page.getByRole('button', {
    name: 'Choose a Stellar wallet',
    exact: true,
  })
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await trigger.click()
    const dialog = page.getByRole('dialog', {
      name: 'Make room for a little appreciation.',
    })
    await expect(dialog).toBeVisible()
    for (const name of [
      'Freighter Open store',
      'xBull Open store',
      'Albedo Requires HTTPS for some flows Open store',
      'HOT Wallet Open store',
    ]) {
      const link = dialog.getByRole('link', { name, exact: true })
      await expect(link).toHaveAttribute('target', '_blank')
      await expect(link).toHaveAttribute(
        'href',
        /^https:\/\/chrome(webstore)?\.google\.com\//
      )
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width)
    const bounds = await dialog.boundingBox()
    expect(bounds!.width).toBeLessThanOrEqual(width)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await expect(page).toHaveURL(/\/wallet\/practice#wallet-help$/)
  }
})
