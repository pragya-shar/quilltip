import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Focus checks for any modal dialog, by its role and its own labelling, not
 * its markup (#591). Each takes the dialog as a locator, for example
 * `page.getByRole('dialog', { name: 'Tip this article' })`.
 */

/** Focuses the dialog's first or last control, in Tab order. */
async function focusEnd(dialog: Locator, end: 'first' | 'last') {
  await dialog.evaluate((root, end) => {
    const controls = [...root.querySelectorAll<HTMLElement>('*')].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !(element as HTMLButtonElement).disabled &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden'
    )
    const target = end === 'first' ? controls[0] : controls.at(-1)
    target?.focus()
  }, end)
}

/** Where focus is: the dialog's first or last control, inside, or outside. */
async function focusedEnd(dialog: Locator): Promise<string> {
  return dialog.evaluate((root) => {
    const controls = [...root.querySelectorAll<HTMLElement>('*')].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !(element as HTMLButtonElement).disabled &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden'
    )
    const active = document.activeElement
    if (active === controls[0]) return 'first'
    if (active === controls.at(-1)) return 'last'
    return root.contains(active) ? 'inside' : 'outside'
  })
}

/**
 * Tab and Shift+Tab wrap at the ends of the dialog, and so do Option+Tab
 * and Shift+Option+Tab, which move to buttons and links in Safari.
 */
export async function expectFocusWraps(page: Page, dialog: Locator) {
  for (const [from, key, to] of [
    ['last', 'Tab', 'first'],
    ['first', 'Shift+Tab', 'last'],
    ['last', 'Alt+Tab', 'first'],
    ['first', 'Shift+Alt+Tab', 'last'],
  ] as const) {
    await focusEnd(dialog, from)
    await page.keyboard.press(key)
    await expect
      .poll(() => focusedEnd(dialog), { message: `${key} from the ${from}` })
      .toBe(to)
  }
}

/** The dialog opened with focus on its own title (`aria-labelledby`). */
export async function expectOpensOnTitle(dialog: Locator) {
  await expect
    .poll(() =>
      dialog.evaluate((root) => {
        const id = root.getAttribute('aria-labelledby')
        return !!id && document.activeElement?.id === id
      })
    )
    .toBe(true)
}

/** Escape closes the dialog and focus returns to the control that opened it. */
export async function expectEscapeReturnsTo(
  page: Page,
  dialog: Locator,
  opener: Locator
) {
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
}
