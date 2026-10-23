import { test, expect } from '@playwright/test'

const missingWriter =
  'quilltip_missing_writer_' + 'abcdefghijklmnopqrstuvwxyz_'.repeat(3)

test('unknown routes retain home and reading-room recovery', async ({
  page,
}) => {
  await page.goto('/qa-missing-route/deep/path')
  await expect(
    page.getByRole('heading', { name: 'This page is missing.' })
  ).toBeVisible()
  await page.getByRole('link', { name: 'Go home', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByRole('heading', { name: 'Value for writing', exact: true })
  ).toBeVisible()
  await page.goto('/qa-missing-route/deep/path')
  await page.getByRole('link', { name: 'Browse articles', exact: true }).click()
  await expect(page).toHaveURL(/\/articles$/)
  await expect(page.getByRole('heading', { name: 'Story time.' })).toBeVisible()
})

for (const width of [320, 1280]) {
  test(`missing writer wraps long usernames and preserves search at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/${missingWriter}`)
    await expect(
      page.getByRole('heading', { name: 'Profile unavailable' })
    ).toBeVisible()
    await expect(
      page.getByText(`@${missingWriter}`, { exact: true })
    ).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width)
    const search = page.getByLabel('Search for articles', { exact: true })
    await search.fill('Ancient & history')
    await expect(page).toHaveURL(
      /\/articles\?search=Ancient%20%26%20history&page=1$/
    )
    await expect(
      page.getByRole('searchbox', { name: 'Search articles', exact: true })
    ).toHaveValue('Ancient & history')
  })
}
