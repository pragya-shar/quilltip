import { expect, test, type Locator, type Page } from '@playwright/test'
import { ARTICLE, ARTICLE_PATH, LINES, TITLE } from './fixtures/read/article'

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

/** The embedded player's host: never reached from the suite. */
const VIDEO_HOST = /^https:\/\/www\.youtube-nocookie\.com\//

async function open(page: Page, query = '') {
  await page.route(VIDEO_HOST, (route) => route.abort())
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

/**
 * Waits until the page has stopped scrolling: WebKit can still be moving a
 * moment after a landing or a chosen line, and a tap must hit where it aims.
 */
async function settled(page: Page) {
  let last = -1
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => window.scrollY)
        const held = now === last
        last = now
        return held
      },
      { intervals: [100] }
    )
    .toBe(true)
}

/** A tap (touch) or a click (mouse) on a sentence in the text. */
async function tapLine(page: Page, needle: string) {
  await pointAt(page, needle)
  await settled(page)
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
  await expect(page.locator('#read-body h2#h-the-line')).toHaveText('The line')
  await expect(
    page.getByRole('link', {
      name: 'Read more: The last keeper of the Ras al-Hadd light',
    })
  ).toHaveAttribute('href', '/noor/the-last-keeper')
  // Signed in with a balance: the caption states it once, with testnet.
  await expect(
    page.locator('.qt-read__dock .qt-balance-caption')
  ).toContainText('$18.40')
  await expect(
    page.locator('.qt-read__dock .qt-balance-caption')
  ).toContainText('Testnet')
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')
})

test('the embedded video is a fixed, sandboxed no-cookie frame', async ({
  page,
}) => {
  await open(page)
  const frame = page.locator('#read-body [data-youtube-video] iframe')
  await expect(frame).toHaveCount(1)
  expect(
    await frame.evaluate((el) =>
      Object.fromEntries(Array.from(el.attributes, (a) => [a.name, a.value]))
    )
  ).toEqual({
    src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    title: 'YouTube video',
    width: '640',
    height: '360',
    loading: 'lazy',
    referrerpolicy: 'strict-origin-when-cross-origin',
    sandbox: 'allow-scripts allow-same-origin allow-presentation',
    allow: 'encrypted-media; picture-in-picture; fullscreen',
    allowfullscreen: 'true',
  })
  // The image is the site's own path, sent with no referrer.
  await expect(page.locator('#read-body img').first()).toHaveAttribute(
    'referrerpolicy',
    'no-referrer'
  )
})

test('a tap on a line chooses that sentence, for free, and a second tap lets it go', async ({
  page,
}) => {
  await open(page)
  const height = () =>
    page
      .locator('#read-body')
      .evaluate((el) => el.getBoundingClientRect().height)
  const before = await height()
  await tapLine(page, 'person next to')
  await expect(tipButton(page)).toHaveAccessibleName('Tip this line $1')
  await expect(chosenTick(page)).toBeVisible()
  // The mark adds no padding or margin: no line moves when a line is chosen.
  expect(await height()).toBe(before)
  // Not colour alone: the chosen line is the system's underlined mark.
  await expect(page.locator('mark.qt-mark[data-state="chosen"]')).toHaveText(
    LINES.gate
  )
  expect((await server(page)).requests).toBe(0)

  await tapLine(page, 'person next to')
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')
  await expect(chosenTick(page)).toHaveCount(0)
})

