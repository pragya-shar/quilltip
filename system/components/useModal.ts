'use client'

import { useEffect, useRef, type RefObject } from 'react'
import {
  focusDestination,
  inputModality,
  recentlyPressed,
  watchInputModality,
} from '../inputModality'
import { modalStack } from '../modalStack'
import { holdPresses } from '../pressGuard'

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
 * - For a moment after a press closes it, pointer presses are swallowed
 *   (system/pressGuard.ts), so a second tap never reaches the sliding
 *   panel or the page under it.
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
    dialog.addEventListener('cancel', onCancel)
    dialog.addEventListener('keydown', onKey)
    return () => {
      dialog.removeEventListener('cancel', onCancel)
      dialog.removeEventListener('keydown', onKey)
      openCount -= 1
      if (openCount === 0) delete root.dataset.scrollLocked
      dialog.dataset.closing = ''
      modalStack.remove(dialog)
      // Closed by a press (not a key), and a real close, not an effect
      // re-run (React StrictMode opens it again in the same task).
      const byPointer = inputModality() === 'pointer'
      queueMicrotask(() => {
        if (byPointer && dialog.dataset.closing !== undefined) holdPresses()
      })
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
