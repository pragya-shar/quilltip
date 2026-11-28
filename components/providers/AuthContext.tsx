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
import { usePathname, useRouter } from 'next/navigation'
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import { useConvexAuth } from 'convex/react'
import { Value } from 'convex/values'
// The hook's own module, not the hooks/convex barrel: this provider is on
// every page, and the barrel brings its other hooks into every first load
// (about 1.7 KB gzip on `/` and `/login`).
import { useCurrentUser } from '@/hooks/convex/useUsers'
import {
  TOKEN_CONFIRMATION_TIMEOUT_MS,
  authGate,
  isTokenUnconfirmed,
  nextAnsweredToken,
  type ConvexAuthSnapshot,
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
  /**
   * The path a sign-out started on, until the URL leaves it (#608). Its
   * guard must not send the reader to /login with that path to return to.
   */
  signOutFrom: string | null
  /** A held token waits for the backend's first answer, within the bound. */
  awaitingConfirmation: boolean
  beginSignOut: (from: string) => void
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null)

/**
 * True while Convex Auth holds a token that the backend has not answered in
 * this page, for at most TOKEN_CONFIRMATION_TIMEOUT_MS. One state for the
 * app, so every guard uses the same answer and deadline
 * (lib/auth/sessionConfirmation.ts).
 */
function useAwaitingConfirmation(): boolean {
  const token = useAuthToken()
  const { isLoading, isAuthenticated } = useConvexAuth()
  const [seen, setSeen] = useState<{
    previous: ConvexAuthSnapshot
    answered: string | null
  }>({ previous: { isLoading, isAuthenticated }, answered: null })
  let answered = seen.answered
  if (
    seen.previous.isLoading !== isLoading ||
    seen.previous.isAuthenticated !== isAuthenticated
  ) {
    // Recorded during render, so no guard reads a stale answer first.
    answered = nextAnsweredToken({
      previous: seen.previous,
      current: { isLoading, isAuthenticated },
      token,
      answered,
    })
    setSeen({ previous: { isLoading, isAuthenticated }, answered })
  }
  const unconfirmed = isTokenUnconfirmed({
    convexLoading: isLoading,
    convexAuthenticated: isAuthenticated,
    token,
    answeredToken: answered,
  })

  // The bound belongs to one token: a new sign-in after a timed-out token
  // gets its own wait.
  const [timedOutToken, setTimedOutToken] = useState<string | null>(null)
  useEffect(() => {
    if (!unconfirmed || token === null) return
    const timeout = setTimeout(
      () => setTimedOutToken(token),
      TOKEN_CONFIRMATION_TIMEOUT_MS
    )
    return () => clearTimeout(timeout)
  }, [unconfirmed, token])

  return unconfirmed && timedOutToken !== token
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [signOutFrom, setSignOutFrom] = useState<string | null>(null)
  // The sign-out's navigation has left the page: the guard may act again.
  if (signOutFrom !== null && pathname !== signOutFrom) setSignOutFrom(null)
  const awaitingConfirmation = useAwaitingConfirmation()

  const value = useMemo(
    () => ({
      signOutFrom,
      awaitingConfirmation,
      beginSignOut: (from: string) => setSignOutFrom(from),
    }),
    [signOutFrom, awaitingConfirmation]
  )

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
      {signOutFrom !== null ? (
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

/** The path a sign-out started on, while the URL is still there (#608). */
export function useSignOutFrom(): string | null {
  return useAuthSession().signOutFrom
}

export function useAuth(): AuthContextType {
  const router = useRouter()
  const { beginSignOut, awaitingConfirmation } = useAuthSession()
  const { signIn, signOut: convexSignOut } = useAuthActions()
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const userQuery = useCurrentUser()

  // Waits while the backend confirms a new sign-in (issue #575).
  const { isLoading } = authGate({
    convexLoading: authLoading,
    convexAuthenticated: isAuthenticated,
    awaitingConfirmation,
    userLoaded: userQuery !== undefined,
  })

  const signOut = useCallback(async () => {
    // Held until the URL leaves this page, not until the sign-out call
    // returns: the navigation can finish after the session ends (#608).
    const from = window.location.pathname
    if (from !== '/login') beginSignOut(from)
    router.replace('/login')
    await convexSignOut()
  }, [beginSignOut, convexSignOut, router])

  return {
    user: userQuery === undefined ? null : userQuery,
    isLoading,
    isAuthenticated,
    signIn,
    signOut,
  }
}
