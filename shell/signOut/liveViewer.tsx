'use client'

import { useConvex } from 'convex/react'
import { useCallback, type ReactNode } from 'react'
import { api } from '@/convex/_generated/api'
import { SignOutViewerContext } from './viewer'

/**
 * The live sign-out viewer: one query for the current user when a sign-out
 * starts, no subscription. Inside the Convex provider.
 */
export function LiveSignOutViewer({ children }: { children: ReactNode }) {
  const convex = useConvex()
  const viewer = useCallback(async () => {
    const user = await convex.query(api.users.getCurrentUser, {})
    return user?._id ?? null
  }, [convex])
  return (
    <SignOutViewerContext.Provider value={viewer}>
      {children}
    </SignOutViewerContext.Provider>
  )
}
