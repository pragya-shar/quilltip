import { expect, test, type Locator, type Page } from '@playwright/test'
import { ARTICLE_PATH, LINES, TITLE } from './fixtures/read/article'

// The article view on the application shell, on a fake payments runtime
// (e2e/fixtures/read). Real input only: touch taps on touch contexts, keys
// on the keyboard, mouse drags on the desktop. No synthetic events and no
// `force`. Each test has its own run id, so the fixture server keeps its
// tips and saved lines apart.

let run = ''
test.beforeEach(({}, info) => {
  run = `${info.project.name}-${info.testId}-${Date.now()}`
})

const touch = (page: Page) =>
  page.context().browser() !== null && test.info().project.use.hasTouch === true
const isWebKit = (page: Page) =>
  page.context().browser()?.browserType().name() === 'webkit'
/** Tab, with WebKit's option that includes buttons (as Safari's setting). */
const tabKey = (page: Page) => (isWebKit(page) ? 'Alt+Tab' : 'Tab')

async function open(page: Page, query = '') {
  await page.goto(`${ARTICLE_PATH}?run=${run}${query}`)
  await expect(
    page.getByRole('heading', { level: 1, name: TITLE })
  ).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

/**
 * A finger tap or a mouse click at the middle of `target`, as a person
 * makes it. Playwright's own tap scrolls a sticky element "into view" first,
 * which no finger does, so the point is pressed directly.
 */
async function press(page: Page, target: Locator) {
  await expect(target).toBeVisible()
  let box = await target.boundingBox()
  const viewport = page.viewportSize()!
  if (!box || box.y < 0 || box.y + box.height > viewport.height) {
    await target.scrollIntoViewIfNeeded()
    box = await target.boundingBox()
  }
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  if (touch(page)) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

/** The middle of `needle` in the body, scrolled to the middle of the screen. */
async function pointAt(page: Page, needle: string) {
  return page.evaluate((needle) => {
    const body = document.getElementById('read-body')!
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(needle)
      if (at < 0) continue
      const range = document.createRange()
      const middle = at + Math.floor(needle.length / 2)
      range.setStart(node, middle)
      range.setEnd(node, middle + 1)
      node.parentElement!.scrollIntoView({
        block: 'center',
        behavior: 'instant',
      })
      const rect = range.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }
    throw new Error(`Not in the body: ${needle}`)
  }, needle)
}

/** A tap (touch) or a click (mouse) on a sentence in the text. */
async function tapLine(page: Page, needle: string) {
  const { x, y } = await pointAt(page, needle)
  if (touch(page)) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

async function server(page: Page) {
  const response = await page.request.get(`/api/tips?run=${run}`)
  return (await response.json()) as {
    requests: number
    accepted: {
      requestId: string
      cents: number
      target: { kind: string; passage?: { text: string } }
    }[]
  }
}

const TITLE_FOR_PLACE = TITLE

const tipButton = (page: Page) =>
  page.locator('.qt-read__dock').getByRole('button', { name: /^Tip/ })
const chosenTick = (page: Page) =>
  page.locator('.qt-read__tick[data-kind="chosen"]')

test('the article reads in full with its title, byline and end', async ({
  page,
}) => {
  await open(page)
  await expect(page.getByRole('link', { name: 'Tomás Reyes' })).toHaveAttribute(
    'href',
    '/tomas'
  )
  await expect(page.getByText('6 min read')).toBeVisible()
  await expect(page.locator('#read-body')).toContainText(LINES.late)
  await expect(page.locator('#read-body h2#the-line')).toHaveText('The line')
  await expect(
    page.getByRole('link', {
      name: 'Read more: The last keeper of the Ras al-Hadd light',
    })
  ).toHaveAttribute('href', '/noor/the-last-keeper')
  // Signed in with a balance: the caption states it once, with testnet.
  await expect(page.locator('.qt-read__wallet')).toContainText('$18.40')
  await expect(page.locator('.qt-read__wallet')).toContainText('Testnet')
  await expect(tipButton(page)).toHaveAccessibleName('Tip $1')
})

test('a tap on a line chooses that sentence, for free, and a second tap lets it go', async ({
  page,
}) => {
  await open(page)
  await tapLine(page, 'person next to')
  await expect(tipButton(page)).toHaveAccessibleName('Tip this line $1')
  await expect(chosenTick(page)).toBeVisible()
  // Not colour alone: the chosen line is underlined (a highlight or a mark).
  const painted = await page.evaluate(() => {
    const css = CSS as unknown as {
      highlights?: Map<string, { size?: number }>
    }
    return css.highlights
      ? css.highlights.has('qt-read-chosen')
      : document.querySelector('mark[data-targeted]') !== null
  })
  expect(painted).toBe(true)
  expect((await server(page)).requests).toBe(0)

  await tapLine(page, 'person next to')
  await expect(tipButton(page)).toHaveAccessibleName('Tip $1')
  await expect(chosenTick(page)).toHaveCount(0)
})

test('Clear lets the chosen line go', async ({ page }) => {
  await open(page)
  await tapLine(page, 'boy who carried')
  await expect(tipButton(page)).toHaveAccessibleName('Tip this line $1')
  await press(page, page.getByRole('button', { name: 'Clear the line' }))
  await expect(tipButton(page)).toHaveAccessibleName('Tip $1')
})

test('a tip on a line is sent once, keeps the line in view, and has a receipt', async ({
  page,
}) => {
  await open(page)
  await tapLine(page, 'person next to')
  await press(page, tipButton(page))
  const status = page.locator('.qt-read__dock .qt-tip__button')
  await expect(status).toContainText('Sent')
  await expect(status).toBeFocused()

  const { accepted, requests } = await server(page)
  expect(requests).toBe(1)
  expect(accepted).toHaveLength(1)
  expect(accepted[0]!.cents).toBe(100)
  expect(accepted[0]!.target.passage?.text).toBe(LINES.gate)

  // The tipped line stays visible above the dock and the confirmation.
  const toast = page.getByText('You tipped Tomás')
  await expect(toast).toBeVisible()
  const measure = () =>
    page.evaluate((line) => {
      const body = document.getElementById('read-body')!
      const at = body.textContent!.indexOf(line)
      void at
      const marks = (CSS as unknown as { highlights?: Map<string, unknown> })
        .highlights
      const dock = document
        .querySelector('.qt-read__dock')!
        .getBoundingClientRect()
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const i = node.textContent!.indexOf(line)
        if (i < 0) continue
        const range = document.createRange()
        range.setStart(node, i)
        range.setEnd(node, i + line.length)
        const rect = range.getBoundingClientRect()
        return {
          top: rect.top,
          bottom: rect.bottom,
          dockTop: dock.top,
          tipped: marks ? marks.has('qt-read-tipped') : true,
        }
      }
      return null
    }, LINES.gate)
  // Settled: the view may scroll the line up smoothly.
  await expect
    .poll(async () => {
      const at = await measure()
      return at !== null && at.top >= 0 && at.bottom < at.dockTop
    })
    .toBe(true)
  const visible = await measure()
  expect(visible).not.toBeNull()
  expect(visible!.top).toBeGreaterThanOrEqual(0)
  expect(visible!.bottom).toBeLessThan(visible!.dockTop)
  expect(visible!.tipped).toBe(true)

  // The receipt opens as a sheet with focus on its title.
  await press(page, page.getByRole('button', { name: 'Receipt' }))
  const sheet = page.getByRole('dialog', { name: 'Receipt' })
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText(LINES.gate)
  await expect(sheet).toContainText('to Tomás Reyes for this line')
  await expect(sheet).toContainText('Final')
  await expect(sheet).toContainText('Testnet. Practice money only.')
  await expect(sheet.locator('[data-modal-title]')).toBeFocused()
  await press(page, sheet.getByRole('button', { name: 'Keep reading' }))
  await expect(sheet).toBeHidden()
  expect((await server(page)).accepted).toHaveLength(1)
})

test('the tip bar works by keyboard: amount, then tip', async ({ page }) => {
  test.skip(touch(page), 'Keyboard on the desktop projects')
  await open(page)
  const amount = page.getByRole('button', { name: 'Change amount' })
  await amount.focus()
  await page.keyboard.press('Enter')
  const tray = page.getByRole('radiogroup', { name: 'Tip amount' })
  await expect(tray).toBeVisible()
  await expect(
    tray.getByRole('radio', { name: '$1', exact: true })
  ).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(
    tray.getByRole('radio', { name: '$2', exact: true })
  ).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Enter')
  await expect(tray).toBeHidden()
  await expect(amount).toBeFocused()
  // Choosing an amount never sends.
  expect((await server(page)).requests).toBe(0)
  await page.keyboard.press(tabKey(page))
  await expect(tipButton(page)).toBeFocused()
  await expect(tipButton(page)).toHaveAccessibleName('Tip $2')
  await page.keyboard.press('Enter')
  await expect(page.locator('.qt-read__dock .qt-tip__button')).toContainText(
    'Sent'
  )
  const { accepted } = await server(page)
  expect(accepted.map((tip) => [tip.cents, tip.target.kind])).toEqual([
    [200, 'article'],
  ])
})

test('the receipt sheet keeps focus inside and gives it back', async ({
  page,
}) => {
  test.skip(touch(page), 'Keyboard on the desktop projects')
  await open(page)
  await tipButton(page).focus()
  await page.keyboard.press('Enter')
  const receipt = page.getByRole('button', { name: 'Receipt' })
  await expect(receipt).toBeVisible()
  await receipt.focus()
  await page.keyboard.press('Enter')
  const sheet = page.getByRole('dialog', { name: 'Receipt' })
  await expect(sheet.locator('[data-modal-title]')).toBeFocused()
  // Tab moves through the sheet and wraps; it never leaves it.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press(tabKey(page))
    expect(
      await sheet.evaluate((el) => el.contains(document.activeElement))
    ).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  // The toast that opened it may be gone; focus is never left on nothing.
  expect(
    await page.evaluate(
      () =>
        document.activeElement !== null &&
        document.activeElement !== document.body
    )
  ).toBe(true)
})

test('a drag across a paragraph selects and never pays', async ({ page }) => {
  test.skip(touch(page), 'Mouse drags on the desktop projects')
  await open(page)
  const from = await pointAt(page, 'Two pesos')
  const to = await pointAt(page, 'peso for the bus')
  await page.mouse.move(from.x - 30, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
  // The selection snaps to whole sentences and chooses them, for free.
  await expect(tipButton(page)).toHaveAccessibleName('Tip this line $1')
  expect(
    await page.evaluate(() => window.getSelection()?.toString())
  ).toContain('pesos')
  await page.waitForTimeout(500)
  expect((await server(page)).requests).toBe(0)
})

test('a finger drag across the text scrolls and never pays', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'chromium-390',
    'Touch drags are sent through the Chromium touch protocol'
  )
  await open(page)
  const start = await pointAt(page, 'Two pesos')
  const before = await page.evaluate(() => window.scrollY)
  const cdp = await page.context().newCDPSession(page)
  let { x, y } = start
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd') =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    })
  await send('touchStart')
  for (let i = 0; i < 10; i++) {
    x += 18
    y -= 30
    await send('touchMove')
  }
  await send('touchEnd')
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before)
  await expect(tipButton(page)).toHaveAccessibleName('Tip $1')
  expect((await server(page)).requests).toBe(0)
})

