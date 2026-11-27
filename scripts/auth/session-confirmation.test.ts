import { describe, expect, it } from 'vitest'

import { authGate, isTokenUnconfirmed } from '@/lib/auth/sessionConfirmation'

const signedOut = {
  convexLoading: false,
  convexAuthenticated: false,
  hasToken: false,
  confirmationTimedOut: false,
  userLoaded: true,
}

describe('auth gate for protected routes (issue #575)', () => {
  it('waits while the backend confirms a token that signIn just stored', () => {
    // useConvexAuth() keeps the signed-out answer until the backend replies.
    const justSignedIn = { ...signedOut, hasToken: true, userLoaded: false }
    expect(isTokenUnconfirmed(justSignedIn)).toBe(true)
    expect(authGate(justSignedIn)).toEqual({
      isLoading: true,
      isAuthenticated: false,
    })
  })

  it('is signed in once the backend confirms and the user loads', () => {
    const confirmed = {
      ...signedOut,
      hasToken: true,
      convexAuthenticated: true,
    }
    expect(authGate({ ...confirmed, userLoaded: false }).isLoading).toBe(true)
    expect(authGate(confirmed)).toEqual({
      isLoading: false,
      isAuthenticated: true,
    })
  })

  it('reports signed out when there is no token', () => {
    expect(isTokenUnconfirmed(signedOut)).toBe(false)
    expect(authGate(signedOut)).toEqual({
      isLoading: false,
      isAuthenticated: false,
    })
  })

  it('stops waiting when the unconfirmed token passes the bound', () => {
    expect(
      authGate({ ...signedOut, hasToken: true, confirmationTimedOut: true })
    ).toEqual({ isLoading: false, isAuthenticated: false })
  })

  it('keeps the first-load wait from convex/react', () => {
    expect(
      authGate({ ...signedOut, hasToken: true, convexLoading: true }).isLoading
    ).toBe(true)
    expect(
      isTokenUnconfirmed({ ...signedOut, hasToken: true, convexLoading: true })
    ).toBe(false)
  })
})
