'use client'

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { isPointerClick } from '@/system/pressGuard'

/** How long pointer clicks on a sheet are held after it opens, or changes
 * its content, on the heels of a press. */
export const SETTLE_MS = 400

/** How recent a press must be for an opening or a change to hold presses. */
export const AFTER_PRESS_MS = 1000

/** The last pointer press or release anywhere on the page. */
let lastPointerAt = -Infinity
let watching = false
/** Starts noting presses; called on first use. */
export function watchPointer() {
  if (watching || typeof window === 'undefined') return
  watching = true
  const note = () => {
    lastPointerAt = performance.now()
  }
  window.addEventListener('pointerdown', note, true)
  window.addEventListener('pointerup', note, true)
}

/**
 * A guard for a sheet whose content changes while it stays open. A double
 * tap is two presses: the first opens the wallet or the next step, and the
 * second lands on whatever took its place (a wallet row where Review was,
 * the Add button where a wallet row was). A lost press is safe; a doubled
 * one can ask a wallet to sign twice.
 *
 * So, for `SETTLE_MS` after the element mounts or `step` changes within
 * `AFTER_PRESS_MS` of a press, pointer clicks on the sheet around it (its
 * controls, its Close, its scrim) do nothing; a change with no press
 * before it (the account confirming, a minute later) holds nothing. A
 * keyboard or assistive click always passes (the shell's own test of a
 * pointer click, `isPointerClick`), and so does every click after
 * `SETTLE_MS`. A held key's repeats never press anything in the sheet.
 *
 * Presses after a sheet closes are the shell's: it holds every pointer
 * click for 400 ms after any modal closes, for any reason
 * (system/pressGuard.ts).
 */
export function useSettlingPresses<T extends HTMLElement>(
  step: string
): RefObject<T | null> {
  const ref = useRef<T>(null)
  const until = useRef(0)
  watchPointer()

  // Before paint, so no press lands between the change and the hold.
  useLayoutEffect(() => {
    if (performance.now() - lastPointerAt <= AFTER_PRESS_MS)
      until.current = performance.now() + SETTLE_MS
  }, [step])

  useEffect(() => {
    // The sheet (a dialog, scrim included), else the element itself.
    const inside = (event: Event) => {
      const region = ref.current?.closest('dialog') ?? ref.current
      return event.target instanceof Node && !!region?.contains(event.target)
    }
    const swallow = (event: MouseEvent) => {
      const at = performance.now()
      if (at >= until.current || !inside(event)) return
      const pointer = isPointerClick(
        {
          target: event.target,
          detail: event.detail,
          pointerType: (event as Partial<PointerEvent>).pointerType,
        },
        at
      )
      if (!pointer) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    // A held Enter or Space repeats: the repeats never press a control
    // here (the wallet row focused when the picker opens under it).
    const held = (event: KeyboardEvent) => {
      if (!event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
      if (!inside(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('click', swallow, true)
    window.addEventListener('keydown', held, true)
    return () => {
      window.removeEventListener('click', swallow, true)
      window.removeEventListener('keydown', held, true)
    }
  }, [])

  return ref
}
