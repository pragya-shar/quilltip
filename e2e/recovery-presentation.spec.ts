import { test, expect } from '@playwright/test'

// Run `bun e2e/fixtures/recovery/server.mjs`, then RECOVERY_FIXTURES=1.
test.describe('Failure recovery and route loading', () => {
  test.skip(
    process.env.RECOVERY_FIXTURES !== '1',
    'Requires isolated recovery fixtures'
  )
  test.use({ baseURL: 'http://127.0.0.1:4175' })

  test('reader sections recover independently without replacing healthy content', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByText('Healthy content stays visible.')).toBeVisible()
    const body = page
      .getByRole('alert')
      .filter({ hasText: 'Unable to display this article.' })
    const details = page
      .getByRole('alert')
      .filter({ hasText: 'Unable to load this panel.' })
    await body.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('Article body recovered')).toBeVisible()
    await expect(details).toBeVisible()
    await details.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('Article details recovered')).toBeVisible()
    await expect(page.getByText('Healthy content stays visible.')).toBeVisible()
  })

  for (const state of ['route', 'wallet']) {
    test(`${state} fallback retains recovery and navigation`, async ({
      page,
    }) => {
      await page.goto(`/?state=${state}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Go home' })).toHaveAttribute(
        'href',
        '/'
      )
      if (state === 'wallet')
        await expect(
          page.getByRole('link', { name: 'Browse articles' })
        ).toHaveAttribute('href', '/articles')
      await page.getByRole('button', { name: 'Try again' }).click()
      await expect(
        page.getByText(`${state === 'route' ? 'Page' : 'Wallet'} recovered`)
      ).toBeVisible()
    })
  }

  test('loading announces once, respects reduced motion and resolves', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/?state=loading')
    await expect(
      page.getByRole('status', { name: 'Loading page' })
    ).toBeVisible()
    await expect(page.locator('.route-loading-mark')).toHaveCSS(
      'animation-name',
      'none'
    )
    await expect(page.getByRole('navigation')).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
    await expect(page.getByText('Page loaded')).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('status')).toHaveCount(0)
  })

  test('mobile fallback fits and exposes keyboard focus', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/?state=wallet')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCSS(
      'outline-style',
      'solid'
    )
  })
})
