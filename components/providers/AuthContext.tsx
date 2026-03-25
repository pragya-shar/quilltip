'use client'

import { useAuthActions } from '@convex-dev/auth/react'
import { useConvexAuth } from 'convex/react'
import { Value } from 'convex/values'
import { useCurrentUser } from '@/hooks/convex'
import type { CurrentUser } from '@/types/convex'

export type User = CurrentUser

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  signIn: (
    provider: string,
    params?: FormData | Record<string, Value>
  ) => Promise<{ signingIn: boolean; redirect?: URL }>
  signOut: () => Promise<void>
}

export function useAuth(): AuthContextType {
  const { signIn, signOut } = useAuthActions()
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const userQuery = useCurrentUser()

  const isLoading = authLoading || (isAuthenticated && userQuery === undefined)

  return {
    user: userQuery === undefined ? null : userQuery,
    isLoading,
    isAuthenticated,
    signIn,
    signOut,
  }
}
