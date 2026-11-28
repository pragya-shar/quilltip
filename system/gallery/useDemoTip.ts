'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TipHold } from '../components/TipControl'
import type { MoneyValue } from '../money/figure'
import type { TipControlPhase } from '../money/tip'
import { amounts } from './sampleAmounts'

const HOLD_MS = 3000
const BALANCE_CENTS = 1840

const dollars = (cents: number) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`

/** The balance, converted at today's price, as the money layer flags it. */
const balance = (cents: number): MoneyValue => ({
  cents,
  display: `$${(cents / 100).toFixed(2)}`,
  converted: true,
})

/**
 * A stand-in for `useTip` from hooks/payments, for the gallery only. With
 * `withHold`, a press holds for 3 s ("+$1" restarts it, Cancel or Escape
 * stops it), then sends; without it the tip sends at once, as the money
 * layer does until it holds tips. Sending, then sent (or failed when `refuse` is on), then idle. No
 * money moves; nothing leaves the page.
 */
export function useDemoTip(refuse: boolean, withHold = false) {
  const [state, setState] = useState<TipControlPhase>({ phase: 'idle' })
  const [amount, setAmount] = useState<MoneyValue>(amounts[0]!)
  const [restartKey, setRestartKey] = useState(0)
  const timers = useRef<number[]>([])
  const holdTimer = useRef<number | null>(null)
  const clear = () => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
  }
  useEffect(() => () => clear(), [])
  const later = (ms: number, next: TipControlPhase) => {
    timers.current.push(window.setTimeout(() => setState(next), ms))
  }
  const send = useCallback(
    (sent: MoneyValue) => {
      setState({ phase: 'sending', amount: sent })
      if (refuse) {
        later(900, { phase: 'failed', amount: sent })
      } else {
        later(900, { phase: 'sent', amount: sent })
        later(2500, { phase: 'idle' })
      }
    },
    [refuse]
  )
  const startHold = useCallback(
    (held: MoneyValue) => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
      setState({ phase: 'holding', amount: held })
      holdTimer.current = window.setTimeout(() => send(held), HOLD_MS)
    },
    [send]
  )
  const tip = useCallback(() => {
    if (withHold) startHold(amount)
    else send(amount)
  }, [amount, send, startHold, withHold])
  const setCents = useCallback((cents: number) => {
    const known = amounts.find((a) => a.cents === cents)
    setAmount(known ?? { cents, display: dollars(cents) })
    setState({ phase: 'idle' })
  }, [])
  const held = state.phase === 'holding' ? state.amount : undefined
  const hold: TipHold | null = held
    ? {
        projected: {
          before: balance(BALANCE_CENTS),
          after: balance(BALANCE_CENTS - held.cents),
        },
        restartKey,
        addOneBlocked: held.cents + 100 > 500 ? 'your daily limit is $5' : null,
        onAddOne: () => {
          const next = {
            cents: held.cents + 100,
            display: dollars(held.cents + 100),
          }
          setRestartKey((k) => k + 1)
          startHold(next)
        },
        onCancel: () => {
          if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
          holdTimer.current = null
          setState({ phase: 'idle' })
        },
      }
    : null
  return { state, amount, tip, setCents, hold }
}
