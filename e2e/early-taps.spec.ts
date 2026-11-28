import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * A press made right after the first paint, before the page scripts run, is
 * answered: the sign-in form (/signin) holds the submit and sends it once
 * the scripts run; the mobile menu opens as a popover and becomes the modal dialog.
 *
 * The page's script chunks are held back until the test releases them, so
 * every press here happens before React attaches its handlers. Run against a
 * production build (`bun run test:e2e:early-taps`), in Chromium and WebKit.
 */

const EMAIL = 'early-tap@example.invalid'
const PASSWORD = 'Early-tap-1234'

/** Holds every Next.js script chunk until the returned function is called. */
async function holdPageScripts(page: Page): Promise<() => void> {
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  await page.route(/\/_next\/static\/.+\.js(\?.*)?$/, async (route) => {
    await released
    await route.continue().catch(() => {})
  })
  return release
}

/** Answers the Convex connection locally and records what the page sends. */
async function recordConvexMessages(page: Page): Promise<string[]> {
  const sent: string[] = []
  await page.routeWebSocket(/\/api\/[^/]+\/sync$/, (socket) => {
    socket.onMessage((message) => sent.push(String(message)))
  })
  return sent
}

/**
 * A page with the shared header and no streamed loading state. WebKit paints
 * nothing on `/articles` before the scripts run: its first screen is a
 * loading fallback that React swaps in a requestAnimationFrame, and WebKit
 * runs none before its first paint.
 */
const MENU_PAGE = '/support'

/** Resolves when the element's transitions and animations have finished. */
const settled = (page: Page, selector: string) =>
  page
    .locator(selector)
    .evaluate((element) =>
      Promise.all(
        element.getAnimations().map((animation) => animation.finished)
      )
    )

const signInMessages = (sent: string[]) =>
  sent.filter((message) => message.includes('"auth:signIn"'))

/** True once React has attached its handlers to the element. */
const reactAttached = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) =>
      Object.keys(element).some((key) => key.startsWith('__reactProps'))
    )

