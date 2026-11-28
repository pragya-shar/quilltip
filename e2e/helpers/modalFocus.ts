import { expect, type Locator, type Page } from '@playwright/test'

// The focus rules every modal keeps, asserted on any modal by its role and
// its own aria-labelledby. Shaped like the v2 side's e2e/helpers/dialogFocus.ts
// so these tests can move to it once it reaches the base.

/** The element that names the modal (its aria-labelledby). */
export async function modalTitle(modal: Locator): Promise<Locator> {
  const id = await modal.getAttribute('aria-labelledby')
  expect(id, 'the modal names itself with aria-labelledby').toBeTruthy()
  return modal.page().locator(`[id="${id}"]`)
}

/** Rule 1: it opens with focus on its title, so what it is about is read
 * before any action. */
export async function expectOpensOnTitle(modal: Locator) {
  await expect(await modalTitle(modal)).toBeFocused()
}

const activeName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? ''
  })

/** Rule 2: Tab and Shift+Tab wrap at both ends, and so do Option+Tab and
 * Shift+Option+Tab in WebKit (Safari's plain Tab skips buttons and links).
 * Starts from the title. */
export async function expectFocusWraps(page: Page, modal: Locator) {
  const webkit = page.context().browser()?.browserType().name() === 'webkit'
  const names = await modal.evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>('button, a[href], input')]
      .filter((b) => b.getClientRects().length > 0)
      .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '')
  )
  const last = names.at(-1)!
  const first = names[0]!
  const title = await modalTitle(modal)
  for (const key of webkit ? ['Tab', 'Alt+Tab'] : ['Tab']) {
    await title.focus()
    for (let i = 0; i < names.length; i++) await page.keyboard.press(key)
    await expect.poll(() => activeName(page), `${key} lap`).toBe(last)
    await page.keyboard.press(key)
    await expect.poll(() => activeName(page), `${key} wraps`).toBe(first)
    await page.keyboard.press(`Shift+${key}`)
    await expect.poll(() => activeName(page), `Shift+${key} wraps`).toBe(last)
    expect(
      await modal.evaluate((el) => el.contains(document.activeElement))
    ).toBe(true)
  }
}