test('a tip interrupted by a reload is accepted exactly once', async ({
  page,
}) => {
  await open(page)
  await page.request.post(`/api/hold?run=${run}`)
  await tapLine(page, 'peso for the bus')
  await press(page, tipButton(page))
  await expect(page.locator('.qt-read__dock .qt-tip__button')).toContainText(
    'Sending'
  )
  await expect.poll(async () => (await server(page)).requests).toBe(1)
  // The answer never reaches this page: reload while it is held.
  await page.reload()
  await expect(
    page.getByRole('heading', { level: 1, name: TITLE })
  ).toBeVisible()
  await page.request.post(`/api/release?run=${run}`)
  // The outbox resent the same request; the server accepted it once.
  await expect.poll(async () => (await server(page)).requests).toBe(2)
  await expect
    .poll(() =>
      page.evaluate(
        (run) => localStorage.getItem(`read-fixture:outbox:${run}`),
        run
      )
    )
    .toBe('[]')
  expect((await server(page)).accepted).toHaveLength(1)

  // Another reload sends nothing more, and nothing is chosen.
  await page.reload()
  await expect(
    page.getByRole('heading', { level: 1, name: TITLE })
  ).toBeVisible()
  await page.waitForTimeout(500)
  const after = await server(page)
  expect(after.requests).toBe(2)
  expect(after.accepted).toHaveLength(1)
  expect(after.accepted[0]!.target.passage?.text).toBe(LINES.bus)
  await expect(tipButton(page)).toHaveAccessibleName('Tip $1')
})

