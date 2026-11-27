import { expect, test } from '@playwright/test'

// Crossing from the legacy pages into the application shell is a full page
// load (two root layouts). A light or dark choice stored by the legacy pages
// (next-themes, key "theme") must apply before the first paint, under the
// production CSP (the theme script carries the nonce). Runs against a
// production build (scripts/app-checks/run.ts).

test.skip(
  !process.env.NO_SCRIPT_CHECK,
  'Needs a production build (bun scripts/app-checks/run.ts)'
)

for (const [stored, system] of [
  ['dark', 'light'],
  ['light', 'dark'],
] as const) {
  test(`a stored ${stored} theme wins over a ${system} system before paint`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: system })
    await page.addInitScript((value) => {
      localStorage.setItem('theme', value)
    }, stored)
    const blocked: string[] = []
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text()))
        blocked.push(message.text())
    })
    await page.goto('/system/reading', { waitUntil: 'commit' })
    await page.waitForFunction(() => document.body !== null)
    // Before hydration: the script in <head> already ran.
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme)
    ).toBe(stored)
    await page.waitForLoadState('load')
    expect(blocked).toEqual([])
    const ground = await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme
    )
    expect(ground).toBe(stored)
  })
}

test('with no stored choice, the system setting decides', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/system/reading')
  expect(
    await page.evaluate(() => document.documentElement.dataset.theme ?? null)
  ).toBeNull()
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme
    )
  ).toBe('dark')
})

test('before scripts run, a held session shows Balance, never Sign in, at the same width', async ({
  page,
}) => {
  // The app's own scripts never load, so what shows is the server HTML
  // plus the pre-paint script, as on a slow phone.
  await page.route('**/_next/static/chunks/**', (route) => route.abort())
  const slot = page
    .getByRole('navigation', { name: 'Main' })
    .locator('.qt-balance-slot')
  await page.goto('/shelf')
  await expect(slot).toHaveText('Sign in')
  const signedOut = await slot.boundingBox()
  await page.evaluate(() =>
    localStorage.setItem('__convexAuthJWT_test', 'held')
  )
  await page.goto('/shelf')
  await expect(slot).toHaveText('Balance')
  const held = await slot.boundingBox()
  expect(held!.width).toBe(signedOut!.width)
})
