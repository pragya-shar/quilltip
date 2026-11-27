'use client'

/**
 * The passage tip from the balance: state for `PassageTipBar`. Keeps the
 * chosen passage visible: it is marked in the article (CSS Custom Highlight
 * API, so the editor's DOM is untouched), scrolled above the bar when the
 * bar would cover it, and never moved after a tip (D7). A tip does nothing
 * else (D4): no follow, no public highlight.
 */
import { useEffect, useRef, useState } from 'react'
import { tipLabel } from '@/lib/payments/tip-machine'
import type { TipController } from '@/lib/payments/types'
import { PassageTipBar, type PassageTipBarProps } from './PassageTipBar'

const ADD_MONEY_HREF = '/dashboard/tab'
/** "Sent $1" stays on the button this long (design 0.1). */
const SENT_LABEL_MS = 1500
/** Room the bar takes at the bottom of the viewport, with a margin. */
const BAR_ROOM_PX = 150

type HighlightRegistry = {
  set(name: string, highlight: unknown): void
  delete(name: string): void
}
type HighlightCtor = new (...ranges: Range[]) => { add(range: Range): void }

function highlights(): {
  registry: HighlightRegistry
  Ctor: HighlightCtor
} | null {
  const css = globalThis.CSS as unknown as { highlights?: HighlightRegistry }
  const Ctor = (globalThis as unknown as { Highlight?: HighlightCtor })
    .Highlight
  return css?.highlights && Ctor ? { registry: css.highlights, Ctor } : null
}

/** Tipped passages stay marked for the rest of the page's life. */
const tipped: Range[] = []

export type PassageTipProps = {
  tip: TipController
  writerName: string
  onClose(): void
  onHighlight?: () => void
  highlightBusy?: boolean
}

export function PassageTip({
  tip,
  writerName,
  onClose,
  onHighlight,
  highlightBusy,
}: PassageTipProps) {
  const [trayOpen, setTrayOpen] = useState(false)
  const [lastSent, setLastSent] = useState<string | null>(null)
  const range = useRef<Range | null>(null)
  const { state } = tip

  // Mark the passage and keep it above the bar.
  useEffect(() => {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      range.current = selection.getRangeAt(0).cloneRange()
    }
    const api = highlights()
    if (api && range.current)
      api.registry.set('qt-passage', new api.Ctor(range.current))
    const rect = range.current?.getBoundingClientRect()
    if (rect && rect.bottom > window.innerHeight - BAR_ROOM_PX) {
      const reduce = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches
      window.scrollBy({
        top: rect.bottom - (window.innerHeight - BAR_ROOM_PX),
        behavior: reduce ? 'auto' : 'smooth',
      })
    }
    return () => {
      highlights()?.registry.delete('qt-passage')
    }
  }, [])

  // After acceptance: mark the passage as tipped, then return the button.
  useEffect(() => {
    if (state.phase !== 'sent') return
    setLastSent(
      `You tipped ${writerName} ${state.amount.display.replace(/\.00$/, '')}. Tips are final.`
    )
    const api = highlights()
    if (api && range.current) {
      tipped.push(range.current)
      api.registry.set('qt-tipped', new api.Ctor(...tipped))
    }
    const id = window.setTimeout(() => tip.reset(), SENT_LABEL_MS)
    return () => window.clearTimeout(id)
  }, [state.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape clears the passage, except while a tip is in flight.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || state.phase === 'sending') return
      if (trayOpen) setTrayOpen(false)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state.phase, trayOpen, onClose])

  const short = (display: string) => display.replace(/\.00$/, '')
  let status: PassageTipBarProps['status'] = lastSent
    ? { text: lastSent }
    : null
  if (state.phase === 'sending')
    status = {
      text: `Sending ${short(state.amount.display)} to ${writerName}.`,
    }
  else if (state.phase === 'failed')
    status = {
      text: 'That tip did not go through. You were not charged.',
      tone: 'danger',
    }
  else if (state.phase === 'offline')
    status = { text: 'You are offline. Tip again when you are back online.' }
  else if (state.phase === 'needs-funds')
    status = {
      text: `You have ${state.available.display}.`,
      link: {
        href: ADD_MONEY_HREF,
        label: `Add money to tip ${short(state.amount.display)}`,
      },
    }

  return (
    <PassageTipBar
      phase={state}
      label={tipLabel(state, tip.amount, true)}
      amount={tip.amount}
      amounts={tip.amounts}
      trayOpen={trayOpen}
      status={status}
      onTip={() => {
        setLastSent(null)
        void tip.tip()
      }}
      onToggleTray={() => setTrayOpen((open) => !open)}
      onChooseAmount={(cents) => {
        tip.setAmount(cents)
        setTrayOpen(false)
      }}
      onClear={onClose}
      onHighlight={onHighlight}
      highlightBusy={highlightBusy}
    />
  )
}
