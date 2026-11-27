'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import { useConvexAuth } from 'convex/react'
import { Value } from 'convex/values'
import { useCurrentUser } from '@/hooks/convex'
import {
  TOKEN_CONFIRMATION_TIMEOUT_MS,
  authGate,
  isTokenUnconfirmed,
} from '@/lib/auth/sessionConfirmation'
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
  /** A held token waited longer than the bound for the backend's answer. */
  confirmationTimedOut: boolean
  beginSignOut: () => void
  endSignOut: () => void
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null)

/**
 * True once a token that the backend has not confirmed has waited
 * TOKEN_CONFIRMATION_TIMEOUT_MS. One timer for the app, so every guard uses
 * the same deadline (lib/auth/sessionConfirmation.ts).
 */
function useConfirmationTimedOut(): boolean {
  const token = useAuthToken()
  const { isLoading, isAuthenticated } = useConvexAuth()
  const unconfirmed = isTokenUnconfirmed({
    hasToken: token !== null,
    convexLoading: isLoading,
    convexAuthenticated: isAuthenticated,
  })
  const [timedOut, setTimedOut] = useState(false)
  if (!unconfirmed && timedOut) setTimedOut(false)

  useEffect(() => {
    if (!unconfirmed) return
    const timeout = setTimeout(
      () => setTimedOut(true),
      TOKEN_CONFIRMATION_TIMEOUT_MS
    )
    return () => clearTimeout(timeout)
  }, [unconfirmed])

  return unconfirmed && timedOut
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [isSigningOut, setIsSigningOut] = useState(false)
  const confirmationTimedOut = useConfirmationTimedOut()

  const value = useMemo(
    () => ({
      isSigningOut,
      confirmationTimedOut,
      beginSignOut: () => setIsSigningOut(true),
      endSignOut: () => setIsSigningOut(false),
    }),
    [isSigningOut, confirmationTimedOut]
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
  const { beginSignOut, endSignOut, confirmationTimedOut } = useAuthSession()
  const { signIn, signOut: convexSignOut } = useAuthActions()
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const hasToken = useAuthToken() !== null
  const userQuery = useCurrentUser()

  // Waits while the backend confirms a new sign-in (issue #575).
  const { isLoading } = authGate({
    convexLoading: authLoading,
    convexAuthenticated: isAuthenticated,
    hasToken,
    confirmationTimedOut,
    userLoaded: userQuery !== undefined,
  })

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
