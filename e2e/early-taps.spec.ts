import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * A press made right after the first paint, before the page scripts run, is
 * answered: the sign-in form holds the submit and sends it once the scripts
 * run; the mobile menu opens as a popover and becomes the modal dialog.
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
 * A page with the shared header and no streamed loading state. When a page's
 * first screen is a loading fallback, React swaps the content in on a
 * requestAnimationFrame, which WebKit does not run before its first paint;
 * `/support` has no such fallback (and since #597 no reading page does).
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
  test('a submit is held with visible feedback, then sent once', async ({
    page,
  }) => {
    const requests: Request[] = []
    page.on('request', (request) => requests.push(request))
    const sent = await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto('/login', { waitUntil: 'domcontentloaded' })

    const form = page.locator('form[data-early-submit]')
    const submit = form.locator('button[type="submit"]')
    await expect(submit).toHaveText(/Log in/, { useInnerText: true })
    expect(await reactAttached(page, 'form[data-early-submit]')).toBe(false)

    await page.getByLabel('Email', { exact: true }).fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await submit.click()

    // Answered in the next frame, while the scripts are still held.
    await expect(submit).toHaveText('One moment…', {
      timeout: 1000,
      useInnerText: true,
    })
    await expect(form).toHaveAttribute('data-held-submit', '')
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
    await expect(submit).toHaveText('One moment…', { useInnerText: true })
    await expect(submit).toBeDisabled()
    await expect(form).not.toHaveAttribute('data-held-submit')
    await page.waitForTimeout(1500)
    expect(signInMessages(sent)).toHaveLength(1)

    // No native form post, and the password never reached a URL or an HTTP
    // request: it went only over the Convex connection.
    expect(page.url()).toMatch(/\/login$/)
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
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Email', { exact: true }).fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    const submit = page.locator('form[data-early-submit] button[type="submit"]')
    await submit.click()
    await expect(submit).toHaveText('One moment…', {
      timeout: 1000,
      useInnerText: true,
    })
    // React renders the page again when the server HTML does not match, as
    // it sometimes does under load. Taking the held form out forces that.
    await page
      .locator('form[data-early-submit]')
      .evaluate((form) => form.remove())

    release()
    await expect
      .poll(() => signInMessages(sent).length, { timeout: 15_000 })
      .toBe(1)
    expect(signInMessages(sent)[0]).toContain(EMAIL)
    await expect(
      page.locator('form[data-early-submit] button[type="submit"]')
    ).toHaveText('One moment…', { useInnerText: true })
    await page.waitForTimeout(1500)
    expect(signInMessages(sent)).toHaveLength(1)
  })

  test('a submit with empty fields shows the same errors once the scripts run', async ({
    page,
  }) => {
    const sent = await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    const submit = page.locator('form[data-early-submit] button[type="submit"]')
    await submit.click()
    await expect(submit).toHaveText('One moment…', {
      timeout: 1000,
      useInnerText: true,
    })

    release()
    await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    await expect(submit).toHaveText(/Log in/, { useInnerText: true })
    expect(signInMessages(sent)).toEqual([])
  })

  test('a register submit keeps the password out of the URL', async ({
    page,
  }) => {
    const requests: Request[] = []
    page.on('request', (request) => requests.push(request))
    const sent = await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto('/register', { waitUntil: 'domcontentloaded' })
    const submit = page.locator('form[data-early-submit] button[type="submit"]')
    await page.getByLabel('Your name', { exact: true }).fill('Early Tap')
    await page.getByLabel('Email', { exact: true }).fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await submit.click()
    await expect(submit).toHaveText('One moment…', {
      timeout: 1000,
      useInnerText: true,
    })

    release()
    await expect
      .poll(() => signInMessages(sent).length, { timeout: 15_000 })
      .toBe(1)
    expect(signInMessages(sent)[0]).toContain('"signUp"')
    expect(page.url()).toMatch(/\/register$/)
    for (const request of requests) {
      expect(request.url()).not.toContain(PASSWORD)
      expect(request.postData() ?? '').not.toContain(PASSWORD)
    }
  })

  test('a reset submit sends the values typed before the scripts ran', async ({
    page,
  }) => {
    const sent = await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto('/reset-password', { waitUntil: 'domcontentloaded' })
    const submit = page.locator('form[data-early-submit] button[type="submit"]')
    await page.getByLabel('Email', { exact: true }).fill(EMAIL)
    await page.getByLabel('Reset code', { exact: true }).fill('12345678')
    await page.getByLabel('New password', { exact: true }).fill(PASSWORD)
    await page
      .getByLabel('Confirm new password', { exact: true })
      .fill(PASSWORD)
    await submit.click()
    await expect(submit).toHaveText('Updating…', {
      timeout: 1000,
      useInnerText: true,
    })

    release()
    await expect
      .poll(() => signInMessages(sent).length, { timeout: 15_000 })
      .toBe(1)
    const [message] = signInMessages(sent)
    expect(message).toContain(EMAIL)
    expect(message).toContain('"12345678"')
    expect(message).toContain('"reset-verification"')
    expect(page.url()).toMatch(/\/reset-password$/)
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

test.describe('landing reading link from the first paint', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true })

  const READ = 'I’m here to read'
  const toArticles = (page: Page) =>
    // The article list's scripts may be held too, so wait for the navigation
    // to commit rather than for the load event.
    page.waitForURL((url) => url.pathname === '/articles', {
      timeout: 10_000,
      waitUntil: 'commit',
    })
  const stage = (page: Page) => page.locator('[data-stage-active="true"]')

  /**
   * The reading links a reader can reach now, by where they are: the hero's,
   * or the opening's beside "Skip opening". Exactly one at any moment.
   */
  async function reachable(page: Page, browserName: string) {
    const places = await page.evaluate(
      (name) =>
        [...document.querySelectorAll('a')]
          .filter((link) => link.textContent?.trim() === name)
          .filter(
            (link) =>
              !link.closest('[inert]') &&
              !link.closest('[aria-hidden="true"]') &&
              link.getClientRects().length > 0
          )
          .map((link) =>
            link.closest('.opening-controls') ? 'opening' : 'hero'
          ),
      READ
    )
    const inTree = (await page.locator('body').ariaSnapshot())
      .split('\n')
      .filter((line) => line.includes(`link "${READ}"`)).length
    // The Tab order, from the top of the page. (Desktop WebKit moves to
    // links with Alt+Tab.)
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    const stops = new Set<string>()
    for (let press = 0; press < 12; press++) {
      await page.keyboard.press(tab)
      stops.add(
        await page.evaluate((name) => {
          const focused = document.activeElement
          if (!focused || focused.textContent?.trim() !== name) return ''
          return focused.closest('.opening-controls') ? 'opening' : 'hero'
        }, READ)
      )
    }
    stops.delete('')
    return { places, inTree, tabbed: [...stops] }
  }

  test('before the page scripts run, the hero link opens the article list', async ({
    page,
    browserName,
  }) => {
    await recordConvexMessages(page)
    await holdPageScripts(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const link = page.getByRole('link', { name: READ })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', '/articles')
    expect(await reachable(page, browserName)).toEqual({
      places: ['hero'],
      inTree: 1,
      tabbed: ['hero'],
    })
    await link.tap()
    await toArticles(page)
  })

  test('through the opening, exactly one reading link can be reached', async ({
    page,
    browserName,
  }) => {
    await recordConvexMessages(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(stage(page)).toBeAttached({ timeout: 10_000 })
    const during = { places: ['opening'], inTree: 1, tabbed: ['opening'] }
    // Start, middle and settling of the 6.2 s sequence.
    expect(await reachable(page, browserName)).toEqual(during)
    await page.waitForTimeout(2000)
    expect(await reachable(page, browserName)).toEqual(during)
    await page.waitForTimeout(2300)
    if ((await stage(page).count()) > 0)
      expect(await reachable(page, browserName)).toEqual(during)
    // The opening's link leaves with the stage; the hero's is back.
    await expect(stage(page)).toHaveCount(0, { timeout: 10_000 })
    expect(await reachable(page, browserName)).toEqual({
      places: ['hero'],
      inTree: 1,
      tabbed: ['hero'],
    })
  })

  test('during the opening, only the opening link and "Skip opening" can be reached, and the link opens the article list', async ({
    page,
    browserName,
  }) => {
    await recordConvexMessages(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(stage(page)).toBeAttached({ timeout: 10_000 })
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    const stops = new Set<string>()
    for (let press = 0; press < 8; press++) {
      await page.keyboard.press(tab)
      stops.add(
        await page.evaluate(() => {
          const focused = document.activeElement as HTMLElement | null
          return focused && focused !== document.body
            ? (focused.textContent ?? '').trim()
            : ''
        })
      )
    }
    stops.delete('')
    expect([...stops].sort()).toEqual([READ, 'Skip opening'])
    const exposed = (await page.locator('body').ariaSnapshot())
      .split('\n')
      .filter((line) =>
        /- (link|button|heading|navigation|contentinfo|region)/.test(line)
      )
      // The app's notification area lives outside the landing page and was
      // reachable during the opening before this change too.
      .filter((line) => !line.includes('region "Notifications'))
      .map((line) => line.trim().replace(/:$/, ''))
    expect(exposed).toEqual([`- link "${READ}"`, '- button "Skip opening"'])
    const link = page.locator('.opening-controls').getByRole('link', {
      name: READ,
    })
    await expect(link).toHaveAttribute('href', '/articles')
    // Both controls are on screen in the top corner, and nothing covers them.
    for (const control of [
      link,
      page.getByRole('button', { name: 'Skip opening' }),
    ]) {
      await expect(control).toBeInViewport()
      const place = await control.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2
        )
        return {
          top: box.top,
          right: innerWidth - box.right,
          reached: hit !== null && element.contains(hit),
        }
      })
      expect(place.reached).toBe(true)
      expect(place.top).toBeLessThan(80)
      expect(place.right).toBeLessThan(375 / 2)
    }
    await expect(stage(page)).toBeAttached()
    await link.tap()
    await toArticles(page)
  })

  test('after "Skip opening", and with reduced motion, the hero link is the one', async ({
    page,
    browser,
    browserName,
  }) => {
    await recordConvexMessages(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(stage(page)).toBeAttached({ timeout: 10_000 })
    // The keyboard's way: "Skip opening" has focus when the opening starts.
    // (After a tap on it, WebKit loses its place in the Tab order until the
    // next click; that is so before this change too.)
    const skip = page.getByRole('button', { name: 'Skip opening' })
    await skip.focus()
    await page.keyboard.press('Enter')
    await expect(stage(page)).toHaveCount(0)
    expect(await reachable(page, browserName)).toEqual({
      places: ['hero'],
      inTree: 1,
      tabbed: ['hero'],
    })

    const reduced = await browser.newContext({
      viewport: { width: 375, height: 812 },
      reducedMotion: 'reduce',
    })
    const calm = await reduced.newPage()
    await recordConvexMessages(calm)
    await calm.goto('/', { waitUntil: 'load' })
    await calm.waitForTimeout(500)
    await expect(stage(calm)).toHaveCount(0)
    expect(await reachable(calm, browserName)).toEqual({
      places: ['hero'],
      inTree: 1,
      tabbed: ['hero'],
    })
    await reduced.close()
  })

  for (const width of [375, 768, 1440])
    test(`at ${width} px the opening link stays clear of the headline`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 812 })
      await recordConvexMessages(page)
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await expect(stage(page)).toBeAttached({ timeout: 10_000 })
      // Every frame of the opening: the headline's letters and the opening
      // link never share a pixel.
      const result = await page.evaluate(
        () =>
          new Promise<{ frames: number; overlap: number }>((resolve) => {
            let frames = 0
            let overlap = 0
            const tick = () => {
              const root = document.querySelector('[data-stage-active]')
              if (root?.getAttribute('data-stage-active') !== 'true')
                return resolve({ frames, overlap })
              frames += 1
              const link = document
                .querySelector('.opening-controls a')!
                .getBoundingClientRect()
              const headline = document.querySelector('.value-headline')!
              const letters = document.createRange()
              letters.selectNodeContents(headline.querySelector('.value-line')!)
              const rects = [...letters.getClientRects()]
              const written = headline.querySelector('.replacement-word')
              if (written) rects.push(written.getBoundingClientRect())
              for (const rect of rects) {
                const across =
                  Math.min(rect.right, link.right) -
                  Math.max(rect.left, link.left)
                const down =
                  Math.min(rect.bottom, link.bottom) -
                  Math.max(rect.top, link.top)
                if (across > 0 && down > 0)
                  overlap = Math.max(overlap, across * down)
              }
              requestAnimationFrame(tick)
            }
            tick()
          })
      )
      expect(result.frames).toBeGreaterThan(30)
      expect(result.overlap).toBe(0)
      // After it: the landmarks and the heading outline are back.
      const outline = (await page.locator('body').ariaSnapshot())
        .split('\n')
        .filter((line) =>
          /^\s*- (banner|navigation|main|contentinfo|region|heading)\b/.test(
            line
          )
        )
        .map((line) => line.trim())
      expect(outline.slice(0, 5)).toEqual([
        '- banner:',
        '- navigation "Main navigation":',
        '- main:',
        '- region "Value for writing":',
        '- heading "Value for writing" [level=1]',
      ])
    })
})
