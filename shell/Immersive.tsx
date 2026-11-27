/**
 * Rendered by a page that hides the phone bar (an article, a pushed screen).
 * CSS reads it with :has(), so it works with no script and with no state
 * to reset on navigation.
 */
export function Immersive() {
  return <span data-shell-chrome="immersive" hidden />
}
