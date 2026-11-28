/**
 * Shared steps of the guarded real runs (`journey.ts`, `lag.ts`): a run log
 * with hard assertions, finger taps on reachable controls, passage choice
 * by touch long-press or pointer drag, and the Convex rows behind a tip.
 * Every input is named in the log. Nothing here clicks synthetically.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserContext, Locator, Page } from '@playwright/test'
import type { Account } from './lib'
import { table } from './ledger'

export type Receipt = {
  _id: string
  tabAccountId: string
  requestId?: string
  status: string
  amountCents?: number
  amount?: string
  seq?: number
  cumulativeAfter?: string
  acceptedAt?: number
}

type RunOptions = { evidence: string; name: string; readerAddress: string }

/** A run's steps; `assert` throws and records the failure in the log. */
export interface Run extends Omit<ReturnType<typeof makeRun>, 'assert'> {
  assert(ok: unknown, message: string): asserts ok
}

export function startRun(options: RunOptions): Run {
  return makeRun(options)
}

function makeRun(options: RunOptions) {
  const shots = path.join(options.evidence, 'phone')
  mkdirSync(shots, { recursive: true })
  const log: string[] = []
  const facts: Record<string, unknown> = {}
  const note = (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`
    log.push(stamped)
    console.log(stamped)
  }
  const flush = () => {
    writeFileSync(
      path.join(options.evidence, `${options.name}-log.txt`),
      log.join('\n') + '\n'
    )
    writeFileSync(
      path.join(options.evidence, `${options.name}-facts.json`),
      JSON.stringify(facts, null, 2)
    )
  }
  const shot = async (page: Page, name: string) => {
    await page.screenshot({ path: path.join(shots, `${name}.png`) })
    note(`screenshot phone/${name}.png`)
  }
  function assert(ok: unknown, message: string): asserts ok {
    if (!ok) {
      note(`ASSERTION FAILED: ${message}`)
      flush()
      throw new Error(message)
    }
    note(`ok: ${message}`)
  }

  /** The dev server's Next.js badge sits over the bar; it is not in a build. */
  async function hideDevBadge(context: BrowserContext) {
    await context.addInitScript(() => {
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal{display:none!important}'
      document.addEventListener('DOMContentLoaded', () =>
        document.head.append(style)
      )
    })
  }

  /** Waits until a swipe's momentum has stopped moving `target`. */
  async function settle(page: Page, target: Locator) {
    let last = -1
    for (let i = 0; i < 20; i++) {
      const y = (await target.boundingBox())?.y ?? -1
      if (y === last) return
      last = y
      await page.waitForTimeout(150)
    }
  }

  /** Swipes the content under the finger until `target` is on screen. */
  async function reach(page: Page, target: Locator, what: string) {
    const viewport = page.viewportSize()!
    for (let i = 0; i < 6; i++) {
      await settle(page, target)
      const box = await target.boundingBox()
      if (!box) return
      const y = box.y + box.height / 2
      if (y > 0 && y < viewport.height - 8) return
      const delta = Math.max(-500, Math.min(500, y - viewport.height / 2))
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Input.synthesizeScrollGesture', {
        x: Math.round(viewport.width / 2),
        y: Math.round(viewport.height / 2),
        yDistance: -Math.round(delta),
        gestureSourceType: 'touch',
        speed: 1200,
      })
      await cdp.detach()
      await page.waitForTimeout(400)
      note(`touch swipe: ${Math.round(delta)} px to reach ${what}`)
    }
  }

  /** A finger tap on a control a reader can see and reach. */
  async function tap(page: Page, target: Locator, what: string) {
    await target.waitFor({ state: 'visible', timeout: 20_000 })
    await reach(page, target, what)
    const box = await target.boundingBox()
    if (!box) throw new Error(`${what}: no box`)
    const x = Math.round(box.x + box.width / 2)
    const y = Math.round(box.y + box.height / 2)
    const viewport = page.viewportSize()!
    const state = await target.evaluate(
      (el, p) => {
        // The tap lands in the visual viewport; `elementFromPoint` reads the
        // layout viewport, which a touch scroll can leave behind.
        const vv = window.visualViewport
        const top = document.elementFromPoint(
          p.x + (vv?.offsetLeft ?? 0),
          p.y + (vv?.offsetTop ?? 0)
        )
        return {
          onTop: !!top && (top === el || el.contains(top)),
          top: top ? `${top.tagName.toLowerCase()}.${top.className}` : null,
          disabled:
            (el as HTMLButtonElement).disabled === true ||
            el.getAttribute('aria-disabled') === 'true',
        }
      },
      { x, y }
    )
    if (x < 0 || y < 0 || x > viewport.width || y > viewport.height)
      throw new Error(`${what}: outside the viewport at (${x}, ${y})`)
    if (state.disabled) throw new Error(`${what}: disabled`)
    if (!state.onTop)
      throw new Error(`${what}: ${state.top} is on top at (${x}, ${y})`)
    await page.touchscreen.tap(x, y)
    note(`touch tap: ${what} at (${x}, ${y})`)
  }

  async function signedIn(page: Page, account: Account) {
    await page.goto('/articles')
    await page.waitForTimeout(2_500)
    if (await page.getByRole('link', { name: /^Log in$/ }).count()) {
      await page.goto('/login')
      await page.getByLabel('Email', { exact: true }).fill(account.email)
      await page.getByLabel('Password', { exact: true }).fill(account.password)
      await tap(
        page,
        page.getByRole('button', { name: /^(Log in|Sign in)$/ }),
        'Log in'
      )
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
        timeout: 30_000,
      })
      await page.goto('/articles')
      await page.waitForTimeout(2_500)
    }
    assert(
      (await page.getByRole('link', { name: /^Log in$/ }).count()) === 0,
      `${account.name} is signed in`
    )
  }

  /** Client rect centre of `text` inside paragraph `paragraph` (read only). */
  async function textPoints(page: Page, paragraph: number, text: string) {
    return page.evaluate(
      ({ paragraph, text }) => {
        const p = document.querySelectorAll('.ProseMirror p')[paragraph]!
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode() as Text | null
        while (node && !node.data.includes(text))
          node = walker.nextNode() as Text | null
        if (!node) throw new Error(`no "${text}"`)
        const start = node.data.indexOf(text)
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, start + text.length)
        const rects = range.getClientRects()
        const first = rects[0]!
        const last = rects[rects.length - 1]!
        return {
          from: { x: first.left + 1, y: first.top + first.height / 2 },
          to: { x: last.right - 1, y: last.top + last.height / 2 },
          centre: {
            x: first.left + first.width / 2,
            y: first.top + first.height / 2,
          },
        }
      },
      { paragraph, text }
    )
  }

  /** Scrolls the paragraph to the upper third with a finger swipe. */
  async function bringIntoView(page: Page, paragraph: number) {
    for (let i = 0; i < 14; i++) {
      const top = await page.evaluate(
        (n) =>
          document
            .querySelectorAll('.ProseMirror p')
            [n]!.getBoundingClientRect().top,
        paragraph
      )
      if (top > 120 && top < 360) return
      const delta = Math.max(-300, Math.min(300, top - 240))
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Input.synthesizeScrollGesture', {
        x: 195,
        y: 420,
        yDistance: -delta,
        gestureSourceType: 'touch',
        speed: 1200,
      })
      await cdp.detach()
      await page.waitForTimeout(400)
    }
    throw new Error(`paragraph ${paragraph} did not come into view`)
  }

  async function selectByPointer(page: Page, paragraph: number, text: string) {
    await bringIntoView(page, paragraph)
    const p = await textPoints(page, paragraph, text)
    await page.mouse.move(p.from.x, p.from.y)
    await page.mouse.down()
    await page.mouse.move(p.to.x, p.to.y, { steps: 15 })
    await page.mouse.up()
    note(`pointer drag: selected "${text}"`)
  }

  async function selectByLongPress(
    page: Page,
    paragraph: number,
    word: string
  ) {
    await bringIntoView(page, paragraph)
    const p = await textPoints(page, paragraph, word)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.synthesizeTapGesture', {
      x: p.centre.x,
      y: p.centre.y,
      duration: 1200,
      tapCount: 1,
      gestureSourceType: 'touch',
    })
    await cdp.detach()
    const chosen = await page.evaluate(() => window.getSelection()?.toString())
    note(`touch long-press: on "${word}", selection "${chosen}"`)
  }

  const bar = (page: Page) =>
    page.getByRole('region', { name: 'Tip this passage' })
  const tipButton = (page: Page) => bar(page).locator('.qt-tip')

  async function barLive(page: Page) {
    await bar(page).waitFor({ timeout: 20_000 })
    await page.locator('.qt-tip[data-live="true"]').waitFor({ timeout: 30_000 })
  }

  async function chooseAmount(page: Page, label: string) {
    await tap(
      page,
      bar(page).getByRole('button', { name: 'Change amount' }),
      'Change amount'
    )
    assert(
      (await bar(page).count()) === 1 &&
        (await bar(page).getByRole('radio').count()) > 1,
      'the bar stays open and shows the amounts after "Change amount"'
    )
    await tap(
      page,
      bar(page).locator('label.qt-amount', { hasText: label }),
      `amount ${label}`
    )
    await page.waitForTimeout(300)
    const text = await tipButton(page).innerText()
    assert(
      text.trim().endsWith(label.replace(/\.00$/, '')),
      `the tip button reads "${text.trim()}"`
    )
  }

  let accountId: string | null = null
  function receipts(): Receipt[] {
    if (!accountId)
      accountId =
        table<{ _id: string; readerAddress: string }>('tabAccounts').find(
          (a) => a.readerAddress === options.readerAddress
        )?._id ?? null
    if (!accountId) return []
    return table<Receipt>('tabReceipts', 2000).filter(
      (r) => r.tabAccountId === accountId
    )
  }

  /** Waits until exactly `count` receipts are new since `before`. */
  async function newReceipts(
    before: Set<string>,
    count: number,
    waitMs = 30_000
  ): Promise<Receipt[]> {
    const until = Date.now() + waitMs
    let fresh: Receipt[] = []
    while (Date.now() < until) {
      fresh = receipts().filter((r) => !before.has(r._id))
      if (fresh.length >= count) break
      await new Promise((r) => setTimeout(r, 2_000))
    }
    // Give a duplicate time to show up before calling it once.
    await new Promise((r) => setTimeout(r, 4_000))
    return receipts().filter((r) => !before.has(r._id))
  }

  async function rowsFor(page: Page, requestId: string) {
    return page
      .locator(`[data-testid="activity-row"][data-request-id="${requestId}"]`)
      .count()
  }

  async function expectRows(
    page: Page,
    requestId: string,
    who: string,
    waitMs = 20_000
  ) {
    const until = Date.now() + waitMs
    let n = await rowsFor(page, requestId)
    while (n === 0 && Date.now() < until) {
      await page.waitForTimeout(1_000)
      n = await rowsFor(page, requestId)
    }
    assert(n === 1, `${who}: ${n} row for request ${requestId} (want 1)`)
  }

  async function figures(page: Page, ids: string[]) {
    const out: Record<string, string | null> = {}
    for (const id of ids)
      out[id] = await page
        .getByTestId(id)
        .innerText({ timeout: 2_000 })
        .catch(() => null)
    return out
  }

  /** Watches the tip button's phase changes in the page (read only). */
  async function watchPhases(page: Page) {
    await page.evaluate(() => {
      const w = window as unknown as {
        __qtTap?: number
        __qtPhases?: [string | null, number][]
      }
      w.__qtPhases = []
      w.__qtTap = undefined
      const button = document.querySelector('.qt-tip')!
      new MutationObserver(() =>
        w.__qtPhases!.push([
          button.getAttribute('data-phase'),
          performance.now(),
        ])
      ).observe(button, { attributes: true, attributeFilter: ['data-phase'] })
      document.addEventListener(
        'touchend',
        () => {
          w.__qtTap ??= performance.now()
        },
        { capture: true }
      )
    })
  }
  async function readPhases(page: Page) {
    return page.evaluate(() => {
      const w = window as unknown as {
        __qtTap?: number
        __qtPhases?: [string | null, number][]
      }
      const tapAt = w.__qtTap ?? null
      return {
        tapAt,
        phases: (w.__qtPhases ?? []).map(([p, t]) => [
          p,
          tapAt === null ? null : Math.round(t - tapAt),
        ]),
      }
    })
  }

  return {
    facts,
    note,
    flush,
    shot,
    assert,
    hideDevBadge,
    tap,
    signedIn,
    textPoints,
    bringIntoView,
    selectByPointer,
    selectByLongPress,
    bar,
    tipButton,
    barLive,
    chooseAmount,
    receipts,
    newReceipts,
    rowsFor,
    expectRows,
    figures,
    watchPhases,
    readPhases,
  }
}
