import { SESSION_ATTR } from './prePaint'

/**
 * The session marker on <html> follows auth once it answers, and it shows
 * one of the balance item's two links. A switch while a finger or the mouse
 * is down on the item would move the press from one link to the other, and
 * a press that ends on another element makes no click. So while a pointer is
 * down on the item, a change waits, and applies one task after the press
 * ends (after its click). Pure on its `apply`.
 */
export function createMarkerSync(apply: (held: boolean) => void) {
  let down = false
  let pending: boolean | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let scheduled: boolean | null = null
  return {
    /** The marker should say `held`. */
    set(held: boolean) {
      if (down) pending = held
      else apply(held)
    },
    pointerDown() {
      down = true
      // A change about to apply waits for this press too.
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
        if (pending === null) pending = scheduled
      }
    },
    /** The press ended (up, cancel or leave): apply what waited. */
    pointerEnd() {
      if (!down) return
      down = false
      const next = pending
      pending = null
      if (next === null) return
      scheduled = next
      timer = setTimeout(() => {
        timer = null
        apply(next)
      }, 0)
    },
  }
}

/** Sets or removes the marker on <html>. */
export function applySessionMarker(held: boolean) {
  const root = document.documentElement
  if (held) root.setAttribute(SESSION_ATTR, 'held')
  else root.removeAttribute(SESSION_ATTR)
}