test('Clear lets the chosen line go', async ({ page }) => {
  await open(page)
  await tapLine(page, 'boy who carried')
  await expect(tipButton(page)).toHaveAccessibleName('Tip this line $1')
  await press(page, page.getByRole('button', { name: 'Clear the line' }))
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')
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
          // Tipped by you: the full marker and a ✓ with words.
          tipped:
            node.parentElement?.matches('mark.qt-mark[data-state="mine"]') ===
              true &&
            (node.parentElement.nextElementSibling?.textContent ?? '').includes(
              'You tipped this line'
            ),
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

  // Back to idle after Sent, with nothing chosen. A later line still
  // gets its own offsets: the ✓ is not part of the text.
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')
  await tapLine(page, 'rarely remembers')
  await expect(tipButton(page)).toHaveAccessibleName('Tip this line $1')
  await press(page, tipButton(page))
  await expect(page.locator('.qt-read__dock .qt-tip__button')).toContainText(
    'Sent'
  )
  const after = await server(page)
  expect(after.accepted.map((tip) => tip.target.passage?.text)).toEqual([
    LINES.gate,
    LINES.quote,
  ])
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
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $2')
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
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')
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
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')
})

test('signed out, the tip opens sign-in with the intent and sends nothing', async ({
  page,
}) => {
  // The default amount from public bounds shows before sign-in, never a
  // bare "Tip" and never an assumed "$1". A low cap (today's testnet,
  // about 64¢) offers 10¢, 25¢ and 50¢: the default is the smallest.
  await open(page, '&pay=signed-out&offer=low')
  const link = page.locator('.qt-read__dock').getByRole('link', {
    name: 'Tip Tomás $0.10',
    exact: true,
  })
  await expect(link).toHaveAttribute(
    'href',
    `/login?next=${encodeURIComponent(ARTICLE_PATH)}`
  )
  await expect(page.locator('.qt-read__dock .qt-balance-caption')).toHaveCount(
    0
  )

  // A high cap offers $1 and up: the default is $1.
  await open(page, '&pay=signed-out&offer=high')
  await expect(
    page
      .locator('.qt-read__dock')
      .getByRole('link', { name: 'Tip Tomás $1', exact: true })
  ).toBeVisible()

  await open(page, '&pay=signed-out&offer=low&signin=sheet')
  await tapLine(page, 'person next to')
  const line = page
    .locator('.qt-read__dock')
    .getByRole('link', { name: 'Tip this line $0.10', exact: true })
  await press(page, line)
  await expect(
    page.getByRole('dialog', { name: 'Sign in to Quilltip' })
  ).toBeVisible()
  expect((await server(page)).requests).toBe(0)
})

test('Keep is a toggle that saves the chosen line privately, never a tip', async ({
  page,
}) => {
  await open(page)
  await tapLine(page, 'rarely remembers')
  const keep = page.locator('.qt-read__dock').locator('.qt-keep')
  await expect(keep).toHaveAttribute('aria-pressed', 'false')
  await press(page, keep)
  // Kept: pressed, labelled Kept, the line still chosen, and a marker-ink
  // underline on this visit (a highlight or a mark). The toggle's state is
  // the confirmation: no toast covers the bar.
  await expect(keep).toHaveAttribute('aria-pressed', 'true')
  await expect(keep).toContainText('Kept')
  await expect(tipButton(page)).toHaveAccessibleName('Tip this line $1')
  const keptDrawn = async () =>
    (await page.locator('mark.qt-mark[data-state="kept"]').count()) > 0
  expect(await keptDrawn()).toBe(true)
  await expect(page.getByText('Kept on your Shelf.')).toHaveCount(0)
  const mutations = async () =>
    (await (await page.request.get(`/api/mutations?run=${run}`)).json()) as {
      name: string
      args: { text?: string; isPublic?: boolean; id?: string }
    }[]
  const [created] = await mutations()
  expect(created!.name).toBe('highlights:createHighlight')
  expect(created!.args.text).toBe(LINES.quote)
  expect(created!.args.isPublic).toBe(false)

  // A second press lets it go: the saved line is removed.
  await press(page, keep)
  await expect(keep).toHaveAttribute('aria-pressed', 'false')
  expect((await mutations()).map((m) => [m.name, m.args.id])).toEqual([
    ['highlights:createHighlight', undefined],
    ['highlights:deleteHighlight', 'h1'],
  ])
  expect(await keptDrawn()).toBe(false)
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
  // Wait until the scroll and the saved place both hold.
  await settled(page)
  let lastAt: number | null = null
  await expect
    .poll(
      async () => {
        const at = await page.evaluate(
          () =>
            (JSON.parse(
              localStorage.getItem('quilltip:reading-position:v2') ?? '[]'
            )[0]?.at as number | undefined) ?? null
        )
        const held = at !== null && at === lastAt
        lastAt = at
        return held
      },
      { intervals: [300] }
    )
    .toBe(true)
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
  // The saved sentence, not a share of the scroll, sits at the reading line.
  const offFromLine = await page.evaluate(() => {
    const [place] = JSON.parse(
      localStorage.getItem('quilltip:reading-position:v2') ?? '[]'
    )
    const body = document.getElementById('read-body')!
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    let seen = 0
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent!.length
      if (seen + length > place.at) {
        const range = document.createRange()
        range.setStart(node, place.at - seen)
        range.setEnd(node, place.at - seen + 1)
        return Math.abs(range.getBoundingClientRect().top - innerHeight / 3)
      }
      seen += length
    }
    return Infinity
  })
  expect(offFromLine).toBeLessThan(60)
  await expect(page.locator('.qt-read__tick[data-kind="place"]')).toHaveCount(1)
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')
})