test('signed out, the tip opens sign-in with the intent and sends nothing', async ({
  page,
}) => {
  await open(page, '&pay=signed-out')
  // The public default amount shows before sign-in, never a bare "Tip".
  const link = page.locator('.qt-read__dock').getByRole('link', {
    name: 'Tip Tomás $1',
    exact: true,
  })
  await expect(link).toHaveAttribute(
    'href',
    `/login?next=${encodeURIComponent(ARTICLE_PATH)}`
  )
  await expect(page.locator('.qt-read__wallet')).toHaveCount(0)

  await open(page, '&pay=signed-out&signin=sheet')
  await tapLine(page, 'person next to')
  const line = page
    .locator('.qt-read__dock')
    .getByRole('link', { name: 'Tip this line $1', exact: true })
  await press(page, line)
  await expect(
    page.getByRole('dialog', { name: 'Sign in to Quilltip' })
  ).toBeVisible()
  expect((await server(page)).requests).toBe(0)
})

test('Keep saves the chosen line privately, and not as a tip', async ({
  page,
}) => {
  await open(page)
  await tapLine(page, 'rarely remembers')
  await press(page, page.getByRole('button', { name: 'Keep' }))
  await expect(page.getByText('Kept on your Shelf.')).toBeVisible()
  const mutations = (await (
    await page.request.get(`/api/mutations?run=${run}`)
  ).json()) as { name: string; args: { text: string; isPublic: boolean } }[]
  expect(mutations).toHaveLength(1)
  expect(mutations[0]!.name).toBe('highlights:createHighlight')
  expect(mutations[0]!.args.text).toBe(LINES.quote)
  expect(mutations[0]!.args.isPublic).toBe(false)
  await expect(tipButton(page)).toHaveAccessibleName('Tip $1')
  expect((await server(page)).requests).toBe(0)
})

