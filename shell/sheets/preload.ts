import { preloadSheet } from './loadSheet'

/**
 * Props for the control that opens a declared sheet: warms its code on
 * hover and focus, so it is usually there by the press.
 *
 *   <Button {...warmSheet('add-money')} onClick={() => sheetStack.open('add-money', p)}>
 */
export function warmSheet(id: string) {
  const warm = () => {
    void preloadSheet(id)?.catch(() => {})
  }
  return { onPointerEnter: warm, onFocus: warm }
}
