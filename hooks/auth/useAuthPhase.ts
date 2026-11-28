'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useConvexAuth } from 'convex/react'
import {
  CONFIRM_MS,
  authPhase,
  signInSession,
  type AuthPhase,
} from '@/lib/auth/session'

/**
 * Who is here, with the moment after a sign-in read as "confirming" rather
 * than "signed out" while the backend has not answered the new token yet.
 * Surfaces that gate on sign-in read this, never `isAuthenticated` alone.
 */
export function useAuthPhase(): AuthPhase {
  const auth = useConvexAuth()
  const since = useSyncExternalStore(
    signInSession.subscribe,
    signInSession.confirmingSince,
    () => null
  )
  const [now, setNow] = useState(() => Date.now())
  const phase = authPhase(auth, since, now)
  useEffect(() => {
    if (phase === 'signed-in') signInSession.settle()
    if (phase !== 'confirming' || since === null) return
    // Re-read when the confirming window ends.
    const id = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, since + CONFIRM_MS - Date.now()) + 1
    )
    return () => window.clearTimeout(id)
  }, [phase, since])
  return phase
}
