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
  // Scripts only: the stylesheets live in the same folder and still load.
  await page.route('**/_next/static/chunks/**', (route) =>
    route.request().resourceType() === 'script'
      ? route.abort()
      : route.continue()
  )
  const slot = page
    .getByRole('navigation', { name: 'Main' })
    .locator('.qt-balance-slot:visible')
  await page.goto('/shelf')
  // The word that shows: the other is in the HTML, hidden by the marker.
  await expect(slot).toHaveText('Sign in', { useInnerText: true })
  const signedOut = await slot.boundingBox()
  await page.evaluate(() =>
    localStorage.setItem('__convexAuthJWT_test', 'held')
  )
  await page.goto('/shelf')
  await expect(slot).toHaveText('Balance', { useInnerText: true })
  const held = await slot.boundingBox()
  expect(held!.width).toBe(signedOut!.width)
})

test('before scripts run, a press on the balance item goes where the marker says', async ({
  page,
}) => {
  // The app's scripts are held back until after the press, as on a slow
  // phone: only the server HTML and the pre-paint script have run.
  await page.route('**/_next/static/chunks/**', (route) =>
    route.request().resourceType() === 'script'
      ? route.abort()
      : route.continue()
  )
  const item = page
    .getByRole('navigation', { name: 'Main' })
    .locator('[data-balance]:visible')
  // A held session token: the balance, not the sign-in page.
  await page.goto('/system/reading')
  await page.evaluate(() =>
    localStorage.setItem('__convexAuthJWT_test', 'held')
  )
  await page.goto('/shelf')
  await expect(item).toHaveCount(1)
  await item.click()
  await expect(page).toHaveURL(/\/pocket$/)
  // No token: the sign-in page.
  await page.evaluate(() => localStorage.clear())
  await page.goto('/shelf')
  await expect(item).toHaveCount(1)
  await item.click()
  await expect(page).toHaveURL(/\/(login|signin)/)
})

test('the first tap after a full page load is never lost', async ({ page }) => {
  // A same-origin full load (a reload, or a crossing from the legacy pages),
  // then a press at once where the balance item is drawn, with no wait for
  // it to take input. Signed out, the item is the link to sign in. Two
  // things are told apart: the press reached the link (its navigation
  // started), and the sign-in page arrived, which a loaded runner may take
  // seconds for.
  await page.addInitScript(() => {
    document.addEventListener(
      'click',
      (event) => {
        const link = (event.target as Element | null)?.closest?.(
          '[data-balance]'
        )
        if (link)
          sessionStorage.setItem(
            'balance-click',
            `${link.getAttribute('data-when')}${event.defaultPrevented ? ' prevented' : ''}`
          )
      },
      true
    )
  })
  for (let run = 0; run < 3; run++) {
    await page.goto('/system/reading')
    await page.evaluate(() => sessionStorage.removeItem('balance-click'))
    await page.goto('/shelf', { waitUntil: 'commit' })
    const box = await page.waitForFunction(() => {
      const items = [...document.querySelectorAll('[data-balance]')]
      const item = items.find((el) => el.getClientRects().length > 0)
      if (!item) return null
      const r = item.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    const at = (await box.jsonValue())!
    // Before the scripts run the press follows the link to sign in; after,
    // it opens the sign-in sheet over the page. Either way it reached the
    // item.
    const navigated = page
      .waitForRequest(
        (request) =>
          request.isNavigationRequest() &&
          /\/(login|signin)/.test(request.url()),
        { timeout: 5000 }
      )
      .then(() => 'page' as const)
    const sheet = page
      .getByRole('dialog', { name: 'Sign in to Quilltip' })
      .waitFor({ timeout: 5000 })
      .then(() => 'sheet' as const)
    const started = Promise.any([navigated, sheet]).catch(() => null)
    await page.mouse.click(at.x, at.y)
    const reached = await started
    if (!reached) {
      const clicked = await page.evaluate(() =>
        sessionStorage.getItem('balance-click')
      )
      throw new Error(
        `run ${run + 1}: the press was lost: no navigation to sign in started and no sign-in sheet opened (click on the item: ${clicked ?? 'none'})`
      )
    }
    if (reached === 'page')
      await expect(page, `run ${run + 1}: the sign-in page arrives`).toHaveURL(
        /\/(login|signin)/,
        { timeout: 15_000 }
      )
  }
})
