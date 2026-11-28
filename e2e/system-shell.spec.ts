import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectFocusWraps, expectOpensOnTitle } from './helpers/modalFocus'
import { signInPathFromRoutes } from '../lib/routing/signInPath'

// The application shell around the gallery, the sample reading page
// and the shell's own pages (e2e/fixtures/system): the bar or the rail with
// Today, Shelf, Write and the balance; the Pocket over the page; pushed
// screens; the bar stepping aside for the keyboard.

test.skip(
  !process.env.SYSTEM_FIXTURES,
  'Needs the design system fixture server (bun run test:e2e:fixtures --suite system)'
)

const wide = () => (test.info().project.use.viewport?.width ?? 0) >= 1024
const hasTouch = () => Boolean(test.info().project.use.hasTouch)

async function press(target: Locator) {
  if (hasTouch()) await target.tap()
  else await target.click()
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

test('one navigation: three places and the balance, as real links', async ({
  page,
}) => {
  await page.goto('/shelf')
  await expect(nav(page)).toHaveCount(1)
  const links = nav(page).getByRole('link')
  await expect(links).toHaveCount(wide() ? 5 : 4)
  await expect(nav(page).getByRole('link', { name: 'Today' })).toHaveAttribute(
    'href',
    '/'
  )
  await expect(nav(page).getByRole('link', { name: 'Write' })).toHaveAttribute(
    'href',
    '/write'
  )
  const shelf = nav(page).getByRole('link', { name: 'Shelf' })
  await expect(shelf).toHaveAttribute('href', '/shelf')
  await expect(shelf).toHaveAttribute('aria-current', 'page')
  const balance = nav(page).getByRole('link', {
    name: 'Balance, 18 dollars 40. Open balance',
  })
  await expect(balance).toHaveAttribute('href', '/pocket')
  await expect(balance).toContainText('$18.40')
  if (wide()) {
    await expect(page.locator('.qt-rail')).toBeVisible()
    await expect(page.locator('.qt-navbar')).toBeHidden()
  } else {
    await expect(page.locator('.qt-navbar')).toBeVisible()
    await expect(page.locator('.qt-rail')).toBeHidden()
    for (const link of await links.all()) {
      const box = await link.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
    }
  }
})

test('signed out, the balance item reads Sign in', async ({ page }) => {
  await page.goto('/shelf?balance=signed-out')
  const item = nav(page).getByRole('link', { name: 'Sign in' })
  await expect(item).toBeVisible()
  await expect(item).toHaveAttribute('href', signInPathFromRoutes())
})

test('the balance opens the Pocket over the page and gives focus back', async ({
  page,
}) => {
  await page.goto('/shelf')
  const item = nav(page).getByRole('link', { name: /^Balance/ })
  await press(item)
  await expect(page).toHaveURL(/\/shelf/)
  const pocket = wide()
    ? page.getByRole('complementary', { name: 'Balance' })
    : page.getByRole('dialog', { name: 'Balance' })
  await expect(pocket).toBeVisible()
  await expect(pocket.locator('.qt-money')).toContainText('$18.40')
  await expect(pocket.getByText('Ready to tip')).toBeVisible()
  await expect(pocket.getByText('Testnet. Practice money only.')).toBeVisible()
  await expect(pocket.getByRole('heading', { name: 'Balance' })).toBeFocused()
  expect(
    await page.evaluate(
      () => getComputedStyle(document.activeElement as Element).outlineStyle
    )
  ).toBe('none')
  // The page underneath is still there.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Shelf' })
  ).toBeAttached()
  await page.keyboard.press('Escape')
  await expect(pocket).toBeHidden()
  // Back on the item, opened by a tap or a click as well (Safari focuses no
  // pressed link, so the sheet remembers what was pressed).
  await expect(item).toBeFocused()
  await expect(item).toHaveAttribute('aria-expanded', 'false')
})

