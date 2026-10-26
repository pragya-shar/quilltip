import { test, expect, type Page } from '@playwright/test'

const mainNavigation = (page: Page) =>
  page.getByRole('navigation', { name: 'Main navigation', exact: true })
const accountButton = (page: Page) =>
  mainNavigation(page).getByRole('button', { name: 'Account', exact: true })

const destinations = [
  ['Drafts', '/drafts', '/write?desk=writing'],
  ['Public profile', null, null],
  ['Wallet', '/dashboard/wallet', '/dashboard/wallet'],
  ['Stats', '/dashboard/stats', '/dashboard/stats'],
  ['Articles', '/articles', '/articles'],
  ['Your library', '/library', '/library'],
  ['Writing desk', '/write', '/write'],
] as const

async function expectDestination(page: Page, label: string, path: string) {
  await expect(page).toHaveURL((url) => url.pathname + url.search === path)
  switch (label) {
    case 'Drafts':
      await expect(
        page.getByRole('heading', { name: 'Drafts', exact: true })
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: '＋ New draft', exact: true })
      ).toBeVisible()
      break
    case 'Writing desk':
      await expect(
        page.getByPlaceholder('Give it a title', { exact: true })
      ).toBeVisible()
      break
    case 'Your library':
      await expect(
        page.getByRole('heading', { name: 'Your library.', exact: true })
      ).toBeVisible()
      break
    case 'Public profile':
      // The handle comes from this session, never a seeded or published article.
      await expect(
        page.getByText(`@${path.slice(1)}`, { exact: true })
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Change profile photo', exact: true })
      ).toBeVisible()
      break
    case 'Articles':
      await expect(
        page.getByRole('heading', { name: 'Story time.', exact: true })
      ).toBeVisible()
      break
    case 'Wallet':
      await expect(
        page.getByRole('heading', { name: label, exact: true })
      ).toBeVisible()
      await expect(
        page.getByText('Your wallet and tip activity.', { exact: true })
      ).toBeVisible()
      break
    case 'Stats':
      await expect(
        page.getByRole('heading', { name: label, exact: true })
      ).toBeVisible()
      await expect(page.getByRole('definition')).toHaveCount(4)
  }
}

async function expectGuestHeader(page: Page) {
  await expect(page).toHaveURL(/\/login$/)
  await expect(
    page.getByRole('button', { name: 'Log in', exact: true })
  ).toBeVisible()
  // The login route renders before Convex finishes revoking the session.
  await expect(
    page.getByRole('status', { name: 'Signing out', exact: true })
  ).toBeHidden()
  await page.goto('/support')
  await expect(
    mainNavigation(page).getByRole('link', { name: 'Log in', exact: true })
  ).toBeVisible()
  await expect(
    mainNavigation(page).getByRole('link', { name: 'Sign up', exact: true })
  ).toBeVisible()
  await expect(accountButton(page)).toHaveCount(0)
}

// Every test signs in separately, so sign-out never invalidates another test.
// Do not persist auth state or include credentials in traces/screenshots.
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 1280, height: 900 },
  reducedMotion: 'reduce',
  trace: 'off',
  screenshot: 'off',
  video: 'off',
})