test.describe('sign-in before the page scripts run', () => {
  const form = (page: Page) => page.locator('form[data-early-submit]')
  const submit = (page: Page) => form(page).locator('button[type="submit"]')

  test('a submit is held with visible feedback, then sent once', async ({
    page,
  }) => {
    const requests: Request[] = []
    page.on('request', (request) => requests.push(request))
    const sent = await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto('/signin?returnTo=%2Fshelf', {
      waitUntil: 'domcontentloaded',
    })

    await expect(submit(page)).toHaveText('Sign in', { useInnerText: true })
    expect(await reactAttached(page, 'form[data-early-submit]')).toBe(false)

    await page.getByLabel('Email', { exact: true }).fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await submit(page).click()

    // Answered in the next frame, while the scripts are still held.
    await expect(submit(page)).toHaveText('One moment…', {
      timeout: 1000,
      useInnerText: true,
    })
    await expect(form(page)).toHaveAttribute('data-held-submit', '')
    await page.waitForTimeout(500)
    expect(await reactAttached(page, 'form[data-early-submit]')).toBe(false)
    expect(signInMessages(sent)).toEqual([])

    release()
    await expect
      .poll(() => signInMessages(sent).length, { timeout: 15_000 })
      .toBe(1)
    const [message] = signInMessages(sent)
    expect(message).toContain(EMAIL)
    // Still pending: the local stand-in never answers. Nothing is sent twice.
    await expect(submit(page)).toHaveAttribute('aria-busy', 'true')
    await expect(submit(page)).toBeDisabled()
    await expect(form(page)).not.toHaveAttribute('data-held-submit')
    await page.waitForTimeout(1500)
    expect(signInMessages(sent)).toHaveLength(1)

    // No native form post, and the password never reached a URL or an HTTP
    // request: it went only over the Convex connection.
    expect(new URL(page.url()).pathname).toBe('/signin')
    for (const request of requests) {
      expect(request.url()).not.toContain(PASSWORD)
      expect(request.postData() ?? '').not.toContain(PASSWORD)
      if (request.isNavigationRequest())
        expect(request.method(), request.url()).toBe('GET')
    }
  })

  test('a held submit survives React rendering the page again', async ({
    page,
  }) => {
    const sent = await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto('/signin', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Email', { exact: true }).fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await submit(page).click()
    await expect(submit(page)).toHaveText('One moment…', {
      timeout: 1000,
      useInnerText: true,
    })
    // React renders the page again when the server HTML does not match, as
    // it sometimes does under load. Taking the held form out forces that.
    await form(page).evaluate((element) => element.remove())

    release()
    await expect
      .poll(() => signInMessages(sent).length, { timeout: 15_000 })
      .toBe(1)
    expect(signInMessages(sent)[0]).toContain(EMAIL)
    await page.waitForTimeout(1500)
    expect(signInMessages(sent)).toHaveLength(1)
  })

  test('a submit with empty fields shows the same errors once the scripts run', async ({
    page,
  }) => {
    const sent = await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto('/signin', { waitUntil: 'domcontentloaded' })
    await submit(page).click()
    await expect(submit(page)).toHaveText('One moment…', {
      timeout: 1000,
      useInnerText: true,
    })

    release()
    await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    await expect(submit(page)).toHaveText('Sign in', { useInnerText: true })
    expect(signInMessages(sent)).toEqual([])
  })

  test('a create-account submit keeps the password out of the URL', async ({
    page,
  }) => {
    const requests: Request[] = []
    page.on('request', (request) => requests.push(request))
    const sent = await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto('/signin?mode=create', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Email', { exact: true }).fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await submit(page).click()
    await expect(submit(page)).toHaveText('One moment…', {
      timeout: 1000,
      useInnerText: true,
    })

    release()
    await expect
      .poll(() => signInMessages(sent).length, { timeout: 15_000 })
      .toBe(1)
    expect(signInMessages(sent)[0]).toContain('"signUp"')
    expect(new URL(page.url()).pathname).toBe('/signin')
    for (const request of requests) {
      expect(request.url()).not.toContain(PASSWORD)
      expect(request.postData() ?? '').not.toContain(PASSWORD)
    }
  })
})

test.describe('mobile menu before the page scripts run', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true })

  test('a tap opens the menu, and the scripts take it over without a second toggle', async ({
    page,
  }) => {
    await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto(MENU_PAGE, { waitUntil: 'domcontentloaded' })
    const trigger = page.getByRole('button', { name: 'Open navigation menu' })
    const dialog = page.getByRole('dialog', { name: 'Find your way' })
    await expect(trigger).toBeVisible()
    expect(await reactAttached(page, '.app-menu-trigger')).toBe(false)

    await trigger.tap()
    await expect(dialog).toBeVisible({ timeout: 1000 })
    await expect(
      dialog.getByRole('link', { name: 'Articles', exact: true })
    ).toBeVisible()
    // A repeated activation of the button (a second press, or one the
    // scripts replay) leaves it open: the button only opens the menu.
    await trigger.evaluate((button: HTMLButtonElement) => button.click())
    await expect(dialog).toBeVisible()
    await settled(page, 'dialog.app-mobile-menu')
    const before = await dialog.boundingBox()

    release()
    // The scripts take over the open menu as a modal dialog.
    await expect(page.locator('.app-menu-trigger')).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(
      true
    )
    await settled(page, 'dialog.app-mobile-menu')
    expect(await dialog.boundingBox()).toEqual(before)
    await expect(
      dialog.getByRole('button', { name: 'Close', exact: true })
    ).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    // After the takeover, a tap opens the modal dialog directly.
    await trigger.tap()
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(
      true
    )
    await dialog.getByRole('button', { name: 'Close', exact: true }).tap()
    await expect(dialog).toBeHidden()
  })

  test('a menu opened before the scripts stays open when React renders the page again', async ({
    page,
  }) => {
    await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto(MENU_PAGE, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Open navigation menu' }).tap()
    const dialog = page.getByRole('dialog', { name: 'Find your way' })
    await expect(dialog).toBeVisible({ timeout: 1000 })
    // Taking the open sheet out of the server HTML makes React render the
    // page again, as it sometimes does under load.
    await page
      .locator('dialog.app-mobile-menu')
      .evaluate((menu) => menu.remove())

    release()
    await expect(page.locator('.app-menu-trigger')).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(
      true
    )
  })

  test('the close button and the backdrop close the menu before the scripts run', async ({
    page,
  }) => {
    await recordConvexMessages(page)
    await holdPageScripts(page)
    await page.goto(MENU_PAGE, { waitUntil: 'domcontentloaded' })
    const trigger = page.getByRole('button', { name: 'Open navigation menu' })
    const dialog = page.getByRole('dialog', { name: 'Find your way' })
    await trigger.tap()
    await expect(dialog).toBeVisible({ timeout: 1000 })
    await dialog.getByRole('button', { name: 'Close', exact: true }).tap()
    await expect(dialog).toBeHidden()
    await trigger.tap()
    await expect(dialog).toBeVisible({ timeout: 1000 })
    await page.mouse.click(20, 400)
    await expect(dialog).toBeHidden()
  })

  test('before the scripts run, Tab out of the menu closes it', async ({
    page,
    browserName,
  }) => {
    // WebKit moves Tab between links only with a system setting turned on.
    test.skip(
      browserName === 'webkit',
      'WebKit does not Tab to links by default'
    )
    await recordConvexMessages(page)
    await holdPageScripts(page)
    await page.goto(MENU_PAGE, { waitUntil: 'domcontentloaded' })
    const trigger = page.getByRole('button', { name: 'Open navigation menu' })
    const dialog = page.getByRole('dialog', { name: 'Find your way' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible({ timeout: 1000 })
    let inside = true
    for (let step = 0; step < 20 && inside; step++) {
      await page.keyboard.press('Tab')
      inside = await dialog.evaluate((element) =>
        element.contains(document.activeElement)
      )
    }
    expect(inside).toBe(false)
    // Focus never rests on a link the sheet covers.
    await expect(dialog).toBeHidden()
  })

  test('the menu opens without motion when the reader asks for reduced motion', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await recordConvexMessages(page)
    await holdPageScripts(page)
    await page.goto(MENU_PAGE, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Open navigation menu' }).tap()
    const dialog = page.getByRole('dialog', { name: 'Find your way' })
    await expect(dialog).toBeVisible({ timeout: 1000 })
    const motion = await dialog.evaluate((element) => ({
      translate: getComputedStyle(element).translate,
      animations: element.getAnimations().length,
    }))
    expect(motion).toEqual({ translate: 'none', animations: 0 })
  })
})
