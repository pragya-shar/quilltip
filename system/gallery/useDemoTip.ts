'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MoneyValue } from '../money/figure'
import type { TipControlPhase } from '../money/tip'
import { amounts } from './samples'

/**
 * A stand-in for `useTip` from hooks/payments, for the gallery only: it
 * walks sending, then sent (or failed when `refuse` is on), then idle. No
 * money moves; nothing leaves the page.
 */
export function useDemoTip(refuse: boolean) {
  const [state, setState] = useState<TipControlPhase>({ phase: 'idle' })
  const [amount, setAmount] = useState<MoneyValue>(amounts[0]!)
  const timers = useRef<number[]>([])
  useEffect(
    () => () => timers.current.forEach((id) => window.clearTimeout(id)),
    []
  )
  const later = (ms: number, next: TipControlPhase) => {
    timers.current.push(window.setTimeout(() => setState(next), ms))
  }
  const tip = useCallback(() => {
    setState({ phase: 'sending', amount })
    if (refuse) {
      later(900, { phase: 'failed', amount })
    } else {
      later(900, { phase: 'sent', amount })
      later(2400, { phase: 'idle' })
    }
  }, [amount, refuse])
  const setCents = useCallback((cents: number) => {
    const known = amounts.find((a) => a.cents === cents)
    setAmount(
      known ?? {
        cents,
        display: `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`,
      }
    )
    setState({ phase: 'idle' })
  }, [])
  return { state, amount, tip, setCents }
}
