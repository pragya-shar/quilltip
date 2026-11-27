'use client'

/**
 * Focus rules shared by every dialog, sheet and alert dialog (#591):
 *
 * - Tab, Shift+Tab, Option+Tab and Shift+Option+Tab wrap inside the dialog.
 *   The Radix focus trap wraps plain Tab only; Safari moves buttons and
 *   links with Option+Tab, and its plain Tab skips them, so either press
 *   could leave the dialog and be pulled back to where it started.
 * - On close, focus returns to the control that opened the dialog, even
 *   when Safari did not focus it on click, or the nearest thing still on
 *   the page when it is gone.
 * - `initialFocus="title"` opens the dialog on its title, so the reader
 *   hears what it is for before any action.
 */
import { useCallback, useRef } from 'react'
import type * as React from 'react'

const PRESSABLE =
  'button, a[href], input, select, textarea, summary, [role="button"], [role="menuitem"], [tabindex]'
const DIALOG = '[role="dialog"], [role="alertdialog"]'

/** The control an event or focus landed on, never a dialog's own box. */
function control(element: Element | null): HTMLElement | null {
  const found = element?.closest<HTMLElement>(PRESSABLE) ?? null
  return found && !found.matches(DIALOG) ? found : null
}

/** The control the reader last pressed; Safari does not focus it on click. */
let lastPressed: { element: HTMLElement; at: number } | null = null
const PRESS_WINDOW_MS = 1_500

if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (event) => {
      const element = control(
        event.target instanceof Element ? event.target : null
      )
      if (element) lastPressed = { element, at: Date.now() }
    },
    true
  )
}

function visible(element: HTMLElement): boolean {
  return (
    element.isConnected &&
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden'
  )
}

/** Controls in the dialog in Tab order, as the Radix focus trap counts them. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const element = node as HTMLElement
      if (element.closest('[inert]')) return NodeFilter.FILTER_REJECT
      const disabled =
        'disabled' in element && (element as HTMLButtonElement).disabled
      const hiddenInput =
        element.tagName === 'INPUT' &&
        (element as HTMLInputElement).type === 'hidden'
      return element.tabIndex >= 0 && !disabled && !hiddenInput
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP
    },
  })
  while (walker.nextNode()) {
    const element = walker.currentNode as HTMLElement
    if (visible(element)) found.push(element)
  }
  return found
}

type Opener = {
  /** The dialog this opener opened, for the close check. */
  dialog: HTMLElement | null
  element: HTMLElement
  /** The menu's trigger, when the opener was an item in a menu. */
  menuTrigger: HTMLElement | null
  tag: string
  name: string
  ancestors: HTMLElement[]
}

