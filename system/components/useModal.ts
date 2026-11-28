'use client'

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import {
  focusDestination,
  inputModality,
  recentlyPressed,
  watchInputModality,
} from '../inputModality'
import { modalStack } from '../modalStack'
import { holdPresses, noteModalOpened } from '../pressGuard'

/** Open modals, so scroll stays locked until the last one closes. */
let openCount = 0

const FOCUSABLE = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Every control in a modal, in order, that can take focus now. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && !el.closest('[inert]')
  )
}

/**
 * A native modal <dialog> driven by `open`, with the focus rules the shell
 * keeps everywhere:
 * - It opens with focus on `[data-autofocus]` if a control asks for it,
 *   otherwise on its title (`[data-modal-title]`): never on Close. Focus is
 *   moved by script, so a ring shows only when the person used a keyboard.
 * - Tab and Shift+Tab move through every control and wrap, with or without
 *   Option (Safari reaches buttons only with Option+Tab; both wrap here).
 * - Escape goes through `onClose`, so React stays the source of truth.
 * - Focus returns to the element that opened it (the focused one, or the
 *   one pressed when Safari focused none), or to the page content if
 *   that element is gone (never the page body); if the page moved focus
 *   elsewhere while it closed, focus stays there.
 * - The page behind does not scroll (iOS Safari included).
 * - For 400 ms after it closes or unmounts, for any reason, pointer clicks
 *   on the page do nothing, except inside a modal opened after the close
 *   (system/pressGuard.ts). In development, React's StrictMode runs the
 *   close once on mount, so a page click may be held for 400 ms then.
 */
export function useModal(
  open: boolean,
  onClose: () => void
): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => watchInputModality(), [])
  // The hold starts with the close itself: a layout-effect cleanup runs in
  // the commit that closes or unmounts the modal, before the browser can
  // take another click (system/pressGuard.ts). Every close holds.
  useLayoutEffect(() => {
    if (!open) return
    return () => holdPresses()
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open) return
    // Remember the opener only when opening, not when an effect re-runs
    // with the dialog already open (React StrictMode in development).
    if (!dialog.open) {
      // Opened by a key: the focused control. Opened by a press: the control
      // that was pressed, since Safari focuses no pressed button and leaves
      // focus wherever it was (the body, or the page's main).
      const active =
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body
          ? document.activeElement
          : null
      const pressedControl =
        inputModality() === 'pointer' ? recentlyPressed() : null
      openerRef.current = pressedControl ?? active
    }
    delete dialog.dataset.closing
    const wasOpen = dialog.open
    if (!wasOpen) dialog.showModal()
    // Its own clicks pass during a hold that began before it opened
    // (system/pressGuard.ts).
    noteModalOpened(dialog)
    modalStack.push(dialog)
    const first =
      dialog.querySelector<HTMLElement>('[data-autofocus]') ??
      dialog.querySelector<HTMLElement>('[data-modal-title]')
    if (!wasOpen) {
      if (first?.matches('[data-modal-title]')) focusDestination(first)
      else first?.focus({ preventScroll: true })
    }
    openCount += 1
    const root = document.documentElement
    root.dataset.scrollLocked = ''

    const onCancel = (event: Event) => {
      event.preventDefault()
      closeRef.current()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusables(dialog)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      const at = items.indexOf(document.activeElement as HTMLElement)
      const next = event.shiftKey
        ? at <= 0
          ? items.length - 1
          : at - 1
        : at === -1 || at === items.length - 1
          ? 0
          : at + 1
      items[next]?.focus()
    }
    // The visible area, above the on-screen keyboard
    // (system/components/modalViewport.ts), loaded when a modal opens.
    let unfit: (() => void) | undefined
    let gone = false
    void import('./modalViewport').then(({ fitToViewport }) => {
      if (!gone) unfit = fitToViewport(dialog)
    })
    dialog.addEventListener('cancel', onCancel)
    dialog.addEventListener('keydown', onKey)
    return () => {
      gone = true
      unfit?.()
      dialog.removeEventListener('cancel', onCancel)
      dialog.removeEventListener('keydown', onKey)
      openCount -= 1
      if (openCount === 0) delete root.dataset.scrollLocked
      dialog.dataset.closing = ''
      modalStack.remove(dialog)
      const finish = () => {
        // Opened again before the exit finished: keep it open.
        if (dialog.dataset.closing === undefined) return
        delete dialog.dataset.closing
        // The page already moved focus elsewhere while the sheet closed (a
        // navigation, a new sheet): leave it there.
        const active = document.activeElement
        const moved =
          active instanceof HTMLElement &&
          active !== document.body &&
          !dialog.contains(active)
        if (dialog.open) dialog.close()
        if (moved) {
          if (document.activeElement !== active)
            active.focus({ preventScroll: true })
          return
        }
        const opener = openerRef.current
        // Back to the opener, or, if it is gone, to the page content: never
        // the page body.
        const target =
          opener?.isConnected && opener.getClientRects().length > 0
            ? opener
            : (document.getElementById('content') ??
              document.querySelector<HTMLElement>('main'))
        if (
          target &&
          !target.hasAttribute('tabindex') &&
          target.tagName === 'MAIN'
        )
          target.tabIndex = -1
        target?.focus({ preventScroll: true })
      }
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
      if (reduced.matches) finish()
      else window.setTimeout(finish, 200)
    }
  }, [open])

  return ref
}
