import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  auditControlContrast,
  auditHitAreas,
  auditTextContrast,
  horizontalOverflow,
} from './helpers/systemAudit'

// The design system gallery (e2e/fixtures/system), in every project of its
// config: 390 with touch, 768 with touch, 1440, in Chromium and WebKit.
// Input is real: taps where the context has touch, pointer clicks
// elsewhere, keys from the keyboard. No synthetic events, no `force`.

test.skip(
  !process.env.SYSTEM_FIXTURES,
  'Needs the design system fixture server (bun run test:e2e:fixtures --suite system)'
)

const hasTouch = () => Boolean(test.info().project.use.hasTouch)

/** A finger on touch projects, the pointer elsewhere. */
async function press(_page: Page, target: Locator) {
  if (hasTouch()) await target.tap()
  else await target.click()
}

/** Tab, with WebKit's option that includes links (as Safari's setting does). */
function tabKey(page: Page) {
  return page.context().browser()?.browserType().name() === 'webkit'
    ? 'Alt+Tab'
    : 'Tab'
}

async function open(page: Page, path = '/') {
  await page.goto(path)
  await expect(page.locator('.qt-shell')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

const liveTip = (page: Page) =>
  page.getByRole('group', { name: 'Tip Tomás Reyes' }).first()

for (const scheme of ['light', 'dark'] as const) {
  test(`every text and control pair meets contrast (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await open(page)
    expect(await auditTextContrast(page)).toEqual([])
    expect(await auditControlContrast(page)).toEqual([])
    await open(page, '/reading')
    expect(await auditTextContrast(page)).toEqual([])
  })
}

test('every control offers at least 44 by 44 px', async ({ page }) => {
  await open(page)
  expect(await auditHitAreas(page)).toEqual([])
  await open(page, '/reading')
  expect(await auditHitAreas(page)).toEqual([])
})

test('no horizontal page scroll at 360, 375 and 390', async ({
  page,
}, info) => {
  test.skip(!info.project.name.endsWith('-390'), 'Phone widths only')
  for (const width of [360, 375, 390]) {
    await page.setViewportSize({ width, height: 800 })
    for (const path of ['/', '/reading']) {
      await open(page, path)
      const overflow = await horizontalOverflow(page)
      expect(overflow, `${path} at ${width}`).toMatchObject({
        scrollWidth: width,
        offenders: [],
      })
    }
  }
})

test('focus follows the page order and is always visible', async ({ page }) => {
  await open(page)
  await page.keyboard.press(tabKey(page))
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  let last = -1
  for (let step = 0; step < 45; step++) {
    await page.keyboard.press(tabKey(page))
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const all = [...document.querySelectorAll('*')]
      const ring = (node: Element) => {
        const s = getComputedStyle(node)
        return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2
      }
      const box = el.closest('.qt-tray__other, .qt-field__control')
      return {
        index: all.indexOf(el),
        name:
          el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30),
        visible:
          el.matches(':focus-visible') &&
          (ring(el) || (box ? ring(box) : false)),
        positive: el.tabIndex > 0,
      }
    })
    if (!info) continue
    expect(info.visible, `focus ring on ${info.name}`).toBe(true)
    expect(info.positive, `positive tabindex on ${info.name}`).toBe(false)
    expect(info.index, `order at ${info.name}`).toBeGreaterThan(last)
    last = info.index
  }
})

/** Where focus is now: the element's class and text. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return {
      className: el?.className ?? '',
      text: el?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      ring: el ? getComputedStyle(el).outlineStyle !== 'none' : false,
    }
  })

test('the tip control works from the keyboard, and focus follows the tip', async ({
  page,
}) => {
  await open(page)
  const group = liveTip(page)
  const amount = group.getByRole('button', { name: 'Change amount' })
  const tip = group.getByRole('button', { name: /^Tip Tomás \$/ })
  await amount.focus()
  await page.keyboard.press('Enter')
  const tray = group.getByRole('radiogroup', { name: 'Tip amount' })
  await expect(tray).toBeVisible()
  await expect(
    tray.getByRole('radio', { name: '$1', exact: true })
  ).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(
    tray.getByRole('radio', { name: '$2', exact: true })
  ).toBeChecked()
  await expect(tip).toHaveText('Tip Tomás $2')
  await page.keyboard.press('Escape')
  await expect(tray).toBeHidden()
  await expect(amount).toBeFocused()
  await page.keyboard.press(tabKey(page))
  await expect(tip).toBeFocused()
  await page.keyboard.press('Enter')
  const pill = group.locator('.qt-tip__button')
  await expect(pill).toHaveText('Sending $2')
  await expect.poll(async () => (await focused(page)).text).toBe('Sending $2')
  await expect(pill).toHaveText(/^Sent \$2 to Tomás Reyes$/)
  await expect
    .poll(async () => (await focused(page)).text)
    .toBe('Sent $2 to Tomás Reyes')
  // Read once, by focus: the control's one live region (for a cancelled
  // hold) stays empty, and there is no alert.
  await expect(group.getByRole('status')).toHaveText('')
  await expect(group.locator('[role="alert"]')).toHaveCount(0)
  await expect(tip).toHaveText('Tip Tomás $2')
  await expect(tip).toBeFocused()
})

test('focus follows the tip by touch or pointer too, with no ring', async ({
  page,
}) => {
  await open(page)
  const group = liveTip(page)
  const button = group.locator('.qt-tip__button')
  await press(page, group.getByRole('button', { name: 'Change amount' }))
  await press(page, group.getByRole('radio', { name: '$5', exact: true }))
  await expect(group.getByRole('radiogroup')).toBeHidden()
  await expect(button).toHaveText('Tip Tomás $5')
  await press(page, button)
  await expect.poll(async () => (await focused(page)).text).toBe('Sending $5')
  expect((await focused(page)).ring).toBe(false)
  await expect
    .poll(async () => (await focused(page)).text)
    .toBe('Sent $5 to Tomás Reyes')
  expect((await focused(page)).ring).toBe(false)
  // Pressing while sent sends nothing more.
  await press(page, button)
  await expect(button).toHaveText('Tip Tomás $5')
})

test('focus moves never scroll, and a press elsewhere is never undone', async ({
  page,
}) => {
  await open(page)
  const group = liveTip(page)
  const button = group.locator('.qt-tip__button')
  await button.scrollIntoViewIfNeeded()
  const y = await page.evaluate(() => window.scrollY)
  await press(page, button)
  await expect.poll(async () => (await focused(page)).text).toBe('Sending $1')
  await expect(button).toHaveText(/^Sent \$1/)
  expect(await page.evaluate(() => window.scrollY)).toBe(y)
  // While it says Sent, the person presses plain text elsewhere: focus is
  // theirs now (on the body in Safari and here), and stays there.
  const text = page.getByText('Amounts are the money layer’s display strings', {
    exact: false,
  })
  await press(page, text)
  await expect(
    group.getByRole('button', { name: 'Tip Tomás $1' })
  ).toBeVisible()
  await page.waitForTimeout(300)
  expect(
    await page.evaluate(() =>
      document.activeElement?.closest('.qt-tip')
        ? 'in the control'
        : 'elsewhere'
    )
  ).toBe('elsewhere')
})

test('a refused tip moves focus to the reason, and Try again is there', async ({
  page,
}) => {
  await open(page)
  const group = liveTip(page)
  const button = group.locator('.qt-tip__button')
  await press(page, page.getByText('Refuse the next tip'))
  await press(page, button)
  await expect(button).toHaveText('Try again: tip $1')
  await expect(group.getByRole('button', { name: 'Not now' })).toBeVisible()
  await expect
    .poll(async () => (await focused(page)).text)
    .toBe('That tip did not go through. You were not charged.')
  await expect(
    group.getByRole('button', { name: 'Try again: tip $1' })
  ).toHaveAttribute('aria-describedby', /.+/)
})

const heldTip = (page: Page) =>
  page.getByRole('group', { name: 'Tip Ama Mensah' }).first()

test('the hold: focus on its status, +$1 restarts it, then it sends', async ({
  page,
}) => {
  await open(page)
  const group = heldTip(page)
  await press(page, group.getByRole('button', { name: 'Tip Ama $1' }))
  const status = group.locator('.qt-tip__button')
  await expect(status).toContainText('Sending $1')
  // The projected balance: glyphs drawn, words heard.
  const projected = status.locator('.qt-tip__projected')
  await expect(projected.locator('[aria-hidden="true"]')).toHaveText(
    '≈ $18.40 → ≈ $17.40'
  )
  await expect(projected.locator('.qt-visually-hidden')).toHaveText(
    '. about 18 dollars 40, then about 17 dollars 40'
  )
  await expect
    .poll(async () => (await focused(page)).text)
    .toContain('Sending $1 to Ama Mensah. Cancel stops it.')
  await press(page, group.getByRole('button', { name: 'Add $1' }))
  await expect(status).toContainText('Sending $2')
  await expect(projected.locator('[aria-hidden="true"]')).toHaveText(
    '≈ $18.40 → ≈ $16.40'
  )
  await expect(group.getByRole('button', { name: 'Cancel' })).toBeVisible()
  // About 3 s after the last +$1 it sends; nothing about it before.
  await expect(status).toContainText('Sent $2', { timeout: 6000 })
})

test('the hold ends with Escape or Cancel, nothing sent, said once', async ({
  page,
}) => {
  await open(page)
  const group = heldTip(page)
  const tip = group.getByRole('button', { name: 'Tip Ama $1' })
  await press(page, tip)
  await expect(group.locator('.qt-tip__button')).toContainText('Sending $1')
  await page.keyboard.press('Escape')
  await expect(tip).toBeVisible()
  await expect(group.getByRole('status')).toHaveText(
    'Cancelled. Nothing was sent.'
  )
  await expect(tip).toBeFocused()
  await press(page, tip)
  await press(page, group.getByRole('button', { name: 'Cancel' }))
  await expect(tip).toBeVisible()
  await page.waitForTimeout(3500)
  await expect(group.locator('.qt-tip__button')).toHaveText('Tip Ama $1')
})

/** Holds a key down: the first keydown, then repeats, then the keyup. */
async function holdKey(page: Page, key: string, repeats = 6) {
  for (let i = 0; i <= repeats; i++) await page.keyboard.down(key)
  await page.keyboard.up(key)
}

test('a held key or a double press asks for one tip', async ({ page }) => {
  await open(page)
  const group = page.getByRole('group', { name: 'Tip Lena Park' })
  const count = page.locator('[data-press-count]')
  const tip = group.getByRole('button', { name: 'Tip Lena $1' })
  await tip.focus()
  await holdKey(page, 'Enter')
  await expect(count).toHaveAttribute('data-press-count', '1')
  // A second press before the phase moves is the same press.
  await page.waitForTimeout(1100)
  if (hasTouch()) {
    await tip.tap()
    await tip.tap()
  } else await tip.dblclick()
  await expect(count).toHaveAttribute('data-press-count', '2')
  await page.waitForTimeout(1100)
  await expect(count).toHaveAttribute('data-press-count', '2')
})

test('Enter held on Cancel or Not now never sends', async ({ page }) => {
  await open(page)
  const held = heldTip(page)
  await press(page, held.getByRole('button', { name: 'Tip Ama $1' }))
  await held.getByRole('button', { name: 'Cancel' }).focus()
  await holdKey(page, 'Enter')
  await expect(held).toHaveAttribute('data-phase', 'idle')
  await page.waitForTimeout(400)
  await expect(held).toHaveAttribute('data-phase', 'idle')

  const live = liveTip(page)
  await press(page, page.getByText('Refuse the next tip'))
  await press(page, live.locator('.qt-tip__button'))
  const notNow = live.getByRole('button', { name: 'Not now' })
  await expect(notNow).toBeVisible()
  await notNow.focus()
  await holdKey(page, 'Enter')
  await expect(live).toHaveAttribute('data-phase', 'idle')
  await page.waitForTimeout(400)
  await expect(live).toHaveAttribute('data-phase', 'idle')
})

test("the hold's countdown band shows on the button in both themes", async ({
  page,
}) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await open(page)
    const group = heldTip(page)
    await press(page, group.getByRole('button', { name: 'Tip Ama $1' }))
    const ratio = await group.locator('.qt-tip__countdown').evaluate((band) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      const rgb = (color: string) => {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]
      }
      const lum = (c: number[]) => {
        const [r, g, b] = c.map((v) => {
          const x = v / 255
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
      }
      const a = lum(rgb(getComputedStyle(band).backgroundColor))
      const b = lum(rgb(getComputedStyle(band.parentElement!).backgroundColor))
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    })
    expect(ratio, scheme).toBeGreaterThanOrEqual(3)
  }
})

test('+$1 is disabled with its reason when a limit is reached', async ({
  page,
}) => {
  await open(page)
  const holding = page.locator('[data-specimen="Holding"]')
  const addOne = holding.getByRole('button', { name: /^Add \$1\. Not now:/ })
  await expect(addOne).toHaveAttribute('aria-disabled', 'true')
  await expect(addOne).toHaveAccessibleName(
    'Add $1. Not now: your daily limit is $5'
  )
})

test('reduced motion keeps the hold at its full length', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  const group = heldTip(page)
  await press(page, group.getByRole('button', { name: 'Tip Ama $1' }))
  const duration = await group
    .locator('.qt-tip__countdown')
    .evaluate((el) => getComputedStyle(el).animationDuration)
  expect(duration).toBe('3s')
})

test('a long name never cuts the amount on the tip button', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await open(page)
  const button = page
    .locator('[data-specimen="A long name never cuts the amount"]')
    .locator('.qt-tip__button')
  const fits = await button.evaluate((el) => {
    const amount = el.querySelector('.qt-tip__amount') as HTMLElement
    const a = amount.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    return {
      text: amount.textContent,
      inside: a.right <= b.right + 0.5 && a.left >= b.left - 0.5,
      whole: amount.scrollWidth <= amount.clientWidth + 0.5,
    }
  })
  expect(fits).toEqual({ text: '$3', inside: true, whole: true })
})

test('another amount: typed, checked, chosen without sending', async ({
  page,
}) => {
  await open(page)
  const group = liveTip(page)
  await press(page, group.getByRole('button', { name: 'Change amount' }))
  const other = group.getByRole('textbox', { name: 'Other amount in dollars' })
  await press(page, other)
  await page.keyboard.type('abc')
  await page.keyboard.press('Enter')
  await expect(group.locator('.qt-tray__error')).toHaveText(
    'Enter an amount like 2.50'
  )
  await expect(group.locator('.qt-tray__error')).toHaveRole('alert')
  await other.fill('')
  await page.keyboard.type('2,50')
  await page.keyboard.press('Enter')
  await expect(group.locator('.qt-tip__button')).toHaveText('Tip Tomás $2.50')
  // A typed amount checks no quick amount; the first one takes focus.
  await press(page, group.getByRole('button', { name: 'Change amount' }))
  const tray = group.getByRole('radiogroup', { name: 'Tip amount' })
  await expect(tray.locator('[aria-checked="true"]')).toHaveCount(0)
  await expect(
    tray.getByRole('radio', { name: '$1', exact: true })
  ).toBeFocused()
  // Set by a press: Safari moves focus off a pressed button before its
  // click, and the tray still takes the amount.
  await group
    .getByRole('textbox', { name: 'Other amount in dollars' })
    .fill('3')
  await press(page, group.getByRole('button', { name: 'Set' }))
  await expect(group.locator('.qt-tip__button')).toHaveText('Tip Tomás $3')
})

test('a line changing state keeps every line break', async ({ page }) => {
  await open(page)
  const layout = await page.evaluate(() =>
    ['chosen', 'holding', 'mine'].map((state) => {
      const p = document.querySelector<HTMLElement>(`[data-steady="${state}"]`)!
      // Lines of text, not the ornaments drawn beside it.
      const bottoms = new Set<number>()
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest('[aria-hidden="true"]')) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const r of range.getClientRects())
          if (r.width > 0) bottoms.add(Math.round(r.bottom))
      }
      const lines = bottoms.size
      const base = p.getBoundingClientRect()
      const words = [...p.querySelector('.qt-mark')!.getClientRects()].map(
        (r) =>
          [r.left - base.left, r.top - base.top, r.width].map((v) =>
            Math.round(v)
          )
      )
      return { height: Math.round(base.height), lines, words }
    })
  )
  expect(layout[0]!.lines).toBeGreaterThan(1)
  expect(layout[1]).toEqual(layout[0])
  expect(layout[2]).toEqual(layout[0])
})

test('forced colors keep their mapping under a stored dark theme', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Forced colors emulate in Chromium')
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' })
  await open(page)
  for (const theme of ['dark', 'light', null]) {
    const paper = await page.evaluate((value) => {
      const root = document.documentElement
      if (value) root.dataset.theme = value
      else delete root.dataset.theme
      return getComputedStyle(root).getPropertyValue('--qt-paper').trim()
    }, theme)
    expect(paper, String(theme)).toBe('Canvas')
  }
})

for (const kind of [
  { opener: 'Open the sheet', name: 'Add money to tip $3', close: 'Close' },
  { opener: 'Open the dialog', name: 'Sign out?', close: 'Stay' },
]) {
  test(`${kind.opener.slice(9)}: opens on its title, wraps Tab, returns focus`, async ({
    page,
    browserName,
  }) => {
    await open(page)
    const opener = page.getByRole('button', { name: kind.opener })
    const modal = page.getByRole('dialog', { name: kind.name })

    // By keyboard: focus lands on the title, never on Close.
    await opener.focus()
    await page.keyboard.press('Enter')
    await expect(modal).toBeVisible()
    await expect(modal.getByRole('heading', { name: kind.name })).toBeFocused()

    // Tab and Shift+Tab move through every control and wrap; the last
    // control is the way out (Close, or the safe choice).
    const names = await modal.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>('button, a[href], input')]
        .filter((b) => b.getClientRects().length > 0)
        .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())
    )
    expect(names.at(-1)).toBe(kind.close)
    const keys = browserName === 'webkit' ? ['Tab', 'Alt+Tab'] : ['Tab']
    for (const key of keys) {
      for (let i = 0; i < names.length; i++) await page.keyboard.press(key)
      // From the title, one lap lands on the last control...
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (document.activeElement as HTMLElement | null)?.getAttribute(
                'aria-label'
              ) ?? document.activeElement?.textContent?.trim()
          )
        )
        .toBe(kind.close)
      // ...and one more wraps to the first.
      await page.keyboard.press(key)
      expect(
        await modal.evaluate((el) => el.contains(document.activeElement))
      ).toBe(true)
      await page.keyboard.press(`Shift+${key}`)
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (document.activeElement as HTMLElement | null)?.getAttribute(
                'aria-label'
              ) ?? document.activeElement?.textContent?.trim()
          )
        )
        .toBe(kind.close)
      // Back to the title for the next key.
      await modal.getByRole('heading', { name: kind.name }).focus()
    }

    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()
    await expect(opener).toBeFocused()
    expect(
      await page.evaluate(
        () => 'scrollLocked' in document.documentElement.dataset
      )
    ).toBe(false)

    // By touch or pointer: the title again, and no focus ring anywhere.
    await press(page, opener)
    await expect(modal).toBeVisible()
    await expect(modal.getByRole('heading', { name: kind.name })).toBeFocused()
    expect(
      await page.evaluate(
        () => getComputedStyle(document.activeElement as Element).outlineStyle
      )
    ).toBe('none')
    expect(
      await page.evaluate(
        () => 'scrollLocked' in document.documentElement.dataset
      )
    ).toBe(true)
    await press(page, modal.getByRole('button', { name: kind.close }))
    await expect(modal).toBeHidden()
  })
}

test('a sheet drags down to dismiss with a finger', async ({ page }, info) => {
  test.skip(
    info.project.name !== 'chromium-390',
    'Touch drags are sent through the Chromium touch protocol'
  )
  await open(page)
  await press(page, page.getByRole('button', { name: 'Open the sheet' }))
  const sheet = page.getByRole('dialog', { name: 'Add money to tip $3' })
  await expect(sheet).toBeVisible()
  await page.waitForTimeout(300)
  const head = await sheet.locator('.qt-modal__grip').boundingBox()
  const cdp = await page.context().newCDPSession(page)
  const x = head!.x + head!.width / 2
  let y = head!.y + 10
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd') =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    })
  await touch('touchStart')
  for (let i = 0; i < 12; i++) {
    y += 30
    await touch('touchMove')
  }
  await touch('touchEnd')
  await expect(sheet).toBeHidden()
})

test('a menu opens from the keyboard and returns focus', async ({ page }) => {
  await open(page)
  const trigger = page.getByRole('button', { name: 'Share options' })
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const menu = page.getByRole('menu', { name: 'Share options' })
  await expect(menu.getByRole('menuitem', { name: 'Copy link' })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(
    menu.getByRole('menuitem', { name: 'Report this article' })
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()

  await press(page, trigger)
  await press(page, menu.getByRole('menuitem', { name: 'Copy link' }))
  await expect(
    page.getByRole('status').filter({ hasText: 'Link copied' })
  ).toBeVisible()
})

test('a switch toggles by key and by touch, and a failed save goes back', async ({
  page,
}) => {
  await open(page)
  const name = page
    .getByRole('switch', { name: 'Show my name on tips' })
    .first()
  await expect(name).toHaveAttribute('aria-checked', 'false')
  await expect(name).toContainText('Off')
  await name.focus()
  await page.keyboard.press('Space')
  await expect(name).toHaveAttribute('aria-checked', 'true')
  await expect(name).toHaveAttribute('aria-busy', 'true')
  await expect(name).not.toHaveAttribute('aria-busy', 'true')
  await expect(name).toHaveAttribute('aria-checked', 'true')
  await expect(name).toContainText('On')

  await press(page, page.getByRole('switch', { name: 'Fail the next save' }))
  await press(page, name)
  await expect(name).toHaveAttribute('aria-checked', 'false')
  await expect(name).toHaveAttribute('aria-checked', 'true')
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'That did not save. Try again.' })
      .first()
  ).toBeVisible()
  await expect(name).toHaveAccessibleDescription(/That did not save/)
})

test('an activity row is a link or a button, never both', async ({ page }) => {
  await open(page)
  const rows = page.locator('.qt-activity')
  const kinds = await rows.evaluateAll((list) =>
    list.map((row) => ({
      links: row.querySelectorAll('a.qt-activity__link').length,
      buttons: row.querySelectorAll('button.qt-activity__link').length,
    }))
  )
  for (const kind of kinds)
    expect(kind.links + kind.buttons).toBeLessThanOrEqual(1)
  expect(kinds.some((k) => k.links === 1)).toBe(true)
  expect(kinds.some((k) => k.buttons === 1)).toBe(true)
  // A row's control is named by `name`, or by `label` when it has one.
  await expect(
    page.getByRole('button', {
      name: 'A reader, plus 98 cents, open receipt',
      exact: true,
    })
  ).toHaveText('A reader')
  const receipt = page.getByRole('button', { name: 'Tomás Reyes', exact: true })
  await receipt.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.locator('.qt-toasts').getByText('Receipt opens here')
  ).toBeVisible()
})

test('Keep toggles by key and by touch, and says its state', async ({
  page,
}) => {
  await open(page)
  const keep = page.getByRole('button', { name: 'Keep this line' }).first()
  await expect(keep).toHaveAttribute('aria-pressed', 'false')
  await press(page, keep)
  await expect(keep).toHaveAttribute('aria-pressed', 'true')
  await keep.focus()
  await page.keyboard.press('Space')
  await expect(keep).toHaveAttribute('aria-pressed', 'false')
  const labelled = page.getByRole('button', { name: 'Kept' })
  await expect(labelled).toHaveAttribute('aria-pressed', 'true')
  await press(page, labelled)
  await expect(
    page.getByRole('button', { name: 'Keep', exact: true }).first()
  ).toHaveAttribute('aria-pressed', 'false')
})

test('tabs move with arrow keys', async ({ page }) => {
  await open(page)
  const feed = page.getByRole('tablist', { name: 'Feed' })
  await feed.getByRole('tab', { name: 'Top lines' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(feed.getByRole('tab', { name: 'Articles' })).toBeFocused()
  await expect(feed.getByRole('tab', { name: 'Articles' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await page.keyboard.press('End')
  await expect(feed.getByRole('tab', { name: 'Following' })).toBeFocused()
  await expect(page.getByRole('tabpanel')).toHaveText('Showing Following.')
})

test('a toast stays the same toast while a modal opens and closes', async ({
  page,
}) => {
  await open(page)
  await press(page, page.getByRole('button', { name: 'Sent', exact: true }))
  const toast = page.locator('.qt-toast', { hasText: 'You tipped Tomás $3' })
  await expect(toast).toBeVisible()
  await toast.evaluate((el) => ((el as HTMLElement).dataset.seen = 'yes'))
  await page.getByRole('button', { name: 'Open the sheet' }).focus()
  await page.keyboard.press('Enter')
  const sheet = page.getByRole('dialog', { name: 'Add money to tip $3' })
  await expect(sheet).toBeVisible()
  // Moved into the modal, not drawn again.
  await expect(sheet.locator('.qt-toast[data-seen="yes"]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(page.locator('.qt-toast[data-seen="yes"]')).toHaveCount(1)
})

test('a press just after a sheet closes reaches nothing under it', async ({
  page,
}) => {
  await open(page)
  const count = page.locator('[data-press-count]')
  const tip = page
    .getByRole('group', { name: 'Tip Lena Park' })
    .getByRole('button', { name: 'Tip Lena $1' })
  const opener = page.getByRole('button', { name: 'Open the sheet' })
  const sheet = page.getByRole('dialog', { name: 'Add money to tip $3' })

  // A pointer press while the sheet closes is swallowed.
  await press(page, opener)
  await expect(sheet).toBeVisible()
  await press(page, sheet.getByRole('button', { name: 'Close' }))
  await press(page, tip)
  await expect(sheet).toBeHidden()
  await expect(count).toHaveAttribute('data-press-count', '0')
  // A moment later, presses count again.
  await page.waitForTimeout(500)
  await press(page, tip)
  await expect(count).toHaveAttribute('data-press-count', '1')

  // A key press in the same moment is never swallowed.
  await page.waitForTimeout(1100) // the tip control's own latch
  await press(page, opener)
  await expect(sheet).toBeVisible()
  await press(page, sheet.getByRole('button', { name: 'Close' }))
  await expect(sheet).toBeHidden()
  await tip.focus()
  await page.keyboard.press('Enter')
  await expect(count).toHaveAttribute('data-press-count', '2')
})

test('a failure toast is announced as an alert, others politely', async ({
  page,
}) => {
  await open(page)
  await press(page, page.getByRole('button', { name: 'Failed', exact: true }))
  await expect(
    page
      .locator('.qt-toasts [role="alert"]')
      .getByText('That tip did not go through')
  ).toBeVisible()
  await press(page, page.getByRole('button', { name: 'Sent', exact: true }))
  await expect(
    page.locator('.qt-toasts [role="status"]').getByText('You tipped Tomás $3')
  ).toBeVisible()
})

test('reduced motion: overlays and the tip control change without travel', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await press(page, page.getByRole('button', { name: 'Open the sheet' }))
  const panel = page.locator('.qt-modal[open] .qt-modal__panel')
  await expect(panel).toBeVisible()
  const longest = await page.evaluate(() =>
    Math.max(
      0,
      ...document
        .getAnimations()
        // The hold's countdown and band keep their length.
        .filter(
          (a) =>
            !['qt-hold-fill', 'qt-band'].includes(
              (a as CSSAnimation).animationName
            )
        )
        .map((a) => Number(a.effect?.getComputedTiming().duration) || 0)
    )
  )
  expect(longest).toBeLessThan(1)
  const transition = await panel.evaluate(
    (el) => getComputedStyle(el).transitionDuration
  )
  expect(parseFloat(transition)).toBeLessThan(0.001)
})

test('a figure never shows a placeholder zero while loading or unavailable', async ({
  page,
}) => {
  await open(page)
  for (const name of ['Loading', 'Unavailable']) {
    const figure = page
      .locator('[data-specimen="' + name + '"]')
      .first()
      .locator('.qt-money')
    await expect(figure).not.toContainText(/\$|0/)
  }
  await expect(
    page.locator('[data-specimen="Loading"] .qt-money').first()
  ).toHaveAttribute('aria-busy', 'true')
})

test('a line keeps both of its states, each with its cue', async ({ page }) => {
  await open(page)
  const specimen = page.locator('[data-specimen="Lines in two states at once"]')
  const look = (text: string) =>
    specimen.locator('.qt-mark', { hasText: text }).evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        state: el.getAttribute('data-state'),
        fill: style.getPropertyValue('--qt-mark-fill').trim(),
        underline: style.textDecorationLine,
        described: el.getAttribute('aria-description'),
      }
    })
  const chosen = await look('A chosen line')
  expect(chosen.state).toBe('others-top chosen')
  expect(chosen.fill).not.toBe('transparent')
  expect(chosen.underline).toContain('underline')
  await expect(specimen.locator('.qt-line-overlay__tick')).toHaveCount(1)
  const kept = await look('A line you kept')
  expect(kept.state).toBe('mine kept')
  expect(kept.underline).toContain('underline')
  expect(kept.described).toBe('You tipped this line. Kept')
  await expect(specimen.locator('.qt-mark__check')).toHaveCount(1)
})

test('the tray says what is ready to tip, from the money value', async ({
  page,
}) => {
  await open(page)
  const group = liveTip(page)
  await press(page, group.getByRole('button', { name: 'Change amount' }))
  const caption = group.getByRole('button', {
    name: 'about 18 dollars 40 ready to tip. Open balance',
  })
  await expect(caption.locator('.qt-money__digits')).toHaveText('≈$18.40')
  await expect(caption).toContainText(/ ready to tip$/)
  // It opens the balance: the way to it on a pushed screen at phone width.
  await press(page, caption)
  await expect(group.getByRole('radiogroup')).toBeHidden()
  await expect(
    page.locator('.qt-toasts').getByText('The balance opens here')
  ).toBeVisible()
})

test('the amount control can carry its word', async ({ page }) => {
  await open(page)
  const specimen = page.locator(
    '[data-specimen="Amount control with its word"]'
  )
  const control = specimen.getByRole('button', { name: 'Amount', exact: true })
  await expect(control).toBeVisible()
  await press(page, control)
  await expect(specimen.getByRole('radiogroup')).toBeVisible()
})

test('after a refusal the button states the amount chosen since', async ({
  page,
}) => {
  await open(page)
  const specimen = page.locator(
    '[data-specimen="Refused, then another amount chosen"]'
  )
  await expect(
    specimen.getByRole('button', { name: 'Try again: tip $1', exact: true })
  ).toBeVisible()
})

test('an empty place can be a section heading', async ({ page }) => {
  await open(page)
  await expect(
    page
      .locator('[data-specimen="Empty state as a section heading"]')
      .getByRole('heading', { level: 2, name: 'Nothing on your shelf yet.' })
  ).toBeVisible()
})

test('sign-out says what it would strand, once, and a broken check never blocks', async ({
  page,
}) => {
  await open(page)
  const stranded = page.locator(
    '[data-specimen="Sign out, with something it would strand"]'
  )
  await press(page, stranded.getByRole('button', { name: 'Sign out' }))
  const ask = page.getByRole('alertdialog', { name: 'Sign out?' })
  await expect(ask).toBeVisible()
  await expect(ask).toContainText('2 drafts are only on this device.')
  await press(page, ask.getByRole('button', { name: 'Stay' }))
  await expect(ask).toBeHidden()
  await expect(page.getByText('Signed out (gallery)')).toHaveCount(0)
  await page.waitForTimeout(450) // the press hold after a modal closes
  await press(page, stranded.getByRole('button', { name: 'Sign out' }))
  await press(page, ask.getByRole('button', { name: 'Sign out anyway' }))
  await expect(
    page
      .locator('.qt-toasts')
      .getByText('Signed out (gallery)', { exact: true })
  ).toBeVisible()

  const broken = page.locator(
    '[data-specimen="Sign out, when a check fails or runs late"]'
  )
  await page.waitForTimeout(450)
  await press(page, broken.getByRole('button', { name: 'Sign out' }))
  await expect(ask).toBeHidden()
  await expect(
    page
      .locator('.qt-toasts')
      .getByText('Signed out (gallery), no checks answered')
  ).toBeVisible({ timeout: 3000 })
})

test('a field error is read once: by focus, or by a live region', async ({
  page,
}) => {
  await open(page)
  const email = page
    .locator('[data-specimen="Error"]')
    .getByRole('textbox', { name: 'Email' })
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  await expect(email).toHaveAccessibleDescription(
    'Enter an email like name@example.com.'
  )
  // Focus moves to the field, so nothing else repeats the error.
  await expect(
    page.locator(
      '[data-specimen="Error"] [role="alert"], [data-specimen="Error"] [aria-live]'
    )
  ).toHaveCount(0)

  const live = page.locator('[data-specimen="Error while focus is elsewhere"]')
  const region = live.locator('[aria-live="polite"]')
  await expect(region).toHaveCount(1)
  await expect(region).toHaveText('')
  await press(page, live.getByRole('button', { name: 'Check address' }))
  await expect(region).toHaveText('That address is taken. Try another.')
  await expect(
    live.getByRole('textbox', { name: 'Your Quilltip address' })
  ).toHaveAttribute('aria-invalid', 'true')
  await expect(live.locator('[role="alert"]')).toHaveCount(0)
})

test('a list of choices opens on the first one the reader can use', async ({
  page,
}) => {
  await open(page)
  const specimen = page.locator(
    '[data-specimen="Menu whose first action is not available"]'
  )
  await specimen.getByRole('button', { name: 'Article actions' }).focus()
  await page.keyboard.press('Enter')
  const menu = specimen.getByRole('menu', { name: 'Article actions' })
  await expect(menu.getByRole('menuitem', { name: 'Copy link' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Report' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  // Past the end: back to the first usable one, never the unavailable one.
  await expect(menu.getByRole('menuitem', { name: 'Copy link' })).toBeFocused()
  await expect(
    menu.getByRole('menuitem', { name: 'Download (not available yet)' })
  ).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')
})

test("a task screen's Close stores first, and never waits long", async ({
  page,
}) => {
  await open(page)
  const close = page.getByRole('link', { name: 'Close the editor' })
  await expect(close).toHaveAttribute('href', '/shelf')
  await press(page, close)
  await expect(page).toHaveURL(/\/shelf$/)
  expect(
    await page.evaluate(() => sessionStorage.getItem('gallery-close'))
  ).toBe('stored')

  await open(page)
  const started = Date.now()
  await press(page, page.getByRole('link', { name: 'Close (slow to store)' }))
  await expect(page).toHaveURL(/\/shelf$/, { timeout: 3000 })
  // The bound (800 ms), not the five seconds the store asked for.
  expect(Date.now() - started).toBeLessThan(3000)
})
