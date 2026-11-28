import { test, expect, type Page } from '@playwright/test'

import { installVarialEmulator } from './helpers/varialEmulator'

/**
 * A failed load of the tip form's code (#669): offline, or a deploy that
 * replaced the chunk. The article stays, the dialog says the form could not
 * load, and "Try again" loads it. Runs on the v2 tip fixture built with code
 * splitting (e2e/fixtures/tips-v2/server-split.mjs).
 */
const UNUSED = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'

async function openOffline(page: Page) {
  await page.addInitScript(installVarialEmulator, {
    mode: 'connected' as const,
    address: UNUSED,
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tip article' })).toBeVisible()
  // From here no new chunk loads: the reader is offline.
  const failed: string[] = []
  await page.route('**/chunk-*.js', (route) => {
    failed.push(new URL(route.request().url()).pathname)
    return route.abort('internetdisconnected')
  })
  return failed
}

test('a tip form that fails to load leaves the article, and Try again loads it', async ({
  page,
}) => {
  const failed = await openOffline(page)
  await page.getByRole('button', { name: 'Tip article' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tip this article' })
  const alert = dialog.getByRole('alert')
  await expect(alert).toContainText('The tip form couldn’t load')
  await expect(alert).toContainText('Nothing was sent.')
  expect(failed.length).toBeGreaterThan(0)
  // The article is still on the page (the open dialog hides it from the
  // accessibility tree, so by text and tag).
  await expect(page.getByText(/^Opening line\./)).toBeVisible()
  await expect(page.locator('h1')).toBeVisible()

  await page.unroute('**/chunk-*.js')
  await dialog.getByRole('button', { name: 'Try again' }).click()
  await expect(dialog.getByLabel('Other amount')).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  // Focus stays in the dialog after the retry.
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]')
    )
  ).toBe(true)
})

test('tip buttons that fail to load at page load leave the article, and Try again brings them back', async ({
  page,
}) => {
  await page.addInitScript(installVarialEmulator, {
    mode: 'connected' as const,
    address: UNUSED,
  })
  // Offline before the page renders: the tip buttons' own code never loads.
  const failed: string[] = []
  await page.route('**/chunk-*.js', (route) => {
    failed.push(new URL(route.request().url()).pathname)
    return route.abort('internetdisconnected')
  })
  await page.goto('/')
  await expect(page.locator('h1')).toBeVisible()
  await expect(page.getByText(/^Opening line\./)).toBeVisible()
  const notices = page
    .getByRole('alert')
    .filter({ hasText: 'Tips couldn’t load.' })
  await expect(notices.first()).toBeVisible()
  expect(failed.length).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: 'Tip article' })).toHaveCount(0)

  await page.unroute('**/chunk-*.js')
  // Each notice retries its own control; retry them all.
  for (let i = 0; i < 5 && (await notices.count()) > 0; i += 1) {
    await notices.first().getByRole('button', { name: 'Try again' }).click()
  }
  await expect(notices).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Tip article' })).toBeVisible()
  await expect(page.getByText(/^Opening line\./)).toBeVisible()
})