/** The first family of the reading variable on <html>. */
const readingLead = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue('--qt-face-read')
      .split(',')[0]!
      .trim()
      .replace(/["']/g, '')
  )

/** A client change of path, as a link makes. */
const goTo = (page: Page, path: string) =>
  page.evaluate((to) => {
    history.pushState({}, '', to)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)

// Loaded when the page is idle, after late fonts on a slow runner too.
const secondNameLoaded = (page: Page) =>
  expect(page.locator('html')).toHaveAttribute(
    'data-reading-faces-loaded',
    /\blatin\b/,
    { timeout: 15_000 }
  )

test('the next page reads in the loaded face under its second name', async ({
  page,
}) => {
  await page.goto('/reading')
  await secondNameLoaded(page)
  // Inside the page view nothing changes.
  expect(await readingLead(page)).toBe('Literata Fixture')
  await goTo(page, '/shelf')
  await expect.poll(() => readingLead(page)).toBe('Literata Fixture Next')
})

test('no face changes at a change of page while a sheet or panel is up', async ({
  page,
}) => {
  test.skip(!wide(), 'The rail, with its balance item, shows from 1024 px')
  await page.goto('/reading')
  await secondNameLoaded(page)
  await press(nav(page).getByRole('link', { name: /^Balance/ }))
  const pocket = page.getByRole('complementary', { name: 'Balance' })
  await expect(pocket).toBeVisible()
  await goTo(page, '/shelf')
  await expect(pocket).toBeHidden()
  expect(await readingLead(page)).toBe('Literata Fixture')
  // The next change, with nothing up.
  await goTo(page, '/reading')
  await expect.poll(() => readingLead(page)).toBe('Literata Fixture Next')
})

/** The first family of a reading variable on <html>. */
const lead = (page: Page, variable: string) =>
  page.evaluate(
    (name) =>
      getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .split(',')[0]!
        .trim()
        .replace(/["']/g, ''),
    variable
  )

test('a face not yet loaded under its second name keeps its first name', async ({
  page,
}) => {
  // The italic file answers late: its second name is not loaded at the
  // first change of page, the roman's is.
  await page.route('**/fonts/literata-latin-italic.woff2', async (route) => {
    await new Promise((done) => setTimeout(done, 4000))
    await route.continue().catch(() => {})
  })
  await page.goto('/reading', { waitUntil: 'domcontentloaded' })
  await secondNameLoaded(page)
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-reading-faces-loaded',
    /latinItalic/
  )
  await goTo(page, '/shelf')
  await expect
    .poll(() => lead(page, '--qt-face-read'))
    .toBe('Literata Fixture Next')
  expect(await lead(page, '--qt-face-read-italic')).toBe(
    'Literata Fixture Italic'
  )
  // Once it loads, a later change of page switches it.
  await expect(page.locator('html')).toHaveAttribute(
    'data-reading-faces-loaded',
    /latinItalic/,
    { timeout: 15_000 }
  )
  await goTo(page, '/reading')
  await expect
    .poll(() => lead(page, '--qt-face-read-italic'))
    .toBe('Literata Fixture Italic Next')
})

test('the balance figure changing face at a change of page moves no nav item', async ({
  page,
}) => {
  // Every font late: the first view stays in the fallback, the next page
  // reads in Literata.
  await page.route('**/fonts/*.woff2', async (route) => {
    await new Promise((done) => setTimeout(done, 1500))
    await route.continue().catch(() => {})
  })
  await page.goto('/shelf', { waitUntil: 'domcontentloaded' })
  const figure = nav(page).locator('[data-balance]:visible .qt-money')
  await expect(figure).toBeVisible()
  await secondNameLoaded(page)
  const items = () =>
    nav(page)
      .locator('a:visible')
      .evaluateAll((links) =>
        links.map((a) => {
          const r = a.getBoundingClientRect()
          return [r.x, r.y, r.width, r.height].map(Math.round).join(',')
        })
      )
  const before = await items()
  const width = () => figure.evaluate((el) => el.getBoundingClientRect().width)
  const figureBefore = await width()
  await goTo(page, '/pocket')
  await expect
    .poll(() => lead(page, '--qt-face-read'))
    .toBe('Literata Fixture Next')
  expect(await items()).toEqual(before)
  // The figure itself may change width inside its fixed slot.
  test.info().annotations.push({
    type: 'figure width',
    description: `${figureBefore.toFixed(1)} px to ${(await width()).toFixed(1)} px`,
  })
})

/** A surface renames its page inside the view (shell/address.ts). */
const renameInView = (page: Page, path: string) =>
  page.evaluate((to) => {
    ;(
      window as unknown as { __replaceAddressInView: (url: string) => void }
    ).__replaceAddressInView(to)
  }, path)

const historyNow = (page: Page) =>
  page.evaluate(() => {
    const h = (
      window as unknown as {
        __appHistory: { canGoBack: () => boolean; pages: () => string[] }
      }
    ).__appHistory
    return { canGoBack: h.canGoBack(), pages: h.pages() }
  })

test('an address change inside the view switches no face, and the next page does', async ({
  page,
}) => {
  await page.route('**/fonts/*.woff2', async (route) => {
    await new Promise((done) => setTimeout(done, 1500))
    await route.continue().catch(() => {})
  })
  await page.goto('/reading', { waitUntil: 'domcontentloaded' })
  await secondNameLoaded(page)
  await renameInView(page, '/reading-renamed')
  await expect(page).toHaveURL(/\/reading-renamed$/)
  await page.waitForTimeout(200)
  expect(await lead(page, '--qt-face-read')).toBe('Literata Fixture')
  // A real change of page after it upgrades as usual.
  await goTo(page, '/shelf')
  await expect
    .poll(() => lead(page, '--qt-face-read'))
    .toBe('Literata Fixture Next')
})

test('an address change inside the view keeps the sheet open and the history entry', async ({
  page,
}) => {
  await page.goto('/shelf')
  await press(nav(page).getByRole('link', { name: /^Balance/ }))
  const pocket = wide()
    ? page.getByRole('complementary', { name: 'Balance' })
    : page.getByRole('dialog', { name: 'Balance' })
  await expect(pocket).toBeVisible()
  const before = await historyNow(page)
  await renameInView(page, '/shelf-renamed')
  await expect(page).toHaveURL(/\/shelf-renamed$/)
  await page.waitForTimeout(300)
  await expect(pocket).toBeVisible()
  // The same entry with a new path: back goes where it went before.
  const after = await historyNow(page)
  expect(after.canGoBack).toBe(before.canGoBack)
  expect(after.pages).toEqual([...before.pages.slice(0, -1), '/shelf-renamed'])
})

/** Every text block's place in the page's layout (not on screen). */
/** The sample article ends within one screen at 768 and 1440: more text
 * in the article, before its dock (sticky to the article's end), so a
 * scroll stays clear of the page's end, where the header shows. */
const lengthen = (page: Page) =>
  page.evaluate(() => {
    const dock = document.querySelector('.qt-dock')
    const main = document.querySelector('main')!
    for (let i = 0; i < 12; i += 1) {
      const p = document.createElement('p')
      p.textContent = 'More of the article, for room to scroll. '.repeat(20)
      if (dock) dock.before(p)
      else main.append(p)
    }
  })

const textLayout = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main p, main h1, main h2')]
      // The text of the page, not the header that slides over it.
      .filter((el) => !el.closest('.qt-pushed__header'))
      .map((el) => {
        let top = 0
        for (
          let n: HTMLElement | null = el;
          n;
          n = n.offsetParent as HTMLElement | null
        )
          top += n.offsetTop
        return top
      })
      .join(',')
  )

const pushedHeader = (page: Page) => page.locator('.qt-pushed__header')
// The header's scroll behavior loads after the page's first load
// (shell/headerOnScroll.ts): the tests scroll once it watches.
async function openReading(page: Page) {
  await page.goto('/reading')
  await expect(pushedHeader(page)).toHaveAttribute('data-watching', '')
  await lengthen(page)
}

test('the pushed header leaves on a scroll down and returns on the reader’s scroll up, moving no text', async ({
  page,
}) => {
  await openReading(page)
  const header = pushedHeader(page)
  await expect(header).toBeVisible()
  const layout = await textLayout(page)
  await page.mouse.move(200, 400)
  await page.mouse.wheel(0, 900)
  await expect(header).toHaveAttribute('data-hidden', '')
  expect(await textLayout(page), 'hiding it').toBe(layout)
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue(
          '--qt-pushed-header-h'
        )
      )
    )
    .toBe('0px')
  // The reader scrolls up a little: it is back, over the page.
  await page.mouse.wheel(0, -120)
  await expect(header).not.toHaveAttribute('data-hidden', '')
  expect(await textLayout(page), 'showing it').toBe(layout)
  const height = Math.round((await header.boundingBox())!.height)
  const vars = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return {
      h: style.getPropertyValue('--qt-pushed-header-h'),
      padding: parseFloat(style.scrollPaddingTop),
    }
  })
  expect(vars.h).toBe(`${height}px`)
  expect(vars.padding).toBeGreaterThanOrEqual(height)
  // Once its slide back has ended.
  await expect
    .poll(async () => Math.round((await header.boundingBox())!.y))
    .toBe(0)
})

