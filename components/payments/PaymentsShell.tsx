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
 * doubles up to five minutes, at once on the next navigation, and at once
 * on "Try again" (`paymentsStore.retry`). No reload is needed when the
 * backend catches up.
 *
 * It tells the store which user and session this deployment's session
 * token names (`readSession`): on mount, on each auth change, when another
 * tab changes the token, on focus, when the page becomes visible or is shown
 * again from the back-forward cache, and when the engine claims the store
 * for a pair the token did not name. The store and the engine read it again
 * before every send. Figures held for another pair go at once, and none
 * show until the engine claims the store for the pair in the token
 * (`figuresShown`).
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
import { isTokenKey, paymentsStore } from '@/lib/payments/store'
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

  useEffect(() => {
    const read = () => paymentsStore.readSession()
    read()
    const onStorage = (event: StorageEvent) => {
      if (isTokenKey(event.key)) read()
    }
    // A change no event announces (another tab whose write raced, a token
    // replaced while this page was in the background) is seen when the
    // reader comes back to it.
    const onVisible = () => {
      if (document.visibilityState === 'visible') read()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', read)
    window.addEventListener('pageshow', read)
    document.addEventListener('visibilitychange', onVisible)
    // The engine claimed the store for a user the token did not name: read
    // the token again (a sign-in in this tab writes it before auth says so),
    // once per claimed user.
    let checked: string | null = null
    const off = paymentsStore.subscribe(() => {
      const { owner, session } = paymentsStore.get()
      if (owner === null || owner === session || owner === checked) return
      checked = owner
      read()
    })
    const detach = paymentsStore.attachShell()
    return () => {
      detach()
      off()
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', read)
      window.removeEventListener('pageshow', read)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    paymentsStore.onEngineWanted(() => setWanted(true))
  }, [])

  useEffect(() => {
    paymentsStore.readSession()
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
  useEffect(
    () =>
      paymentsStore.onRetry(() => {
        if (failedAt === null) return
        delay.current = FIRST_RETRY_MS
        retry()
      }),
    [failedAt, retry]
  )
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
