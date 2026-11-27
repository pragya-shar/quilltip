/**
 * The pages this visit went through inside the application, so the back
 * control of a pushed screen goes back through history only when the entry
 * behind it is this application's. Reached from an external link, then
 * Shelf, then the browser's Back: the entry behind is the other site, and
 * back becomes a plain link to the screen's place instead.
 *
 * Paths arrive from the shell (a change of pathname), with the history
 * length then, and popstate (Back or Forward) is reported before. A path
 * that arrives with a longer history was pushed; with the same length it
 * replaced the current entry (a replace, or a push after going back that
 * dropped the forward entries); after popstate it went back when it is the
 * entry below, else forward. When unsure, the stack is shorter, never
 * longer: back may fall back to the link, but never leaves the site.
 */
export function createAppHistory() {
  let stack: string[] = []
  let length = 0
  let popped = false
  return {
    /** Back or Forward is about to change the path. */
    popstate() {
      popped = true
    },
    /** The path now, and `history.length`. */
    arrive(path: string, historyLength: number) {
      const wasPopped = popped
      popped = false
      const grew = historyLength > length
      length = historyLength
      if (stack.length === 0) {
        stack = [path]
        return
      }
      if (stack.at(-1) === path) return
      if (wasPopped) {
        if (stack.at(-2) === path) stack = stack.slice(0, -1)
        else stack = [...stack, path]
        return
      }
      stack = grew ? [...stack, path] : [...stack.slice(0, -1), path]
    },
    /** Whether the entry behind this one is a page of this application. */
    canGoBack: () => stack.length > 1,
    /** For tests. */
    pages: () => [...stack],
  }
}

export const appHistory = createAppHistory()
