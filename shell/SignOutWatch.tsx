'use client'

import { useEffect, useRef } from 'react'
import { useConvexAuth } from 'convex/react'
import { runSignOutCleanups } from './signOut'

/**
 * Runs the sign-out cleanups (shell/signOut) when this browser goes from
 * signed in to signed out. Renders nothing.
 */
export function SignOutWatch() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const was = useRef<boolean | null>(null)
  useEffect(() => {
    if (isLoading) return
    if (was.current === true && !isAuthenticated) void runSignOutCleanups()
    was.current = isAuthenticated
  }, [isAuthenticated, isLoading])
  return null
}
