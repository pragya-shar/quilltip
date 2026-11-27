import { describe, expect, it } from 'vitest'

import {
  authGate,
  isTokenUnconfirmed,
  nextAnsweredToken,
} from '@/lib/auth/sessionConfirmation'

const loading = { isLoading: true, isAuthenticated: false }
const signedOut = { isLoading: false, isAuthenticated: false }
const signedIn = { isLoading: false, isAuthenticated: true }

const unconfirmed = (
  convex: typeof signedOut,
  token: string | null,
  answeredToken: string | null
) =>
  isTokenUnconfirmed({
    convexLoading: convex.isLoading,
    convexAuthenticated: convex.isAuthenticated,
    token,
    answeredToken,
  })

describe('auth gate for protected routes (issue #575)', () => {
  it('waits for a token that signIn just stored', () => {
    // useConvexAuth() keeps the signed-out answer until the backend replies.
    const answered = nextAnsweredToken({
      previous: signedOut,
      current: signedOut,
      token: 'new',
      answered: null,
    })
    expect(answered).toBeNull()
    expect(unconfirmed(signedOut, 'new', answered)).toBe(true)
    expect(
      authGate({
        convexLoading: false,
        convexAuthenticated: false,
        awaitingConfirmation: true,
        userLoaded: false,
      })
    ).toEqual({ isLoading: true, isAuthenticated: false })
  })

  it('does not wait for a token the backend rejected in this page', () => {
    // A stored token with no refresh token: Convex Auth keeps it.
    const answered = nextAnsweredToken({
      previous: loading,
      current: signedOut,
      token: 'rejected',
      answered: null,
    })
    expect(answered).toBe('rejected')
    expect(unconfirmed(signedOut, 'rejected', answered)).toBe(false)
  })

  it('does not wait for a token rejected after it was confirmed', () => {
    const answered = nextAnsweredToken({
      previous: signedIn,
      current: signedOut,
      token: 'expired',
      answered: null,
    })
    expect(unconfirmed(signedOut, 'expired', answered)).toBe(false)
  })

  it('waits for a new sign-in after a rejected token', () => {
    expect(unconfirmed(signedOut, 'new', 'rejected')).toBe(true)
  })

  it('keeps the recorded answer while useConvexAuth() does not change', () => {
    expect(
      nextAnsweredToken({
        previous: signedOut,
        current: signedOut,
        token: 'new',
        answered: 'rejected',
      })
    ).toBe('rejected')
    expect(
      nextAnsweredToken({
        previous: signedOut,
        current: signedIn,
        token: 'new',
        answered: 'rejected',
      })
    ).toBe('rejected')
  })

  it('reports signed out when there is no token', () => {
    expect(unconfirmed(signedOut, null, null)).toBe(false)
    expect(
      authGate({
        convexLoading: false,
        convexAuthenticated: false,
        awaitingConfirmation: false,
        userLoaded: true,
      })
    ).toEqual({ isLoading: false, isAuthenticated: false })
  })

  it('is signed in once the backend confirms and the user loads', () => {
    expect(unconfirmed(signedIn, 'new', null)).toBe(false)
    const gate = (userLoaded: boolean) =>
      authGate({
        convexLoading: false,
        convexAuthenticated: true,
        awaitingConfirmation: false,
        userLoaded,
      })
    expect(gate(false).isLoading).toBe(true)
    expect(gate(true)).toEqual({ isLoading: false, isAuthenticated: true })
  })

  it('keeps the first-load wait from convex/react', () => {
    expect(unconfirmed(loading, 'stored', null)).toBe(false)
    expect(
      authGate({
        convexLoading: true,
        convexAuthenticated: false,
        awaitingConfirmation: false,
        userLoaded: false,
      }).isLoading
    ).toBe(true)
  })
})