test('a failed tip says nothing was charged and takes focus', async ({
  page,
}) => {
  await open(page, '&pay=failed')
  await press(page, tipButton(page))
  const note = page.getByText(
    'That tip did not go through. You were not charged.'
  )
  await expect(note).toBeVisible()
  await expect(note).toBeFocused()
})

test('the reader comes back to their place, with a tick and nothing chosen', async ({
  page,
}) => {
  await open(page)
  // The middle of the article: a place is kept between 3% and 95% read.
  await pointAt(page, 'Ten to the school')
  await page.waitForTimeout(400)
  const before = await page.evaluate(() => window.scrollY)
  expect(before).toBeGreaterThan(400)
  // Today's "Your place" reads the sentence and the share read from here.
  const [saved] = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('quilltip:reading-position:v2') ?? '[]')
  )
  expect(saved).toMatchObject({
    href: '/tomas/what-the-ledger-kept',
    title: TITLE_FOR_PLACE,
    finished: false,
  })
  expect(saved.sentence.length).toBeGreaterThan(5)
  expect(saved.percent).toBeGreaterThan(0.1)
  expect(saved.percent).toBeLessThan(0.95)
  await page.reload()
  await expect(
    page.getByRole('heading', { level: 1, name: TITLE })
  ).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(before - 120)
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(before + 120)
  await expect(page.locator('.qt-read__tick[data-kind="place"]')).toHaveCount(1)
  await expect(tipButton(page)).toHaveAccessibleName('Tip $1')
})

test('an article edited since the page was rendered says so, quietly', async ({
  page,
}) => {
  await open(page, '&live=changed')
  await expect(page.getByText('This article was updated.')).toBeVisible()
  await expect(page.locator('#read-body')).toContainText(LINES.opening)
})

test('no horizontal page scroll at 360, 375 and 390', async ({ page }) => {
  test.skip(!touch(page), 'Phone widths on the touch projects')
  for (const width of [360, 375, 390]) {
    await page.setViewportSize({ width, height: 800 })
    await open(page)
    await tapLine(page, 'person next to')
    await expect(tipButton(page)).toHaveAccessibleName('Tip this line $1')
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    )
    expect(overflow, `at ${width}`).toBeLessThanOrEqual(0)
  }
})

test('every control on the tip bar is at least 44 by 44', async ({ page }) => {
  await open(page)
  await tapLine(page, 'person next to')
  const sizes = await page
    .locator('.qt-read__dock')
    .locator('button, a')
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return {
          name: el.textContent || el.getAttribute('aria-label'),
          w: r.width,
          h: r.height,
        }
      })
    )
  for (const size of sizes) {
    expect(size.w, `${size.name}`).toBeGreaterThanOrEqual(44)
    expect(size.h, `${size.name}`).toBeGreaterThanOrEqual(44)
  }
})

test('reaching the end marks the article finished for Today', async ({
  page,
}) => {
  await open(page)
  await pointAt(page, LINES.late)
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })
  )
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('quilltip:reading-position:v2') ?? '[]'
          )[0]?.finished
      )
    )
    .toBe(true)
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'qt_finished')?.value).toBe(
    'readfixturearticle00000000000001'
  )
})