test('an article edited since the page was rendered says so, quietly', async ({
  page,
}) => {
  await open(page, '&doc=changed')
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
      // Rendered controls only: the caption is hidden from 1024 px.
      els
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => {
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
    'k57rdfxtrartc1e0000000000000000001'
  )
})

/** Where an anchored block lands: its scroll margin plus the scroll padding. */
const anchorTopOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const block = document.getElementById(id)!
    return (
      parseFloat(getComputedStyle(block).scrollMarginTop) +
      parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)
    )
  }, id)

test('a link into the article lands on its paragraph or sentence at one offset, with nothing chosen', async ({
  page,
}) => {
  // Paragraph 9 by its id in the HTML (works with no script).
  await open(page, '#s-9-0')
  await settled(page)
  const expected = await anchorTopOf(page, 's-9-0')
  expect(expected).toBeGreaterThan(0)
  const top = await page.evaluate(
    () => document.getElementById('s-9-0')!.getBoundingClientRect().top
  )
  expect(Math.abs(top - expected), `landed at ${top}`).toBeLessThanOrEqual(4)
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')

  // Sentence 1 of paragraph 1, brought to the same offset by the view.
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })
  )
  await open(page, '#s-1-1')
  await settled(page)
  const line = await page.evaluate((line) => {
    const p = document.getElementById('s-1-0')!
    const node = [...p.childNodes].find((n) => n.textContent!.includes(line))!
    const at = node.textContent!.indexOf(line)
    const range = document.createRange()
    range.setStart(node, at)
    range.setEnd(node, at + line.length)
    return range.getBoundingClientRect().top
  }, LINES.bus)
  const sentenceExpected = await anchorTopOf(page, 's-1-0')
  expect(
    Math.abs(line - sentenceExpected),
    `landed at ${line}`
  ).toBeLessThanOrEqual(4)
  await expect(chosenTick(page)).toHaveCount(0)
})

test('opening an article records it for Today in qt_opened', async ({
  page,
}) => {
  await open(page)
  await expect
    .poll(
      async () =>
        (await page.context().cookies()).find((c) => c.name === 'qt_opened')
          ?.value
    )
    .toBe('k57rdfxtrartc1e0000000000000000001')
})

