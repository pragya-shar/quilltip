/**
 * Asks the page's basket button to open the basket sheet, for example from
 * "Open basket" in a tip dialog.
 */
export const OPEN_BASKET_EVENT = 'quilltip:open-tip-basket'

export function requestOpenBasket(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_BASKET_EVENT))
}
