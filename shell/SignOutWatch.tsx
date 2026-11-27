'use client'

import { useEffect } from 'react'
import { useConvexAuth } from 'convex/react'
import { browserStorage } from '@/lib/wallet/remembered-wallet'
import { markSignedIn, settleSignedOut } from './signOut/session'

/**
 * Keeps sign-out whole (shell/signOut/session.ts): while signed in it keeps
 * the "signed in here" marker; signed out, on this load or after a change,
 * it removes wallet records and, if the marker is there, runs the cleanups.
 * Renders nothing.
 */
export function SignOutWatch() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  useEffect(() => {
    if (isLoading) return
    const storage = browserStorage()
    if (isAuthenticated) markSignedIn(storage)
    else void settleSignedOut(storage)
  }, [isAuthenticated, isLoading])
  return null
}
