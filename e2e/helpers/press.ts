import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Presses for the tests that a button under a field still takes the press
 * while the field shows its error (#658). Pressing moves focus off the
 * field, so its error can appear during the press; the press must still
 * reach the button for every kind of pointer.
 */
export type Pointer = 'mouse' | 'pen' | 'touch'
export const POINTERS: readonly Pointer[] = ['mouse', 'pen', 'touch']

/** Pen input goes through the DevTools protocol, which only Chromium has. */
export const penUnsupported = (pointer: Pointer, browserName: string) =>
  pointer === 'pen' && browserName !== 'chromium'

/**
 * Presses the middle of `target`. Touch needs `hasTouch` on the page.
 * `force` skips Playwright's wait for an enabled button: an aria-disabled
 * button can still be pressed, and the press explains why it waits.
 */
export async function pressWith(
  page: Page,
  target: Locator,
  pointer: Pointer,
  { force = false }: { force?: boolean } = {}
): Promise<void> {
  if (pointer === 'mouse') return target.click({ force })
  if (pointer === 'touch') return target.tap({ force })
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('The button has no box to press.')
  const cdp = await page.context().newCDPSession(page)
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  for (const type of ['mousePressed', 'mouseReleased'] as const) {
    await cdp.send('Input.dispatchMouseEvent', {
      type,
      ...at,
      button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: 1,
      pointerType: 'pen',
    })
  }
  await cdp.detach()
}

/**
 * Notes on the page when a click reaches `target` itself. On the page, not
 * the button, because a click can open a dialog that hides it.
 */
export function markClick(target: Locator, label: string): Promise<void> {
  return target.evaluate((element, name) => {
    element.addEventListener(
      'click',
      () => document.documentElement.setAttribute('data-clicked', name),
      { once: true }
    )
  }, label)
}

export async function expectClicked(page: Page, label: string) {
  await expect(page.locator('html')).toHaveAttribute('data-clicked', label)
}

export async function expectNotClicked(page: Page) {
  await expect(page.locator('html')).not.toHaveAttribute('data-clicked')
}

/** A press that starts on `target` and is released 200 px to its left. */
export async function cancelledPress(page: Page, target: Locator) {
  const box = await target.boundingBox()
  if (!box) throw new Error('The button has no box to press.')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(Math.max(box.x - 200, 1), box.y + box.height / 2, {
    steps: 4,
  })
  await page.mouse.up()
}

/**
 * Waits for the animations in `scope` to end, so boxes can be compared. A
 * cancelled animation rejects its `finished` promise; it has ended too.
 */
export async function animationsSettled(scope: Locator): Promise<void> {
  await scope.evaluate((element) =>
    Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((a) => a.finished.catch(() => undefined))
    ).then(() => undefined)
  )
}
