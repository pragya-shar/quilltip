'use client'

import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'
import type { ReactNode } from 'react'
import { AuthSessionProvider } from '@/components/providers/AuthContext'

// The same deployment and the same Convex Auth storage key as the legacy
// pages, so a session survives the full page load between the two.
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)

/**
 * The application's providers: Convex with auth, and the one auth state.
 * They render their children on the server as they are; nothing here waits
 * or suspends, so content is in the first response (D19).
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthProvider client={convex}>
      <AuthSessionProvider>{children}</AuthSessionProvider>
    </ConvexAuthProvider>
  )
}
