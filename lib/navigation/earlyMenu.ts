/**
 * Before the page scripts run, the mobile menu is a popover
 * (components/layout/AppMobileMenu.tsx). This inline script does two things
 * until the scripts take over:
 *
 * - Unlike the modal dialog the scripts open, a popover lets Tab move on to
 *   the page behind the sheet. The script closes it when focus leaves it, so
 *   focus never lands on a link the sheet covers.
 * - It records whether the reader left the menu open (EARLY_MENU_PROPERTY).
 *   React sometimes renders the page again in the browser instead of
 *   attaching to the server HTML, which removes the open popover; the menu
 *   then opens again as the modal dialog.
 */

/** `open` or `closed` before the scripts run, `done` after. */
export const EARLY_MENU_PROPERTY = '__earlyMenu'

/**
 * Called once when the scripts take over: whether the reader left the menu
 * open before then. Later toggles are not recorded.
 */
export function takeEarlyMenuOpen(): boolean {
  const store = window as unknown as Record<string, string | undefined>
  const state = store[EARLY_MENU_PROPERTY]
  store[EARLY_MENU_PROPERTY] = 'done'
  return state === 'open'
}
