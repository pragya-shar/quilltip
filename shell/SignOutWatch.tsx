'use client'

import { useEffect } from 'react'
import { useConvexAuth } from 'convex/react'
import { markSignedIn } from './signOut/state'

const storage = () => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Keeps sign-out whole (shell/signOut/session.ts): while signed in it keeps
 * the "signed in here" marker; signed out, on this load or after a change,
 * it removes wallet records and, if the marker is there, runs the cleanups.
 * That work loads only then, after the first paint. Renders nothing.
 */
export function SignOutWatch() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  useEffect(() => {
    if (isLoading) return
    if (isAuthenticated) {
      markSignedIn(storage())
      return
    }
    let alive = true
    void import('./signOut/session').then((m) => {
      if (alive) void m.settleSignedOut(storage())
    })
    return () => {
      alive = false
    }
  }, [isAuthenticated, isLoading])
  return null
}
