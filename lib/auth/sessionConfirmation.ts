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
 * /login. While the browser holds a token that the backend has not confirmed,
 * the guards therefore wait.
 *
 * The client does not expose a backend rejection of the token, so the wait
 * has an upper bound. A rejected session normally ends sooner: Convex Auth
 * clears the token when its refresh fails.
 */
export const TOKEN_CONFIRMATION_TIMEOUT_MS = 15_000

export type AuthGateInput = {
  /** `useConvexAuth().isLoading` from `convex/react`. */
  convexLoading: boolean
  /** `useConvexAuth().isAuthenticated`: the backend confirmed the token. */
  convexAuthenticated: boolean
  /** `useAuthToken() !== null`: Convex Auth holds a token in this browser. */
  hasToken: boolean
  /** The unconfirmed token has waited longer than the bound. */
  confirmationTimedOut: boolean
  /** The current user query has answered. */
  userLoaded: boolean
}

/** A held token waits for the backend's answer, within the bound. */
export function isTokenUnconfirmed(
  input: Pick<
    AuthGateInput,
    'convexLoading' | 'convexAuthenticated' | 'hasToken'
  >
): boolean {
  return input.hasToken && !input.convexLoading && !input.convexAuthenticated
}

export function authGate(input: AuthGateInput): {
  isLoading: boolean
  isAuthenticated: boolean
} {
  const awaitingConfirmation =
    isTokenUnconfirmed(input) && !input.confirmationTimedOut
  return {
    isLoading:
      input.convexLoading ||
      awaitingConfirmation ||
      (input.convexAuthenticated && !input.userLoaded),
    isAuthenticated: input.convexAuthenticated,
  }
}
