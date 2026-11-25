import { test, expect } from '@playwright/test'

for (const path of ['/profile', '/settings/profile']) {
  for (const width of [375, 1280]) {
    test(`${path} shows the settings loading layout at ${width}px`, async ({
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({
        baseURL,
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      })
      try {
        // Convex Auth awaits its initial storage read. Keep that read pending so
        // the real alias fallback can render without racing a redirect. No auth
        // state, token, or backend response is fabricated.
        await context.addInitScript(() => {
          const getItem = Storage.prototype.getItem
          Object.defineProperty(Storage.prototype, 'getItem', {
            value(this: Storage, key: string) {
              if (key.startsWith('__convexAuthJWT_')) {
                return new Promise(() => {})
              }
              return getItem.call(this, key)
            },
          })
        })
        const page = await context.newPage()
        await page.goto(path)
        await expect(page.locator('header.app-site-header')).toBeVisible()
        const folio = page.locator('main.account-folio')
        await expect(folio).toBeVisible()
        await expect(folio).toHaveCSS('background-color', 'rgb(250, 245, 236)')
        await expect(folio.locator('.settings-skeleton-block')).toHaveCount(2)
        await expect(
          page
            .getByRole('status')
            .filter({ hasText: 'Opening your profile settings.' })
        ).toHaveCount(1)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth)
        ).toBeLessThanOrEqual(width)
      } finally {
        await context.close()
      }
    })
  }

  test(`${path} retains the signed-out return destination`, async ({
    page,
  }) => {
    await page.goto(`${path}?tab=nfts`)
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/login' &&
        url.searchParams.get('returnTo') === `${path}?tab=nfts`
    )
  })
}