test('after a tip, the confirmation is a quiet row in the bar: one announcement, nothing covered', async ({
  page,
}) => {
  await open(page)
  await tapLine(page, 'person next to')
  await press(page, tipButton(page))
  await expect(page.locator('.qt-read__dock .qt-tip__button')).toContainText(
    'Sent'
  )
  // The tip control's "Sent" holds focus; the peek is not a live region and
  // no toast repeats it.
  const peek = page.locator('.qt-read__peek')
  await expect(peek).toContainText('You tipped Tomás')
  expect(await peek.getAttribute('role')).toBeNull()
  expect(await peek.getAttribute('aria-live')).toBeNull()
  await expect(page.locator('.qt-toast')).toHaveCount(0)
  // A new line chosen while the peek shows: Keep and the tip button are
  // pressable, under nothing.
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')
  await tapLine(page, 'rarely remembers')
  for (const control of [
    page.locator('.qt-read__dock .qt-keep'),
    tipButton(page),
  ]) {
    const box = (await control.boundingBox())!
    const inDock = await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x!, y!)?.closest('.qt-read__dock') !== null,
      [box.x + box.width / 2, box.y + box.height / 2]
    )
    expect(inDock).toBe(true)
  }
})

test('the line tipped is the line pressed, even if another is tapped while sending', async ({
  page,
}) => {
  await open(page)
  await page.request.post(`/api/hold?run=${run}`)
  await tapLine(page, 'person next to')
  await press(page, tipButton(page))
  const status = page.locator('.qt-read__dock .qt-tip__button')
  await expect(status).toContainText('Sending')
  // A tap on another line while the tip is out changes nothing.
  await tapLine(page, 'rarely remembers')
  await expect(status).toContainText('Sending')
  await page.request.post(`/api/release?run=${run}`)
  await expect(status).toContainText('Sent')
  const { accepted } = await server(page)
  expect(accepted.map((tip) => tip.target.passage?.text)).toEqual([LINES.gate])
  // The mark and the receipt name the line the server booked.
  const mine = await page.evaluate(() =>
    Array.from(document.querySelectorAll('mark.qt-mark[data-state="mine"]'))
      .map((m) => m.textContent)
      .join('')
  )
  expect(mine).toBe(LINES.gate)
  await press(page, page.getByRole('button', { name: 'Receipt' }))
  await expect(page.getByRole('dialog', { name: 'Receipt' })).toContainText(
    LINES.gate
  )
})

test('a double press, held Enter or a double tap after a sheet sends one tip', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'chromium-1440',
    'Mouse double click and key repeat through Chromium'
  )
  await open(page)
  // A double click on Tip.
  const box = (await tipButton(page).boundingBox())!
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.qt-read__dock .qt-tip__button')).toContainText(
    'Sent'
  )
  await page.waitForTimeout(500)
  expect((await server(page)).requests).toBe(1)

  // Held Enter after Sent: the key repeats while focus comes back to Tip.
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')
  await tipButton(page).focus()
  const cdp = await page.context().newCDPSession(page)
  const key = {
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    text: '\r',
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(80)
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      autoRepeat: true,
      ...key,
    })
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
  await page.waitForTimeout(500)
  expect((await server(page)).requests).toBe(2)
})

test('the second tap of a double tap on Keep reading never tips', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'chromium-390', 'Touch taps at 390')
  await open(page)
  await press(page, tipButton(page))
  await press(page, page.getByRole('button', { name: 'Receipt' }))
  const sheet = page.getByRole('dialog', { name: 'Receipt' })
  const keep = sheet.getByRole('button', { name: 'Keep reading' })
  await expect(keep).toBeVisible()
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')
  const box = (await keep.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.touchscreen.tap(x, y)
  await page.waitForTimeout(120)
  await page.touchscreen.tap(x, y)
  await expect(sheet).toBeHidden()
  await page.waitForTimeout(600)
  expect((await server(page)).requests).toBe(1)
})

test('a tip by another reader moves no "updated" notice; a removed article leaves the page', async ({
  page,
}) => {
  await open(page, '&doc=tipped')
  await page.waitForTimeout(400)
  await expect(page.getByText('This article was updated.')).toHaveCount(0)

  // Gone: the title leaves with the text, so no wait for it here.
  await page.goto(`${ARTICLE_PATH}?run=${run}&doc=gone`)
  await expect(page.getByText('This article is not here')).toBeVisible()
  await expect(page.locator('#read-body')).not.toContainText(LINES.opening)
  await expect(page.locator('.qt-read__dock')).toHaveCount(0)
})