test.describe('signed-in account navigation on a development backend', () => {
  test.skip(
    !process.env.PLAYWRIGHT_QA_EMAIL || !process.env.PLAYWRIGHT_QA_PASSWORD,
    'Provide a disposable development account through PLAYWRIGHT_QA_EMAIL and PLAYWRIGHT_QA_PASSWORD; see docs/SETUP.md.'
  )
  test.setTimeout(120_000)

  test.beforeEach(async ({ page }) => {
    await page.goto('/login?returnTo=%2Fsupport')
    await page
      .getByLabel('Email', { exact: true })
      .fill(process.env.PLAYWRIGHT_QA_EMAIL!)
    await page
      .getByLabel('Password', { exact: true })
      .fill(process.env.PLAYWRIGHT_QA_PASSWORD!)
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(page).toHaveURL(/\/support$/)
    await expect(accountButton(page)).toBeVisible()
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`desktop keyboard, destinations and sign-out (${colorScheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme })
      const trigger = accountButton(page)
      await mainNavigation(page)
        .getByRole('link', { name: 'Writing desk', exact: true })
        .focus()
      await page.keyboard.press('Tab')
      await expect(trigger).toBeFocused()
      await page.keyboard.press('Enter')
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      await expect(
        menu.getByRole('menuitem', { name: 'Drafts', exact: true })
      ).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(
        menu.getByRole('menuitem', { name: 'Public profile', exact: true })
      ).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      await expect(trigger).toBeFocused()

      for (const [label, href, finalPath] of destinations) {
        await page.goto('/support')
        const isAccountLink = [
          'Drafts',
          'Public profile',
          'Wallet',
          'Stats',
        ].includes(label)
        if (isAccountLink) await trigger.press('ArrowDown')
        const link = isAccountLink
          ? menu.getByRole('menuitem', { name: label, exact: true })
          : mainNavigation(page).getByRole('link', { name: label, exact: true })
        const actualHref = await link.getAttribute('href')
        if (href) expect(actualHref).toBe(href)
        else expect(actualHref).toMatch(/^\/[^/]+$/)
        await link.focus()
        await page.keyboard.press('Enter')
        await expectDestination(page, label, finalPath ?? actualHref!)
        await expect(menu).toBeHidden()
      }

      await page.goto('/support')
      await trigger.press('Enter')
      await page.keyboard.press('End')
      await expect(
        menu.getByRole('menuitem', { name: 'Sign out', exact: true })
      ).toBeFocused()
      await page.keyboard.press('Enter')
      await expectGuestHeader(page)
    })

    for (const width of [375, 390]) {
      test(`mobile Escape, destinations and sign-out at ${width}px (${colorScheme})`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme })
        await page.setViewportSize({ width, height: 844 })
        const trigger = page.getByRole('button', {
          name: 'Open navigation menu',
        })
        const dialog = page.getByRole('dialog', { name: 'Find your way' })
        await trigger.press('Enter')
        await expect(dialog).toBeVisible()
        await expect(
          dialog.getByRole('link', { name: 'Log in', exact: true })
        ).toHaveCount(0)
        await expect(
          dialog.getByRole('link', { name: 'Sign up', exact: true })
        ).toHaveCount(0)
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
        await expect(trigger).toBeFocused()

        for (const [label, href, finalPath] of destinations) {
          await page.goto('/support')
          await trigger.press('Enter')
          const link = dialog.getByRole('link', { name: label, exact: true })
          await expect(link).toBeVisible()
          const actualHref = await link.getAttribute('href')
          if (href) expect(actualHref).toBe(href)
          else expect(actualHref).toMatch(/^\/[^/]+$/)
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth)
          ).toBeLessThanOrEqual(width)
          await link.click()
          await expectDestination(page, label, finalPath ?? actualHref!)
          await expect(dialog).toBeHidden()
        }

        await page.goto('/support')
        await trigger.click()
        await dialog
          .getByRole('button', { name: 'Sign out', exact: true })
          .click()
        await expect(dialog).toBeHidden()
        // Inspect the desktop guest actions after signing out from mobile.
        await page.setViewportSize({ width: 1280, height: 900 })
        await expectGuestHeader(page)
        await page.setViewportSize({ width, height: 844 })
        await trigger.click()
        await expect(
          dialog.getByRole('link', { name: 'Log in', exact: true })
        ).toBeVisible()
        await expect(
          dialog.getByRole('link', { name: 'Sign up', exact: true })
        ).toBeVisible()
        await expect(
          dialog.getByRole('button', { name: 'Sign out', exact: true })
        ).toHaveCount(0)
      })
    }
  }

  for (const width of [1280, 375, 390]) {
    test(`pending authentication never flashes guest actions at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 })
      let pending = true
      const heldMessages: (() => void)[] = []
      // Hold real responses, without forging an auth token or mocking useAuth.
      await page.routeWebSocket(
        (url) => url.pathname.endsWith('/sync'),
        (socket) => {
          const server = socket.connectToServer()
          server.onMessage((message) => {
            if (pending) heldMessages.push(() => socket.send(message))
            else socket.send(message)
          })
        }
      )
      await page.addInitScript(() => {
        const observer = new MutationObserver(() => {
          if (
            document.querySelector(
              '.app-site-header a[href="/login"], .app-mobile-menu a[href="/login"], .app-site-header a[href="/register"], .app-mobile-menu a[href="/register"]'
            )
          ) {
            document.documentElement.dataset.guestActionsSeen = 'true'
          }
        })
        observer.observe(document, { childList: true, subtree: true })
      })
      await page.reload()
      await expect.poll(() => heldMessages.length).toBeGreaterThan(0)
      const header = page.locator('header.app-site-header')
      await expect(header).toBeVisible()
      await expect(accountButton(page)).toHaveCount(0)
      const dialog = page.getByRole('dialog', { name: 'Find your way' })
      if (width < 768) {
        await page.getByRole('button', { name: 'Open navigation menu' }).click()
        await expect(dialog).toBeVisible()
        await expect(
          dialog.getByRole('link', { name: 'Drafts', exact: true })
        ).toHaveCount(0)
      }
      await expect(
        page.locator(
          '.app-site-header a[href="/login"], .app-mobile-menu a[href="/login"], .app-site-header a[href="/register"], .app-mobile-menu a[href="/register"]'
        )
      ).toHaveCount(0)
      pending = false
      heldMessages.splice(0).forEach((send) => send())
      if (width < 768) {
        await expect(
          dialog.getByRole('link', { name: 'Drafts', exact: true })
        ).toBeVisible()
      } else {
        await expect(accountButton(page)).toBeVisible()
      }
      expect(
        await page.evaluate(
          () => document.documentElement.dataset.guestActionsSeen
        )
      ).toBeUndefined()
    })
  }
})
