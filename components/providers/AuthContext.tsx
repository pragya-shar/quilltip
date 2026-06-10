'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
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

type AuthSessionContextValue = {
  isSigningOut: boolean
  beginSignOut: () => void
  endSignOut: () => void
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null)

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [isSigningOut, setIsSigningOut] = useState(false)

  const value = useMemo(
    () => ({
      isSigningOut,
      beginSignOut: () => setIsSigningOut(true),
      endSignOut: () => setIsSigningOut(false),
    }),
    [isSigningOut]
  )

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
      {isSigningOut ? (
        <div
          className="fixed inset-0 z-[100] bg-background"
          role="status"
          aria-live="polite"
          aria-label="Signing out"
        />
      ) : null}
    </AuthSessionContext.Provider>
  )
}

function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthSessionProvider')
  }
  return context
}

export function useAuth(): AuthContextType {
  const router = useRouter()
  const { beginSignOut, endSignOut } = useAuthSession()
  const { signIn, signOut: convexSignOut } = useAuthActions()
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const userQuery = useCurrentUser()

  const isLoading = authLoading || (isAuthenticated && userQuery === undefined)

  const signOut = useCallback(async () => {
    beginSignOut()
    try {
      router.replace('/login')
      await convexSignOut()
    } finally {
      endSignOut()
    }
  }, [beginSignOut, convexSignOut, endSignOut, router])

  return {
    user: userQuery === undefined ? null : userQuery,
    isLoading,
    isAuthenticated,
    signIn,
    signOut,
  }
}