function nameOf(element: HTMLElement): string {
  return (element.getAttribute('aria-label') ?? element.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function recordOpener(content: HTMLElement | null): Opener | null {
  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  let element =
    active && !content?.contains(active) && active.matches(PRESSABLE)
      ? control(active)
      : null
  // A click in Safari leaves focus on the page or on a dialog under this
  // one; the control pressed just before is the opener.
  if (
    !element &&
    lastPressed &&
    Date.now() - lastPressed.at < PRESS_WINDOW_MS &&
    !content?.contains(lastPressed.element)
  ) {
    element = lastPressed.element
  }
  if (!element) return null
  const menu = element.closest('[role="menu"]')
  const triggerId = menu?.getAttribute('aria-labelledby')
  const ancestors: HTMLElement[] = []
  for (let node = element.parentElement; node; node = node.parentElement) {
    ancestors.push(node)
  }
  return {
    dialog: content,
    element,
    menuTrigger: triggerId ? document.getElementById(triggerId) : null,
    tag: element.tagName,
    name: nameOf(element),
    ancestors,
  }
}

/** Where focus goes back to: the opener, its replacement, or what is left. */
function returnTarget(opener: Opener): HTMLElement | null {
  if (visible(opener.element)) return opener.element
  // Re-rendered: the same kind of control with the same name.
  if (opener.name) {
    const twin = [
      ...document.querySelectorAll<HTMLElement>(opener.tag.toLowerCase()),
    ].find(
      (element) =>
        nameOf(element) === opener.name &&
        visible(element) &&
        !element.closest(DIALOG)
    )
    if (twin) return twin
  }
  if (opener.menuTrigger && visible(opener.menuTrigger)) {
    return opener.menuTrigger
  }
  for (const ancestor of opener.ancestors) {
    if (!ancestor.isConnected || ancestor === document.body) continue
    if (ancestor.matches(PRESSABLE) && visible(ancestor)) return ancestor
    const control = tabbables(ancestor)[0]
    if (control) return control
  }
  const main = document.querySelector<HTMLElement>('main')
  if (main) {
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
    return main
  }
  return null
}

/** The content's own ref and the opener, kept across renders. */
export function useDialogFocusRefs<T extends HTMLDivElement>(
  forwarded: React.ForwardedRef<T>
) {
  const content = useRef<T | null>(null)
  const opener = useRef<Opener | null>(null)
  const setRef = useCallback(
    (node: T | null) => {
      content.current = node
      if (typeof forwarded === 'function') forwarded(node)
      else if (forwarded) forwarded.current = node
    },
    [forwarded]
  )
  return { content, opener, setRef }
}

/** Counts Tab presses, so a late check after a newer press does nothing. */
let tabPresses = 0

export type DialogFocusOptions = {
  /** `title` focuses the dialog's title when it opens. */
  initialFocus?: 'title'
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
}

/**
 * Handlers for a Radix dialog's content. Each runs the caller's handler
 * first; a caller that calls `preventDefault()` keeps its own behaviour.
 */
export function dialogFocusHandlers(
  content: React.RefObject<HTMLDivElement | null>,
  opener: React.MutableRefObject<Opener | null>,
  options: DialogFocusOptions
) {
  return {
    onOpenAutoFocus(event: Event) {
      opener.current = recordOpener(content.current)
      options.onOpenAutoFocus?.(event)
      if (event.defaultPrevented || options.initialFocus !== 'title') return
      const root = content.current
      const id = root?.getAttribute('aria-labelledby')
      const title = id ? document.getElementById(id) : null
      if (!title) return
      event.preventDefault()
      if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1')
      title.focus({ preventScroll: true })
    },
    onCloseAutoFocus(event: Event) {
      options.onCloseAutoFocus?.(event)
      const recorded = opener.current
      opener.current = null
      if (event.defaultPrevented || !recorded) return
      // A dialog can unmount after its exit animation, when the page has
      // already moved focus on (a payment result, say): leave it there.
      const active = document.activeElement
      const lost =
        !active ||
        active === document.body ||
        !!recorded.dialog?.contains(active) ||
        active.matches(DIALOG)
      // The opener is gone and focus already sits on the dialog that held
      // it: the page replaced the opener (a refusal, say) while this dialog
      // was closing. Leave focus there, as without this dialog.
      const heldOpener =
        !!active &&
        active.matches(DIALOG) &&
        !visible(recorded.element) &&
        recorded.ancestors.includes(active as HTMLElement)
      if (!lost || heldOpener) {
        event.preventDefault()
        return
      }
      const target = returnTarget(recorded)
      if (!target) return
      event.preventDefault()
      target.focus({ preventScroll: true })
    },
    onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
      options.onKeyDown?.(event)
      if (event.key !== 'Tab' || event.ctrlKey || event.metaKey) return
      // A newer Tab press makes an older pending check stale.
      const press = ++tabPresses
      if (event.defaultPrevented) return
      const root = event.currentTarget
      // React events bubble out of a nested dialog's portal; only the dialog
      // that holds the focused control handles its Tab.
      if (!(event.target instanceof Node) || !root.contains(event.target)) {
        return
      }
      const list = tabbables(root)
      const first = list[0]
      const last = list[list.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      // Option+Tab at an end: the focus trap does not wrap it.
      if (event.altKey) {
        if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        } else if (event.shiftKey && (active === first || active === root)) {
          event.preventDefault()
          last.focus()
        }
        return
      }
      // Safari's plain Tab skips buttons and links, so it can leave the
      // dialog from a middle control, and the trap pulls focus back.
      const before = active
      const backward = event.shiftKey
      setTimeout(() => {
        if (press !== tabPresses) return
        if (document.activeElement !== before || !root.isConnected) return
        const again = tabbables(root)
        const target = backward ? again[again.length - 1] : again[0]
        if (target && target !== before) target.focus()
      }, 0)
    },
  }
}
