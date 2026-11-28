import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Checks for the account sections row at phone width (#635), by role: the
 * page never scrolls sideways, and a link that is current or focused is
 * fully in the row's visible part, focus ring included.
 */

export const accountRow = (page: Page) =>
  page.getByRole('navigation', { name: 'Account sections' })

/** How far the page is wider than the viewport, in pixels. */
export const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

/**
 * The link and its focus ring sit inside the row's visible part. A drawn
 * ring reaches past the link by outline-offset + outline-width when that is
 * positive; the row clips at its padding box.
 */
export function ringInRow(link: Locator) {
  return link.evaluate((element) => {
    const style = getComputedStyle(element)
    const reach =
      style.outlineStyle === 'none'
        ? 0
        : Math.max(
            0,
            parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth)
          )
    const box = element.getBoundingClientRect()
    const row = element.parentElement!.getBoundingClientRect()
    return (
      box.left - reach >= Math.max(row.left, 0) - 0.5 &&
      box.right + reach <= Math.min(row.right, window.innerWidth) + 0.5 &&
      box.top - reach >= row.top - 0.5 &&
      box.bottom + reach <= row.bottom + 0.5
    )
  })
}

/** The current section's link is fully in view on load. */
export async function expectCurrentInView(page: Page) {
  const current = accountRow(page).locator('a[aria-current="page"]')
  await expect(current).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => ringInRow(current)).toBe(true)
}

/**
 * Tab (Option+Tab in WebKit, where Tab skips links) reaches every link in
 * order, and each is fully in view with its ring when focused.
 */
export async function expectKeyboardReachesEveryLink(
  page: Page,
  browserName: string
) {
  const next = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  const links = accountRow(page).getByRole('link')
  const count = await links.count()
  await links.first().focus()
  for (let i = 0; i < count; i++) {
    const link = links.nth(i)
    await expect(link).toBeFocused()
    await expect
      .poll(() => ringInRow(link), { message: `link ${i + 1} of ${count}` })
      .toBe(true)
    if (i < count - 1) await page.keyboard.press(next)
  }
}

/** Two more sections than ship, added to the row by the test only. */
export async function addTwoSections(page: Page) {
  await accountRow(page).evaluate((element) => {
    for (const label of ['Reading history', 'Collections']) {
      const link = document.createElement('a')
      link.href = `#${label}`
      link.textContent = label
      element.insertBefore(link, element.querySelector('.account-name'))
    }
  })
}

/** The header's menu button stays on screen and takes a click. */
export async function expectMenuButtonWorks(page: Page) {
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  const menu = page.getByRole('dialog', { name: 'Find your way' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
}