test('the pushed header carries the title only after 140 px of scroll', async ({
  page,
}) => {
  await openReading(page)
  const title = pushedHeader(page).locator('.qt-pushed__title')
  await expect(title).not.toHaveAttribute('data-shown', '')
  await page.mouse.move(200, 400)
  await page.mouse.wheel(0, 400)
  await page.mouse.wheel(0, -60)
  await expect(title).toHaveAttribute('data-shown', '')
  await expect(title).toBeVisible()
})

test('a scroll by script never brings the pushed header back', async ({
  page,
}) => {
  await openReading(page)
  const header = pushedHeader(page)
  await page.mouse.move(200, 400)
  await page.mouse.wheel(0, 1200)
  await expect(header).toHaveAttribute('data-hidden', '')
  // Later than the reader's own input counts (INTENT_MS, 300 ms): a place
  // restored or an anchor landed, above where the reader is.
  await page.waitForTimeout(400)
  await page.evaluate(() => window.scrollTo(0, window.scrollY - 400))
  await page.waitForTimeout(400)
  await expect(header).toHaveAttribute('data-hidden', '')
})

test('the way back is reachable by keyboard at any depth', async ({
  page,
  browserName,
}) => {
  await openReading(page)
  const header = pushedHeader(page)
  await page.mouse.move(200, 400)
  await page.mouse.wheel(0, 1500)
  await expect(header).toHaveAttribute('data-hidden', '')
  const y = await page.evaluate(() => window.scrollY)
  // From the first control after the header, one step back: the header's
  // last control.
  await page.evaluate(() => {
    const header = document.querySelector('.qt-pushed__header')!
    const next = [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled)'
      ),
    ].find(
      (el) =>
        !header.contains(el) &&
        header.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
    )!
    next.focus({ preventScroll: true })
  })
  await page.keyboard.press(
    browserName === 'webkit' ? 'Shift+Alt+Tab' : 'Shift+Tab'
  )
  await expect(header).not.toHaveAttribute('data-hidden', '')
  expect(
    await header.evaluate((el) => el.contains(document.activeElement))
  ).toBe(true)
  // In view once the header has slid back in.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const r = document.activeElement!.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= window.innerHeight
      })
    )
    .toBe(true)
  expect(await page.evaluate(() => window.scrollY), 'no scroll').toBe(y)
})

