'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { caretAt, choosePassage, type Passage } from './passageOffsets'

export type ChosenPassage = Passage & {
  /** How it was chosen: a tap on the line, or a native selection. */
  via: 'tap' | 'selection'
}

const SELECTION_SETTLE_MS = 180
/** A press that travels further than this is a scroll or a drag. */
const TAP_SLOP_PX = 10

function samePassage(a: Passage | null, b: Passage | null) {
  return (
    a !== null &&
    b !== null &&
    a.startOffset === b.startOffset &&
    a.endOffset === b.endOffset
  )
}

/**
 * Choosing a line in the server-rendered body. A tap on a line, or a
 * native selection once the finger or mouse lets go, chooses whole
 * sentences, for free. A drag is selection only: nothing here can pay. A
 * tap on the chosen line again, or `clear()`, unchooses it. Links, buttons
 * and captions keep their own taps. No swipe handler, no long press.
 *
 * `keep` saves the chosen line as the reader's own (from the legacy
 * reader's `handleCreateHighlight`); it is given by the caller so this hook
 * needs no backend.
 */
export function usePassageSelection(
  body: () => HTMLElement | null,
  {
    enabled = true,
    onChoose,
  }: { enabled?: boolean; onChoose?: (passage: ChosenPassage) => void } = {}
) {
  const [passage, setPassage] = useState<ChosenPassage | null>(null)
  const current = useRef<ChosenPassage | null>(null)
  const onChooseRef = useRef(onChoose)
  useEffect(() => {
    onChooseRef.current = onChoose
  }, [onChoose])

  const choose = useCallback((next: ChosenPassage | null) => {
    current.current = next
    setPassage(next)
    if (next) onChooseRef.current?.(next)
  }, [])

  const clear = useCallback(() => {
    const selection = window.getSelection()
    const root = body()
    if (
      selection &&
      !selection.isCollapsed &&
      root?.contains(selection.anchorNode)
    )
      selection.removeAllRanges()
    choose(null)
  }, [body, choose])

  useEffect(() => {
    const root = body()
    if (!root || !enabled) return
    let press: { x: number; y: number; id: number } | null = null
    let pointerDown = false
    let settle: ReturnType<typeof setTimeout> | undefined

    const fromSelection = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0)
        return
      const range = selection.getRangeAt(0)
      if (
        !root.contains(range.startContainer) &&
        !root.contains(range.endContainer)
      )
        return
      const start = root.contains(range.startContainer)
        ? { node: range.startContainer, offset: range.startOffset }
        : { node: root, offset: 0 }
      const end = root.contains(range.endContainer)
        ? { node: range.endContainer, offset: range.endOffset }
        : { node: root, offset: root.childNodes.length }
      const next = choosePassage(root, start, end)
      if (next && !samePassage(next, current.current))
        choose({ ...next, via: 'selection' })
    }

    const onPointerDown = (event: PointerEvent) => {
      pointerDown = true
      press = { x: event.clientX, y: event.clientY, id: event.pointerId }
    }
    const onPointerUp = () => {
      pointerDown = false
      clearTimeout(settle)
      settle = setTimeout(fromSelection, SELECTION_SETTLE_MS)
    }
    const onSelectionChange = () => {
      // While a finger or the mouse is down the selection is still moving;
      // touch handles move it with no pointer events, so settle on a pause.
      if (pointerDown) return
      clearTimeout(settle)
      settle = setTimeout(fromSelection, SELECTION_SETTLE_MS)
    }
    const onClick = (event: MouseEvent) => {
      // A double click selects a word: the selection path handles it.
      if (event.defaultPrevented || event.button !== 0) return
      const target = event.target as Element | null
      if (target?.closest('a, button, input, textarea, select, label')) return
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return
      if (
        press &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) >
          TAP_SLOP_PX
      )
        return
      const caret = caretAt(document, event.clientX, event.clientY)
      if (!caret) return
      const next = choosePassage(root, caret)
      if (!next) return
      if (samePassage(next, current.current)) choose(null)
      else choose({ ...next, via: 'tap' })
    }

    root.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerUp)
    document.addEventListener('selectionchange', onSelectionChange)
    root.addEventListener('click', onClick)
    return () => {
      clearTimeout(settle)
      root.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      root.removeEventListener('click', onClick)
    }
  }, [body, choose, enabled])

  /**
   * Saves the chosen line as the reader's own. With `clearAfter`, the line
   * is let go once saved; a Keep toggle leaves it chosen.
   */
  const keep = useCallback(
    async (
      save: (passage: Passage) => Promise<unknown>,
      { clearAfter = true }: { clearAfter?: boolean } = {}
    ) => {
      const chosen = current.current
      if (!chosen) return false
      const saved = await save(chosen)
      if (saved === null || saved === false) return false
      if (clearAfter) clear()
      return true
    },
    [clear]
  )

  return { passage, clear, keep }
}
