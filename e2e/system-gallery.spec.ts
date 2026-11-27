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

test('focus follows the page order and is always visible', async ({
  page,
}) => {
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
        name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30),
        visible: el.matches(':focus-visible') && (ring(el) || (box ? ring(box) : false)),
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

test('the tip control works from the keyboard', async ({ page }) => {
  await open(page)
  const group = liveTip(page)
  const amount = group.getByRole('button', { name: 'Change amount' })
  const tip = group.getByRole('button', { name: /^Tip \$/ })
  await amount.focus()
  await page.keyboard.press('Enter')
  const tray = group.getByRole('radiogroup', { name: 'Tip amount' })
  await expect(tray).toBeVisible()
  await expect(tray.getByRole('radio', { name: '$1', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(tray.getByRole('radio', { name: '$2', exact: true })).toBeChecked()
  await expect(tip).toHaveText('Tip $2')
  await page.keyboard.press('Escape')
  await expect(tray).toBeHidden()
  await expect(amount).toBeFocused()
  await page.keyboard.press(tabKey(page))
  await expect(tip).toBeFocused()
  await page.keyboard.press('Enter')
  const button = group.locator('.qt-tip__button')
  await expect(button).toHaveText('Sending $2')
  await expect(button).toHaveText('Sent $2')
  await expect(group.getByRole('status')).toHaveText('Sent $2 to Tomás Reyes.')
  await expect(button).toHaveText('Tip $2')
})

test('the tip control works by touch or pointer, and a refusal says so', async ({
  page,
}) => {
  await open(page)
  const group = liveTip(page)
  const button = group.locator('.qt-tip__button')
  await press(page, group.getByRole('button', { name: 'Change amount' }))
  await press(page, group.getByRole('radio', { name: '$5', exact: true }))
  await expect(group.getByRole('radiogroup')).toBeHidden()
  await expect(button).toHaveText('Tip $5')
  await press(page, button)
  await expect(button).toHaveText('Sent $5')
  // Pressing while sent sends nothing more.
  await press(page, button)
  await expect(button).toHaveText('Tip $5')

  await press(page, page.getByText('Refuse the next tip'))
  await press(page, button)
  await expect(button).toHaveText('Try again')
  await expect(group.getByRole('alert')).toHaveText(
    'That tip did not go through. You were not charged.'
  )
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
  await page.keyboard.type('2.50')
  await page.keyboard.press('Enter')
  await expect(group.locator('.qt-tip__button')).toHaveText('Tip $2.50')
})

test('a sheet takes focus, keeps it, gives it back, and closes three ways', async ({
  page,
}) => {
  await open(page)
  const opener = page.getByRole('button', { name: 'Open the sheet' })
  const sheet = page.getByRole('dialog', { name: 'Add money to tip $3' })

  await opener.focus()
  await page.keyboard.press('Enter')
  await expect(sheet).toBeVisible()
  // The page behind is inert: Tab never reaches it. (Past the last control
  // the browser may take focus to its own toolbar, outside the page.)
  for (let step = 0; step < 6; step++) {
    await page.keyboard.press('Tab')
    expect(
      await sheet.evaluate(
        (el) =>
          el.contains(document.activeElement) ||
          document.activeElement === document.body ||
          document.activeElement === null
      )
    ).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(opener).toBeFocused()
  expect(
    await page.evaluate(() => 'scrollLocked' in document.documentElement.dataset)
  ).toBe(false)

  await press(page, opener)
  await expect(sheet).toBeVisible()
  expect(
    await page.evaluate(() => 'scrollLocked' in document.documentElement.dataset)
  ).toBe(true)
  await press(page, sheet.getByRole('button', { name: 'Close' }))
  await expect(sheet).toBeHidden()
})

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
  const touch = (type: string) =>
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

test('a dialog asks, and Escape keeps the safe choice', async ({ page }) => {
  await open(page)
  const opener = page.getByRole('button', { name: 'Open the dialog' })
  await press(page, opener)
  const dialog = page.getByRole('dialog', { name: 'Sign out?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Stay' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
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
  await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible()
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

test('a failure toast is announced as an alert, others politely', async ({
  page,
}) => {
  await open(page)
  await press(page, page.getByRole('button', { name: 'Failed', exact: true }))
  await expect(
    page.locator('.qt-toasts [role="alert"]').getByText('That tip did not go through')
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
