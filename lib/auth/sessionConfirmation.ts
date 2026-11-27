/**
 * Auth state for the protected-route guards (issue #575).
 *
 * Convex Auth's `signIn` resolves before the backend confirms the new token.
 * Its docs say so: "there's a delay between the `signIn` function returning
 * and the client performing the handshake with the server to confirm the
 * sign-in". In that window `useConvexAuth()` from `convex/react` keeps the
 * signed-out answer, `{ isLoading: false, isAuthenticated: false }`, until the
 * backend replies; it reports loading only for the first token of a page load.
 * A guard that reads that answer sends a reader who just signed in back to
 * /login. While the browser holds a token that the backend has not answered
 * yet, the guards therefore wait.
 *
 * "Answered" means `useConvexAuth()` changed to signed out while that token
 * was held: the backend rejected it (for example a stored token with no
 * refresh token, which Convex Auth keeps). Such a token is not waited for.
 * A new sign-in stores a new token without that change, so it is waited for.
 *
 * If the backend rejects a new sign-in's token, `useConvexAuth()` does not
 * change (it already said signed out), so the wait has an upper bound.
 */
export const TOKEN_CONFIRMATION_TIMEOUT_MS = 15_000

/** `useConvexAuth()` from `convex/react`. */
export type ConvexAuthSnapshot = {
  isLoading: boolean
  isAuthenticated: boolean
}

/**
 * The held token the backend answered "signed out" for, after a render.
 * It becomes the current token when `useConvexAuth()` changes to signed out,
 * and stays as it was otherwise.
 */
export function nextAnsweredToken(input: {
  previous: ConvexAuthSnapshot
  current: ConvexAuthSnapshot
  token: string | null
  answered: string | null
}): string | null {
  const { previous, current } = input
  const changed =
    previous.isLoading !== current.isLoading ||
    previous.isAuthenticated !== current.isAuthenticated
  if (changed && !current.isLoading && !current.isAuthenticated) {
    return input.token
  }
  return input.answered
}

/** A held token waits for the backend's first answer in this page. */
export function isTokenUnconfirmed(input: {
  convexLoading: boolean
  convexAuthenticated: boolean
  /** `useAuthToken()` from `@convex-dev/auth/react`. */
  token: string | null
  /** From `nextAnsweredToken`. */
  answeredToken: string | null
}): boolean {
  return (
    input.token !== null &&
    input.token !== input.answeredToken &&
    !input.convexLoading &&
    !input.convexAuthenticated
  )
}

export function authGate(input: {
  convexLoading: boolean
  convexAuthenticated: boolean
  /** An unconfirmed token, within TOKEN_CONFIRMATION_TIMEOUT_MS. */
  awaitingConfirmation: boolean
  /** The current user query has answered. */
  userLoaded: boolean
}): { isLoading: boolean; isAuthenticated: boolean } {
  return {
    isLoading:
      input.convexLoading ||
      input.awaitingConfirmation ||
      (input.convexAuthenticated && !input.userLoaded),
    isAuthenticated: input.convexAuthenticated,
  }
}