test('a change of path closes the sheets over the old page', async ({
  page,
}) => {
  test.skip(wide(), 'On a desktop the balance is a panel, not a sheet')
  await page.goto('/shelf')
  await press(nav(page).getByRole('link', { name: /^Balance/ }))
  const pocket = page.getByRole('dialog', { name: 'Balance' })
  await expect(pocket).toBeVisible()
  // A client navigation, as a link inside the sheet would make.
  await page.evaluate(() => {
    history.pushState({}, '', '/')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(pocket).toBeHidden()
})

test('while no amount is known, the item reads Balance, not a figure', async ({
  page,
}) => {
  await page.goto('/shelf?balance=unavailable')
  const item = nav(page).getByRole('link', { name: 'Balance' })
  await expect(item).toHaveText('Balance')
  await expect(item).not.toContainText('$')
})

test('signed out, a registered sign-in sheet opens over the page', async ({
  page,
}) => {
  await page.goto('/shelf?balance=signed-out&signin=sheet')
  await press(nav(page).getByRole('link', { name: 'Sign in' }))
  const sheet = page.getByRole('dialog', { name: 'Sign in to Quilltip' })
  await expect(sheet).toBeVisible()
  await expect(page).toHaveURL(/\/shelf/)
  await expect(
    sheet.getByRole('heading', { name: 'Sign in to Quilltip' })
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

for (const [width, height, keyboard] of [
  [390, 844, 336],
  [360, 640, 260],
] as const)
  test(`a sheet with a field stays above the keyboard (${width} by ${height})`, async ({
    page,
  }) => {
    test.skip(wide(), 'Phone widths')
    await page.setViewportSize({ width, height })
    // A visual viewport the test can shrink, as the on-screen keyboard does
    // in iOS Safari (the layout stays; the visible area gets shorter).
    await page.addInitScript(() => {
      const viewport = new EventTarget()
      let covered = 0
      Object.defineProperties(viewport, {
        height: { get: () => window.innerHeight - covered },
        width: { get: () => window.innerWidth },
        offsetTop: { get: () => 0 },
        offsetLeft: { get: () => 0 },
        pageTop: { get: () => window.scrollY },
        scale: { get: () => 1 },
      })
      Object.defineProperty(window, 'visualViewport', {
        value: viewport,
        configurable: true,
      })
      ;(window as unknown as { __keyboard: (h: number) => void }).__keyboard = (
        h
      ) => {
        covered = h
        viewport.dispatchEvent(new Event('resize'))
      }
    })
    const setKeyboard = (h: number) =>
      page.evaluate((px) => {
        ;(window as unknown as { __keyboard: (h: number) => void }).__keyboard(
          px
        )
      }, h)
    await page.goto('/shelf?balance=signed-out&signin=sheet')
    await page.evaluate(() => window.scrollTo(0, 200))
    const scrolled = await page.evaluate(() => window.scrollY)
    await press(nav(page).getByRole('link', { name: 'Sign in' }))
    const sheet = page.getByRole('dialog', { name: 'Sign in to Quilltip' })
    await expect(sheet).toBeVisible()
    const field = sheet.getByLabel('Password')
    await field.focus()
    await setKeyboard(keyboard)
    const visible = height - keyboard
    const inView = async (name: string, locator: Locator) => {
      await expect
        .poll(
          async () => {
            const box = (await locator.boundingBox())!
            return box.y >= 0 && box.y + box.height <= visible
          },
          { message: `${name} inside the visible area (0 to ${visible} px)` }
        )
        .toBe(true)
    }
    await inView('the focused field', field)
    await inView(
      'the primary action',
      sheet.getByRole('button', { name: 'Sign in' })
    )
    await inView(
      'the other way in',
      sheet.getByRole('button', { name: 'Create an account' })
    )
    await expect(field).toBeFocused()
    expect(await page.evaluate(() => window.scrollY), 'the page behind').toBe(
      scrolled
    )
    // The keyboard closes: the sheet is back at the bottom.
    await setKeyboard(0)
    await expect
      .poll(async () => {
        const panel = (await sheet.locator('.qt-modal__panel').boundingBox())!
        return Math.round(panel.y + panel.height)
      })
      .toBe(height)
  })

test('a declared sheet opens before its code has loaded, then fills in', async ({
  page,
}) => {
  await page.goto('/sheets')
  await press(page.getByRole('button', { name: 'Open the lazy sheet' }))
  const sheet = page.getByRole('dialog', { name: 'Add money to tip $3' })
  await expect(sheet).toBeVisible()
  await expect(
    sheet.getByRole('heading', { name: 'Add money to tip $3' })
  ).toBeFocused()
  await expect(sheet.getByText('Loaded on demand for $3.')).toBeVisible()
  await expect(sheet.locator('[aria-busy="true"]')).toHaveCount(0)
  await press(sheet.getByRole('button', { name: 'Done' }))
  await expect(sheet).toBeHidden()
})

test('while a first open waits for its code, the control looks pressed; past the wait the placeholder shows', async ({
  page,
}) => {
  await page.goto('/sheets')
  const opener = page.getByRole('button', { name: 'Open the lazy sheet' })
  // Recorded by order, not by a time window: the mark set (with the style
  // it gives), the mark removed, and the sheet opened.
  await opener.evaluate((el) => {
    const w = window as unknown as { __events: string[] }
    w.__events = []
    new MutationObserver(() => {
      if (el.hasAttribute('data-opening')) {
        // The pressed style itself, not a frame of its transition.
        const button = el as HTMLElement
        button.style.transition = 'none'
        const transform = getComputedStyle(button).transform
        button.style.transition = ''
        w.__events.push(`set ${transform}`)
      } else w.__events.push('removed')
    }).observe(el, { attributes: true, attributeFilter: ['data-opening'] })
    new MutationObserver(() => {
      if (
        document.querySelector('dialog[open]') &&
        !w.__events.includes('open')
      )
        w.__events.push('open')
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    })
  })
  await press(opener)
  // The demo sheet's code takes 400 ms: past the 200 ms wait the sheet
  // draws with its placeholder, then fills in.
  const sheet = page.getByRole('dialog', { name: 'Add money to tip $3' })
  await expect(sheet.getByText('Loaded on demand for $3.')).toBeVisible()
  const events = await page.evaluate(
    () => (window as unknown as { __events: string[] }).__events
  )
  expect(events[0]).toMatch(/^set matrix/)
  expect(events[0]).not.toBe('set none')
  expect(events.slice(1)).toEqual(['removed', 'open'])
  await expect(opener).not.toHaveAttribute('data-opening')
})

test('a sheet whose code fails to load says so and tries again', async ({
  page,
}) => {
  await page.goto('/sheets')
  await press(
    page.getByRole('button', { name: 'Open the sheet that fails once' })
  )
  const sheet = page.getByRole('dialog', { name: 'Withdraw' })
  await expect(sheet.getByText('This did not load')).toBeVisible()
  await press(sheet.getByRole('button', { name: 'Try again' }))
  await expect(sheet.getByText('Loaded on demand.')).toBeVisible()
})

test('a converted balance reads about, and every state keeps the slot width', async ({
  page,
}) => {
  await page.goto('/shelf?balance=converted')
  const item = nav(page).getByRole('link', {
    name: 'Balance, about 18 dollars 40. Open balance',
  })
  await expect(item).toContainText('≈')
  await expect(item).toContainText('$18')
  const widths: number[] = []
  for (const state of [
    'converted',
    'ready',
    'loading',
    'unavailable',
    'signed-out',
  ]) {
    await page.goto(`/shelf?balance=${state}`)
    const slot = nav(page).locator('.qt-balance-slot:visible')
    await expect(slot).toBeVisible()
    widths.push(Math.round((await slot.boundingBox())!.width))
  }
  expect(new Set(widths).size).toBe(1)
})

test('the docked tip bar opens and closes its amounts without moving the page', async ({
  page,
}) => {
  await page.goto('/reading')
  await lengthen(page)
  await page.evaluate(() => window.scrollTo(0, 900))
  await page.waitForTimeout(200)
  const at = () => page.evaluate(() => Math.round(window.scrollY))
  const start = await at()
  expect(start).toBeGreaterThan(0)
  const dock = page.locator('.qt-dock')
  const amount = dock.getByRole('button', { name: 'Change amount' })
  // Raw input at the control's centre: Playwright's own scroll before a
  // press moves a page under a sticky dock, and that is not the product's.
  const pressHere = async (target: Locator) => {
    const box = (await target.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    if (hasTouch()) await page.touchscreen.tap(x, y)
    else await page.mouse.click(x, y)
  }
  // Closed by Escape: focus returns to the amount control.
  await pressHere(amount)
  await expect(dock.getByRole('radiogroup')).toBeVisible()
  expect(await at(), 'opening the amounts').toBe(start)
  await page.keyboard.press('Escape')
  await expect(dock.getByRole('radiogroup')).toBeHidden()
  await expect(amount).toBeFocused()
  expect(await at(), 'closing the amounts by Escape').toBe(start)
  // Closed by choosing an amount.
  await pressHere(amount)
  await expect(dock.getByRole('radiogroup')).toBeVisible()
  await pressHere(dock.getByRole('radio', { name: '$3', exact: true }))
  await expect(dock.getByRole('radiogroup')).toBeHidden()
  expect(await at(), 'closing the amounts by a choice').toBe(start)
})

for (const width of [360, 390]) {
  test(`a toast never covers the docked tip bar (${width} px)`, async ({
    page,
  }) => {
    test.skip(wide(), 'Phone widths')
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/reading')
    const dock = page.locator('.qt-dock')
    await press(dock.getByRole('button', { name: /^Tip Tomás/ }))
    const toast = page
      .locator('.qt-toast')
      .filter({ hasText: 'You tipped Tomás' })
    await expect(toast).toBeVisible()
    const a = (await toast.boundingBox())!
    const b = (await dock.boundingBox())!
    const overlap =
      a.x < b.x + b.width &&
      b.x < a.x + a.width &&
      a.y < b.y + b.height &&
      b.y < a.y + a.height
    expect(
      overlap,
      `toast ${JSON.stringify(a)} dock ${JSON.stringify(b)}`
    ).toBe(false)
  })
}

test('when the balance code fails to load, the overlay says so and the page stays', async ({
  page,
}) => {
  await page.goto('/shelf?pocket=fail')
  await press(nav(page).getByRole('link', { name: /^Balance/ }))
  const pocket = wide()
    ? page.getByRole('complementary', { name: 'Balance' })
    : page.getByRole('dialog', { name: 'Balance' })
  await expect(pocket.getByText('This did not load')).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Shelf' })
  ).toBeAttached()
  await page.evaluate(() => {
    ;(window as unknown as { __pocketLoads: boolean }).__pocketLoads = true
  })
  await press(pocket.getByRole('button', { name: 'Try again' }))
  await expect(pocket.getByText('Ready to tip')).toBeVisible()
})

test('the Pocket page, for links and for no script', async ({ page }) => {
  await page.goto('/pocket')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Balance' })
  ).toBeVisible()
  await expect(page.getByText('Ready to tip')).toBeVisible()
  if (!wide()) await expect(page.locator('.qt-navbar')).toBeHidden()
})

test('a pushed screen hides the phone bar, keeps a way back, and does not animate on arrival', async ({
  page,
}) => {
  await page.goto('/reading')
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'What my grandmother’s ledger taught me about money',
    })
  ).toBeVisible()
  await expect(page.locator('.qt-navbar')).toBeHidden()
  await expect(page.locator('.qt-pushed')).not.toHaveAttribute(
    'data-arrived',
    /.*/
  )
  await expect(
    page.getByRole('link', { name: 'Back to reading' })
  ).toHaveAttribute('href', '/')
  await expect(
    page.getByRole('link', { name: 'Read more articles' })
  ).toHaveAttribute('href', '/articles')
})

test('the phone bar sits above the content, never over the last line', async ({
  page,
}) => {
  test.skip(wide(), 'Phone and tablet')
  await page.goto('/')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const bar = await page.locator('.qt-navbar .qt-navbar__list').boundingBox()
  const last = await page.locator('.qt-gallery__section').last().boundingBox()
  expect(last!.y + last!.height).toBeLessThanOrEqual(bar!.y)
})

test('the phone bar steps aside while the keyboard is up', async ({ page }) => {
  test.skip(!hasTouch() || wide(), 'Touch phones and tablets')
  await page.goto('/')
  const bar = page.locator('.qt-navbar')
  await expect(bar).toBeVisible()
  await page.getByRole('textbox', { name: 'Name on your tips' }).tap()
  await expect(bar).toBeHidden()
  // A checkbox raises no keyboard: the bar stays.
  await page.getByText('Refuse the next tip').tap()
  await expect(bar).toBeVisible()
})

test('the skip link moves focus to the content', async ({
  page,
  browserName,
}) => {
  await page.goto('/')
  // The fixture renders in the browser: the link is there to take the key.
  await expect(page.locator('.qt-shell')).toBeVisible()
  // WebKit, like Safari, includes links in the Tab order only with Option.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
  await page.keyboard.press('Enter')
  await expect(page.locator('#content')).toBeFocused()
})

test('every sheet: title first, focus wraps, Escape and Close return it', async ({
  page,
}) => {
  // The balance, as a sheet on a phone.
  if (!wide()) {
    await page.goto('/shelf')
    const item = nav(page).getByRole('link', { name: /^Balance/ })
    await item.focus()
    await page.keyboard.press('Enter')
    const pocket = page.getByRole('dialog', { name: 'Balance' })
    await expectOpensOnTitle(pocket)
    await expectFocusWraps(page, pocket)
    await page.keyboard.press('Escape')
    await expect(pocket).toBeHidden()
    await expect(item).toBeFocused()
  }

  // A sheet that loads on demand: still on its title once its body arrives.
  await page.goto('/sheets')
  const opener = page.getByRole('button', { name: 'Open the lazy sheet' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const lazy = page.getByRole('dialog', { name: 'Add money to tip $3' })
  await expect(lazy.getByText('Loaded on demand for $3.')).toBeVisible()
  await expectOpensOnTitle(lazy)
  await expectFocusWraps(page, lazy)
  await lazy.getByRole('button', { name: 'Close' }).focus()
  await page.keyboard.press('Enter')
  await expect(lazy).toBeHidden()
  await expect(opener).toBeFocused()
})

test('with its opener gone, a closed sheet gives focus to the page, never the body', async ({
  page,
}) => {
  await page.goto('/sheets')
  await page.getByRole('button', { name: 'Open, and the opener goes' }).focus()
  await page.keyboard.press('Enter')
  const sheet = page.getByRole('dialog', { name: 'The opener is gone' })
  await expectOpensOnTitle(sheet)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
    .toBe('content')
})

test('a sheet that goes while the page moves focus leaves focus there', async ({
  page,
}) => {
  await page.goto('/sheets')
  const opener = page.getByRole('button', {
    name: 'Open, then the page moves on',
  })
  await opener.focus()
  await page.keyboard.press('Enter')
  const sheet = page.getByRole('dialog', { name: 'The page moves on' })
  await expectOpensOnTitle(sheet)
  await sheet.getByRole('button', { name: 'Go on' }).focus()
  await page.keyboard.press('Enter')
  await expect(sheet).toHaveCount(0)
  await page.waitForTimeout(400) // past the sheet's exit
  await expect(
    page.getByRole('button', { name: 'Where the page went' })
  ).toBeFocused()
})

test('while auth loads with a held token, the Balance item opens the balance', async ({
  page,
}) => {
  await page.goto('/shelf?balance=auth-loading')
  await page.evaluate(() =>
    localStorage.setItem('__convexAuthJWT_test', 'held')
  )
  await page.reload()
  // The fixture runs no pre-paint script, so the word on the item is not
  // the point here: where it goes, and what a press does, are.
  const item = nav(page).locator('[data-balance]:visible')
  await expect(item).toHaveAttribute('href', '/pocket')
  await press(item)
  // Over the page, not off to the sign-in page.
  await expect(page).toHaveURL(/\/shelf\?balance=auth-loading$/)
  const pocket = wide()
    ? page.getByRole('complementary', { name: 'Balance' })
    : page.getByRole('dialog', { name: 'Balance' })
  await expect(pocket).toBeVisible()
})

test('while auth loads with no token, the item is still the way to sign in', async ({
  page,
}) => {
  await page.goto('/shelf?balance=auth-loading')
  const item = nav(page).locator('[data-balance]:visible')
  await expect(item).toHaveAttribute('href', /\/(login|signin)/)
})