test('by keyboard: the arrows move between sentences, Enter chooses, Escape lets go', async ({
  page,
}) => {
  test.skip(touch(page), 'Keyboard on the desktop projects')
  await open(page)
  await page.locator('#read-body').focus()
  await page.keyboard.press('ArrowDown')
  const cursor = page.locator('mark.qt-read__cursor')
  await expect(cursor).toHaveText(LINES.opening)
  await page.keyboard.press('ArrowDown')
  await expect(cursor).toHaveText(LINES.green)
  await page.keyboard.press('Enter')
  await expect(tipButton(page)).toHaveAccessibleName('Tip this line $1')
  expect((await server(page)).requests).toBe(0)
  await page.keyboard.press('Escape')
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')
})

test('kept lines come back on open, and ?highlight= lands on one with nothing chosen', async ({
  page,
}) => {
  await open(page, '&kept=1&highlight=hk1')
  const kept = page.locator('mark.qt-mark[data-state="kept"]')
  await expect(kept).toHaveText(LINES.quote)
  const top = await kept.evaluate((el) => el.getBoundingClientRect().top)
  expect(top).toBeGreaterThan(0)
  expect(top).toBeLessThan(page.viewportSize()!.height * 0.6)
  await expect(page.locator('.qt-read__tick[data-kind="place"]')).toHaveCount(1)
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1')
  // Choosing the kept line shows it as kept; Keep would not add it again.
  await tapLine(page, 'rarely remembers')
  await expect(page.locator('.qt-read__dock .qt-keep')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

test('with no balance, the button names what it adds money for', async ({
  page,
}) => {
  await open(page, '&pay=no-balance')
  await expect(
    page.locator('.qt-read__dock').getByRole('button', {
      name: 'Add money to tip $1',
    })
  ).toBeVisible()
})

// --- The arrival after a first publish (`?live=1`) ----------------------

const ARRIVAL_KEY = 'quilltip:just-published:v1'
const arrival = (page: Page) => page.getByTestId('live-arrival')

/** Opens the article once, sets the publish token, then opens `?live=1`. */
async function arriveLive(
  page: Page,
  token: { articleId: string; age: number } | null,
  query = ''
) {
  await open(page, query)
  await page.evaluate(
    ({ key, token }) => {
      if (token)
        sessionStorage.setItem(
          key,
          JSON.stringify({
            articleId: token.articleId,
            at: Date.now() - token.age,
          })
        )
    },
    { key: ARRIVAL_KEY, token }
  )
  await open(page, `${query}&live=1`)
}

test('a reader with ?live=1 sees nothing, and the parameter is gone', async ({
  page,
}) => {
  await arriveLive(page, { articleId: ARTICLE._id, age: 0 })
  await expect(page).not.toHaveURL(/[?&]live=/)
  await expect(page).toHaveURL(new RegExp(`run=${run}`))
  await expect(arrival(page)).toHaveCount(0)
  // The token is spent all the same.
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), ARRIVAL_KEY)
  ).toBeNull()
})

test('the author arrives once: the slot runs, and Done, Escape and a reload end it', async ({
  page,
}) => {
  await arriveLive(
    page,
    { articleId: ARTICLE._id, age: 1_000 },
    '&pay=own-article'
  )
  await expect(page).not.toHaveURL(/[?&]live=/)
  await expect(arrival(page)).toContainText(`Live: ${ARTICLE._id}`)
  await expect(arrival(page)).toContainText(TITLE)
  await expect(arrival(page)).toContainText(`${ARTICLE_PATH}#s-1-0`)
  await press(page, arrival(page).getByRole('button', { name: 'Done' }))
  await expect(arrival(page)).toHaveCount(0)

  await arriveLive(
    page,
    { articleId: ARTICLE._id, age: 1_000 },
    '&pay=own-article'
  )
  await expect(arrival(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(arrival(page)).toHaveCount(0)

  // A reload runs nothing again: the parameter and the token are gone.
  await arriveLive(
    page,
    { articleId: ARTICLE._id, age: 1_000 },
    '&pay=own-article'
  )
  await expect(arrival(page)).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { level: 1, name: TITLE })
  ).toBeVisible()
  await expect(arrival(page)).toHaveCount(0)
})

