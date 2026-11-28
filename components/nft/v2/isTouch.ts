/** A coarse pointer: focusing a text field would open the keyboard. */
export function isTouch(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(pointer: coarse)').matches === true
  )
}
