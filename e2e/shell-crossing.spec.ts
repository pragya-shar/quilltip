import { expect, test } from '@playwright/test'

// Crossing from the legacy pages into the application shell is a full page
// load (two root layouts). A light or dark choice stored by the legacy pages
// (next-themes, key "theme") must apply before the first paint, under the
// production CSP (the theme script carries the nonce). Runs against a
// production build (scripts/system/no-script-check.ts).

test.skip(
  !process.env.NO_SCRIPT_CHECK,
  'Needs a production build (bun scripts/system/no-script-check.ts)'
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