test('a stale or wrong-article token does nothing', async ({ page }) => {
  for (const token of [
    { articleId: ARTICLE._id, age: 61_000 },
    { articleId: 'another-article', age: 0 },
    null,
  ]) {
    await arriveLive(page, token, '&pay=own-article')
    await expect(page).not.toHaveURL(/[?&]live=/)
    await expect(arrival(page)).toHaveCount(0)
  }
})

// --- The money layer's answers before a press ---------------------------

/** The balance, opened: a sheet on a phone, the side panel on a desktop. */
const balanceOpen = (page: Page) =>
  page.getByRole('dialog').or(page.locator('aside.qt-pocket-panel:visible'))

const mineText = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('mark.qt-mark[data-state="mine"]'))
      .map((m) => m.textContent)
      .join('')
  )

test('not enough balance offers Add money with the need, before any press', async ({
  page,
}) => {
  await open(page, '&pay=needs-funds')
  const add = page
    .locator('.qt-read__dock')
    .getByRole('button', { name: 'Add money to tip $1' })
  await expect(add).toBeVisible()
  await expect(page.locator('.qt-read__dock')).not.toContainText(
    'Choose an amount'
  )
  await press(page, add)
  await expect(balanceOpen(page).first()).toBeVisible()
  expect((await server(page)).requests).toBe(0)
})

test('with no price known, the dock says so plainly and offers no tip', async ({
  page,
}) => {
  await open(page, '&pay=no-price')
  await expect(page.locator('.qt-read__dock')).toContainText(
    'Dollar amounts are not available right now, so tipping is paused.'
  )
  await expect(tipButton(page)).toHaveCount(0)
  await expect(page.locator('.qt-read__dock')).not.toContainText(
    'Choose an amount'
  )
})

test('a tipped line is still marked after a reload', async ({ page }) => {
  await open(page)
  await tapLine(page, 'person next to')
  await press(page, tipButton(page))
  await expect(page.locator('.qt-read__dock .qt-tip__button')).toContainText(
    'Sent'
  )
  // The mark is painted a frame after "Sent".
  await expect.poll(() => mineText(page)).toBe(LINES.gate)
  await open(page)
  await expect.poll(() => mineText(page), { timeout: 5_000 }).toBe(LINES.gate)
  // Nothing is chosen, and no second tip went out.
  await expect(page.locator('mark.qt-mark[data-state="chosen"]')).toHaveCount(0)
  expect((await server(page)).requests).toBe(1)
})

test('signed out with no sign-in sheet, the link returns to the line and keeps the intent', async ({
  page,
}) => {
  await open(page, '&pay=signed-out&offer=high')
  await tapLine(page, 'person next to')
  const link = page
    .locator('.qt-read__dock')
    .getByRole('link', { name: 'Tip this line $1', exact: true })
  const href = (await link.getAttribute('href'))!
  const next = new URL(href, 'http://x').searchParams.get('next')!
  expect(next).toMatch(
    new RegExp(`^${ARTICLE_PATH.replace(/\//g, '\\/')}#s-\\d+-\\d+$`)
  )
  await press(page, link)
  await expect(page).toHaveURL(/\/login\?next=/)
  // The sign-in package's stored form and tip intent.
  const stored = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('quilltip:sign-in-intent') ?? 'null')
  )
  expect(stored).toMatchObject({
    v: 1,
    intent: {
      kind: 'tip',
      path: next,
      articleId: ARTICLE._id,
      passage: { text: LINES.gate },
      amount: { cents: 100, display: '$1' },
      writer: 'Tomás Reyes',
    },
  })
  expect(stored.intent.passage.end).toBeGreaterThan(stored.intent.passage.start)
  expect((await server(page)).requests).toBe(0)
})

