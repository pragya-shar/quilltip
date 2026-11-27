/**
 * The real payments engine, mounted after `?engineDelay=<ms>` so a test can
 * tap the control before the engine is ready (the early tap).
 */
import { useEffect, useState } from 'react'
import { PaymentsEngine as RealEngine } from '../../../components/payments/PaymentsEngine'

const delay = Number(new URLSearchParams(location.search).get('engineDelay') ?? 0)

export function PaymentsEngine() {
  const [ready, setReady] = useState(delay <= 0)
  useEffect(() => {
    if (ready) return
    const id = window.setTimeout(() => setReady(true), delay)
    return () => window.clearTimeout(id)
  }, [ready])
  return ready ? <RealEngine /> : null
}
