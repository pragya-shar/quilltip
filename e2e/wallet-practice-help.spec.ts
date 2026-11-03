import { expect, test } from '@playwright/test'

for (const [width, height] of [
  [1440, 1000],
  [390, 844],
] as const) {
  test(`wallet help stays in the practice card at ${width}×${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/wallet/practice?returnTo=%2Fchris%2Funtitled')
    const connect = page.getByRole('button', { name: 'Connect xBull' })
    const wallet = page.getByRole('button', { name: 'xBull', exact: true })
    await wallet.click()
    const card = page.locator('.practice-slip')
    const summary = card.getByText('Need help connecting?', { exact: true })
    const install = card.getByRole('button', {
      name: 'Choose a Stellar wallet',
    })
    await expect(install).toBeHidden()

    await connect.focus()
    await page.keyboard.press('Tab')
    await expect(summary).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(summary).toBeFocused()
    await expect(install).toBeVisible()
    await expect(wallet).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('link', { name: 'Back to your article' })
    ).toHaveAttribute('href', '/chris/untitled')
    await page.keyboard.press('Space')
    await expect(install).toBeHidden()
    await expect(connect).toBeVisible()
  })
}

test('a help fragment reveals practice from sample mode', async ({ page }) => {
  await page.goto('/wallet/practice?wallet=sample')
  await expect(
    page.getByRole('heading', { name: 'Sample tipping · no wallet needed' })
  ).toBeVisible()
  await page.evaluate(() => {
    location.hash = 'wallet-help'
  })
  const summary = page.locator('.practice-slip summary')
  await expect(summary).toBeFocused()
  await expect(
    page.getByRole('button', { name: 'Choose a Stellar wallet' })
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Explore sample tipping instead ↗' })
    .click()
  await expect(page).not.toHaveURL(/#wallet-help$/)
})
