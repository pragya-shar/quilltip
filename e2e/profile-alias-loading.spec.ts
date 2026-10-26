import { test, expect } from '@playwright/test'

for (const path of ['/profile', '/settings/profile']) {
  for (const width of [375, 1280]) {
    test(`${path} preserves its initial loading layout at ${width}px`, async ({
      browser,
      baseURL,
    }) => {
      // A fresh context prevents styles from a prior username visit hiding bugs.
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
        const folio = page.locator('main.profile-folio')
        await expect(folio).toBeVisible()
        await expect(folio).toHaveCSS('background-color', 'rgb(250, 245, 236)')
        const avatar = folio.locator('.profile-avatar')
        const avatarSize = width <= 640 ? '88px' : '104px'
        await expect(avatar).toHaveCSS('width', avatarSize)
        await expect(avatar).toHaveCSS('height', avatarSize)
        const cards = folio.locator('.skeleton-row')
        await expect(cards).toHaveCSS('display', 'grid')
        await expect(cards.locator('i').first()).toHaveCSS('height', '420px')
        await expect(cards.locator('i').first()).toHaveCSS(
          'background-color',
          'rgba(117, 55, 68, 0.07)'
        )
        const columns = await cards.evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(' ').length
        )
        expect(columns).toBe(width <= 640 ? 1 : 3)
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