test('after sign-in the intent is taken once: the line is chosen, the amount kept within its ceiling, nothing sent', async ({
  page,
}) => {
  // Find the line's anchor and offsets as a signed-out press saved them.
  await open(page, '&pay=signed-out&offer=high')
  await tapLine(page, 'person next to')
  await page
    .locator('.qt-read__dock')
    .getByRole('link', { name: 'Tip this line $1', exact: true })
    .evaluate((a: HTMLAnchorElement) =>
      a.addEventListener('click', (event) => event.preventDefault())
    )
  await press(
    page,
    page
      .locator('.qt-read__dock')
      .getByRole('link', { name: 'Tip this line $1', exact: true })
  )
  const stored = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('quilltip:sign-in-intent')!)
  )
  // Back from sign-in, signed in, with a $2.50 ceiling: $2 is offered.
  await page.evaluate((stored) => {
    stored.intent.amount = { cents: 250, display: '$2.50' }
    sessionStorage.setItem('quilltip:sign-in-intent', JSON.stringify(stored))
  }, stored)
  const path: string = stored.intent.path
  await page.goto(`${path.replace('#', `?run=${run}#`)}`)
  await expect(page.locator('mark.qt-mark[data-state="chosen"]')).toHaveText(
    LINES.gate
  )
  await expect(tipButton(page)).toHaveAccessibleName('Tip this line $2')
  expect(
    await page.evaluate(() => sessionStorage.getItem('quilltip:sign-in-intent'))
  ).toBeNull()
  expect((await server(page)).requests).toBe(0)
  // Taken once: a reload chooses nothing.
  await page.reload()
  await expect(
    page.getByRole('heading', { level: 1, name: TITLE })
  ).toBeVisible()
  await expect(page.locator('mark.qt-mark[data-state="chosen"]')).toHaveCount(0)
})

test('the balance caption opens the balance, and says what it holds', async ({
  page,
}) => {
  await open(page)
  const caption = page.locator('.qt-read__dock .qt-balance-caption')
  if (!touch(page)) {
    // From 1024 px the rail shows the balance; the dock does not.
    await expect(caption).toBeHidden()
    return
  }
  await expect(caption).toContainText('ready to tip')
  // A chosen line: the compact caption beside its actions, same name.
  await tapLine(page, 'person next to')
  const compact = page.locator(
    '.qt-read__line-actions .qt-balance-caption[data-compact]'
  )
  await expect(compact).toBeVisible()
  await expect(compact).not.toContainText('ready to tip')
  await expect(
    compact.getByRole('button', {
      name: 'about 18 dollars 40 ready to tip. Open balance',
    })
  ).toBeVisible()
  await tapLine(page, 'person next to')
  const open_ = page.getByRole('button', {
    name: 'about 18 dollars 40 ready to tip. Open balance',
  })
  await expect(open_).toBeVisible()
  await expect(
    page.locator('.qt-read__dock .qt-balance-caption')
  ).toContainText('≈')
  await press(page, open_)
  await expect(balanceOpen(page).first()).toBeVisible()
})

test('the tip control comes back when the connection does', async ({
  page,
  context,
}) => {
  await open(page)
  await context.setOffline(true)
  await press(page, tipButton(page))
  await expect(page.locator('.qt-read__dock')).toContainText('Offline')
  expect((await server(page)).requests).toBe(0)
  await context.setOffline(false)
  await expect(tipButton(page)).toHaveAccessibleName('Tip Tomás $1', {
    timeout: 1_500,
  })
  await expect(tipButton(page)).toBeEnabled()
  // Past the bar's double-press guard, so this press is a new tip.
  await page.waitForTimeout(500)
  await press(page, tipButton(page))
  await expect(page.locator('.qt-read__dock .qt-tip__button')).toContainText(
    'Sent'
  )
  expect((await server(page)).requests).toBe(1)
})
