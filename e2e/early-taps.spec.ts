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

  test('a menu React renders again in the same moment as the tap stays open', async ({
    page,
  }) => {
    // The open is recorded as the popover opens, not a task later: here the
    // sheet leaves the page in the same task as the tap, before the browser
    // reports the open with a toggle event (#658).
    await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto(MENU_PAGE, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('.app-menu-trigger')!.click()
      document.querySelector('dialog.app-mobile-menu')!.remove()
    })
    release()
    const dialog = page.getByRole('dialog', { name: 'Find your way' })
    await expect(page.locator('.app-menu-trigger')).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(
      true
    )
  })

  test('a menu closed in the same moment as React renders again stays closed', async ({
    page,
  }) => {
    // The close is recorded as the popover closes, not a task later: a sheet
    // closed and removed in one task must not open again (#658).
    await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto(MENU_PAGE, { waitUntil: 'domcontentloaded' })
    const trigger = page.locator('.app-menu-trigger')
    await page.getByRole('button', { name: 'Open navigation menu' }).tap()
    await expect(
      page.getByRole('dialog', { name: 'Find your way' })
    ).toBeVisible({ timeout: 1000 })
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __earlyMenu?: string }).__earlyMenu
        )
      )
      .toBe('open')
    await page.evaluate(() => {
      const menu = document.querySelector<HTMLDialogElement>(
        'dialog.app-mobile-menu'
      )!
      menu.hidePopover()
      menu.remove()
    })
    release()
    // The takeover has read the record once the record says `done`.
    await page.waitForFunction(
      () =>
        (window as unknown as { __earlyMenu?: string }).__earlyMenu === 'done'
    )
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('dialog.app-mobile-menu')).toBeHidden()
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

  type Place = 'opening' | 'hero'
  type Reading = { stage: boolean; places: Place[] }

  /**
   * One reading, in one task: whether the opening's stage is on the page, and
   * where the reading links a reader can reach are (rendered, not inert, not
   * hidden from assistive technology): the hero's, or the opening's beside
   * "Skip opening". The stage, the opening's link and the hero's `inert`
   * change in one React commit, so a reading never sees half a handoff.
   * The first call keeps the reader on the page as `__readReach`.
   */
  function readReach(name: string): Reading {
    const w = window as unknown as { __readReach?: () => Reading }
    w.__readReach ??= () => ({
      stage: !!document.querySelector('[data-stage-active="true"]'),
      places: [...document.querySelectorAll('a')]
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
    })
    return w.__readReach()
  }

  /** What a reader can reach while the stage is present, or once it is gone. */
  const only = (phase: Place) => ({
    phase,
    places: [phase],
    inTree: 1,
    tabbed: [phase],
  })

  /**
   * The reading links a reader can reach now, by pointer, in the
   * accessibility tree and by Tab, with the phase they were read in: the
   * opening while the stage is present, the hero once it is gone. Exactly
   * one link at any moment, the one of the phase.
   *
   * The tree and the Tab order take many calls, and the stage can leave
   * between two of them. So the phase is read before and after them, and the
   * result is `null` when the two differ: the caller reads again. The pointer
   * reading comes from the same task as the first phase reading.
   */
  async function reachable(page: Page, browserName: string) {
    const before = await page.evaluate(readReach, READ)
    const inTree = (await page.locator('body').ariaSnapshot())
      .split('\n')
      .filter((line) => line.includes(`link "${READ}"`)).length
    // The Tab order, from the top of the page. (Desktop WebKit moves to
    // links with Alt+Tab.) A blur alone is not enough: when focus was on the
    // opening's link as it left with the stage, the browser goes on from
    // where that link was, at the end of the page. So a stand-in at the
    // start of the body takes focus first, and leaves after the pass. It
    // keeps the one-link question apart from the focus handoff, which the
    // "keeps a place when the opening ends" cases below cover.
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
    await page.evaluate(() => {
      const start = document.createElement('span')
      start.tabIndex = -1
      start.dataset.tabStart = ''
      document.body.prepend(start)
      start.focus()
    })
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
    await page.evaluate(() =>
      document.querySelector('[data-tab-start]')?.remove()
    )
    const after = await page.evaluate(readReach, READ)
    if (before.stage !== after.stage) return null
    return {
      phase: (before.stage ? 'opening' : 'hero') as Place,
      places: before.places,
      inTree,
      tabbed: [...stops],
    }
  }

  /**
   * Records, in the page, a reading after every DOM change and on every
   * frame, from now until the page closes: each step of the handoff is read
   * in the task that made it. Reports how many readings showed exactly the
   * link of their phase, and the first readings that did not.
   */
  async function recordReach(page: Page) {
    await page.evaluate(readReach, READ)
    await page.evaluate(() => {
      const w = window as unknown as {
        __readReach: () => Reading
        __reachLog: {
          opening: number
          hero: number
          wrong: (Reading & { at: number })[]
        }
      }
      const log: typeof w.__reachLog = { opening: 0, hero: 0, wrong: [] }
      w.__reachLog = log
      const take = () => {
        const reading = w.__readReach()
        const phase = reading.stage ? 'opening' : 'hero'
        if (reading.places.length === 1 && reading.places[0] === phase)
          log[phase]++
        else if (log.wrong.length < 5)
          log.wrong.push({ ...reading, at: Math.round(performance.now()) })
      }
      take()
      new MutationObserver(take).observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
      })
      const frame = () => {
        take()
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    return () =>
      page.evaluate(
        () =>
          (window as unknown as { __reachLog: unknown }).__reachLog as {
            opening: number
            hero: number
            wrong: (Reading & { at: number })[]
          }
      )
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
    expect(await reachable(page, browserName)).toEqual(only('hero'))
    await link.tap()
    await toArticles(page)
  })

  /** Resolves once React has attached its handlers to the hero link. */
  const hydrated = (page: Page) =>
    expect
      .poll(() => reactAttached(page, '.hero-actions a[href="/articles"]'), {
        timeout: 15_000,
      })
      .toBe(true)
  const heroLink = (page: Page) =>
    page.locator('.hero-actions').getByRole('link', { name: READ })

  test('a hero link focused before the scripts run keeps focus, and Enter opens the article list', async ({
    page,
  }) => {
    await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await heroLink(page).focus()
    release()
    await hydrated(page)
    // The opening would have started by now; it leaves the reader's focus.
    await page.waitForTimeout(300)
    await expect(stage(page)).toHaveCount(0)
    await expect(heroLink(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await toArticles(page)
  })

  test('a press on the hero link that spans the scripts loading opens the article list', async ({
    page,
  }) => {
    await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const box = (await heroLink(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    release()
    await hydrated(page)
    await page.waitForTimeout(300)
    await expect(stage(page)).toHaveCount(0)
    await page.mouse.up()
    await toArticles(page)
  })

  test('focus elsewhere before the scripts run: the opening starts and "Skip opening" takes focus, as before', async ({
    page,
  }) => {
    await recordConvexMessages(page)
    const release = await holdPageScripts(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Articles', exact: true })
      .focus()
    release()
    await expect(stage(page)).toBeAttached({ timeout: 15_000 })
    await expect(
      page.getByRole('button', { name: 'Skip opening' })
    ).toBeFocused()
  })

  test('through the opening, exactly one reading link can be reached', async ({
    page,
    browserName,
  }) => {
    await recordConvexMessages(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(stage(page)).toBeAttached({ timeout: 10_000 })
    // Every reading from here on, across the handoff: never none, never two,
    // and the one link is the opening's while the stage is present and the
    // hero's once it is gone.
    const readings = await recordReach(page)
    // The tree and Tab reads, again and again through the 6.2 s sequence
    // until the stage has gone. A read across the handoff (the phase before
    // it differs from the phase after it) is not counted and is taken again;
    // every counted read must match its own phase.
    const phases: Place[] = []
    const deadline = Date.now() + 20_000
    while (phases.at(-1) !== 'hero' && Date.now() < deadline) {
      const read = await reachable(page, browserName)
      if (!read) continue
      expect(read).toEqual(only(read.phase))
      phases.push(read.phase)
    }
    // At least one counted read in each phase, the opening's first.
    expect(phases[0]).toBe('opening')
    expect(phases.at(-1)).toBe('hero')
    await expect(stage(page)).toHaveCount(0)
    const log = await readings()
    expect(log.wrong).toEqual([])
    expect(log.opening).toBeGreaterThan(0)
    expect(log.hero).toBeGreaterThan(0)
  })

  /**
   * Where focus is: the element's tag, its text, the part of the page it is
   * in, and its place in the Tab order counted from the hero's reading link
   * (0 is that link, 1 the next stop, -1 the one before; null when focus is
   * on no stop at all).
   */
  function focusPlace(name: string) {
    const stops = [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]'
      ),
    ].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        !element.closest('[inert]') &&
        element.getClientRects().length > 0
    )
    const hero = stops.find(
      (element) =>
        element.closest('.hero-actions') && element.textContent?.trim() === name
    )
    const focused = document.activeElement as HTMLElement | null
    const at = focused ? stops.indexOf(focused) : -1
    return {
      tag: focused?.tagName.toLowerCase() ?? null,
      text: (focused?.textContent ?? '').trim().slice(0, 40),
      part: !focused
        ? null
        : focused.closest('.opening-controls')
          ? 'opening controls'
          : focused.closest('.hero-actions')
            ? 'hero actions'
            : focused.closest('header, nav')
              ? 'navigation'
              : focused.closest('footer')
                ? 'footer'
                : focused.closest('main')
                  ? 'main'
                  : focused === document.body
                    ? 'body'
                    : 'other',
      fromHeroLink: at >= 0 && hero ? at - stops.indexOf(hero) : null,
    }
  }

  // Known gap #694 (focus order, WCAG 2.4.3): when the opening ends while its
  // reading link has keyboard focus, the link leaves with the stage and
  // focus falls to the body; the next key press goes on from where the link
  // was, at the end of the page. These cases record where the reader is and
  // are marked as expected to fail until the opening hands focus to the
  // hero's reading link, which is a separate change.
  for (const back of [false, true])
    test(`a keyboard reader on the opening's reading link keeps a place when the opening ends (${back ? 'Shift+Tab' : 'Tab'})`, async ({
      page,
      browserName,
    }) => {
      test.fail(
        true,
        'Known gap #694: focus falls to the body when the opening ends'
      )
      await recordConvexMessages(page)
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await expect(stage(page)).toBeAttached({ timeout: 10_000 })
      // To the opening's reading link by keyboard only: no blur, no stand-in.
      const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
      const link = page.locator('.opening-controls').getByRole('link', {
        name: READ,
      })
      for (let press = 0; press < 8; press++) {
        if (
          await link.evaluate((element) => element === document.activeElement)
        )
          break
        await page.keyboard.press(tab)
      }
      await expect(link).toBeFocused()
      await expect(stage(page)).toHaveCount(0, { timeout: 15_000 })
      // Two frames, for anything the opening does with focus as it leaves.
      await page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done))
          )
      )
      const ended = await page.evaluate(focusPlace, READ)
      await page.keyboard.press(
        back ? (browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab') : tab
      )
      const next = await page.evaluate(focusPlace, READ)
      console.log(
        `focus handoff ${browserName} ${back ? 'Shift+Tab' : 'Tab'}: ${JSON.stringify({ ended, next })}`
      )
      // A sensible place: focus is on the hero's reading link when the opening
      // ends, or the key press reaches that link or its neighbour in the
      // direction of travel.
      const sensible =
        ended.fromHeroLink === 0 ||
        next.fromHeroLink === 0 ||
        next.fromHeroLink === (back ? -1 : 1)
      expect(sensible, JSON.stringify({ ended, next })).toBe(true)
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
    expect(await reachable(page, browserName)).toEqual(only('hero'))

    const reduced = await browser.newContext({
      viewport: { width: 375, height: 812 },
      reducedMotion: 'reduce',
    })
    const calm = await reduced.newPage()
    await recordConvexMessages(calm)
    await calm.goto('/', { waitUntil: 'load' })
    await calm.waitForTimeout(500)
    await expect(stage(calm)).toHaveCount(0)
    expect(await reachable(calm, browserName)).toEqual(only('hero'))
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
