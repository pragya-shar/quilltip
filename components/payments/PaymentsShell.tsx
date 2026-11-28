'use client'

/**
 * The payments shell, the only payments code in the root layout. It keeps
 * `paymentsStore` in step with the auth state and loads the engine with
 * `import()` after first paint, only when the visitor is signed in (or a
 * tip control was pressed before sign-in was known). A signed-out visitor
 * never downloads it. The engine renders beside the page, never around it,
 * inside its own boundary, so pages never remount when it arrives and never
 * fall with it; it stays mounted across client navigation.
 *
 * When the engine fails (it could not load, or a payments query threw), the
 * views read "unavailable" and the shell tries again after a delay that
 * doubles up to five minutes, and at once on the next navigation. No reload
 * is needed when the backend catches up.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react'
import { usePathname } from 'next/navigation'
import { useConvexAuth } from 'convex/react'
import { paymentsStore } from '@/lib/payments/store'
import { PaymentsBoundary } from './PaymentsBoundary'

export const FIRST_RETRY_MS = 5_000
export const MAX_RETRY_MS = 5 * 60 * 1000

export function PaymentsShell() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const pathname = usePathname()
  const [Engine, setEngine] = useState<ComponentType | null>(null)
  const [wanted, setWanted] = useState(false)
  // Bumped to remount the engine after a failure.
  const [attempt, setAttempt] = useState(0)
  const [failedAt, setFailedAt] = useState<number | null>(null)
  const delay = useRef(FIRST_RETRY_MS)

  useEffect(() => paymentsStore.attachShell(), [])

  useEffect(() => {
    paymentsStore.onEngineWanted(() => setWanted(true))
  }, [])

  useEffect(() => {
    paymentsStore.setAuth(
      isLoading ? 'loading' : isAuthenticated ? 'signed-in' : 'signed-out'
    )
  }, [isLoading, isAuthenticated])

  const signedIn = isAuthenticated && !isLoading
  const load = !Engine && (signedIn || wanted)
  useEffect(() => {
    if (!load || failedAt !== null) return
    let alive = true
    paymentsStore.set({ engine: 'loading' })
    // After first paint: the page and its text come first.
    const id = window.setTimeout(() => {
      import('./PaymentsEngine')
        .then((m) => {
          if (!alive) return
          setEngine(() => m.PaymentsEngine)
          paymentsStore.set({ engine: 'ready' })
        })
        .catch(() => {
          if (!alive) return
          paymentsStore.fail()
          setFailedAt(Date.now())
        })
    }, 0)
    return () => {
      alive = false
      window.clearTimeout(id)
    }
  }, [load, failedAt])

  const onError = useCallback(() => {
    paymentsStore.fail()
    setFailedAt(Date.now())
  }, [])

  // Try again after a delay, and at once on navigation.
  const retry = useCallback(() => {
    setFailedAt(null)
    setAttempt((n) => n + 1)
    paymentsStore.set({ engine: Engine ? 'ready' : 'idle' })
  }, [Engine])
  useEffect(() => {
    if (failedAt === null) return
    const id = window.setTimeout(() => {
      delay.current = Math.min(delay.current * 2, MAX_RETRY_MS)
      retry()
    }, delay.current)
    return () => window.clearTimeout(id)
  }, [failedAt, retry])
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    if (failedAt === null) return
    delay.current = FIRST_RETRY_MS
    retry()
  }, [pathname, failedAt, retry])

  if (!Engine || failedAt !== null || !(signedIn || wanted)) return null
  return (
    <PaymentsBoundary key={attempt} onError={onError}>
      <Engine />
    </PaymentsBoundary>
  )
}
