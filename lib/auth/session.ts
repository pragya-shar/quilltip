/**
 * Right after a sign-in succeeds, the new token may not have been answered
 * by the backend yet: auth reads "not loading, not authenticated" for a
 * moment. That moment is "confirming", never "signed out", for up to
 * CONFIRM_MS. A failed or abandoned sign-in ends it.
 */
export const CONFIRM_MS = 15_000

let signedInAt: number | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export const signInSession = {
  /** A sign-in just succeeded: hold "confirming" until auth agrees. */
  markSignedIn(now = Date.now()) {
    signedInAt = now
    emit()
  },
  /** Auth answered, or the sign-in is abandoned. */
  settle() {
    if (signedInAt === null) return
    signedInAt = null
    emit()
  },
  confirmingSince: () => signedInAt,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

export type AuthPhase = 'loading' | 'confirming' | 'signed-in' | 'signed-out'

/** The phase from auth's two flags and a pending sign-in, at `now`. */
export function authPhase(
  auth: { isLoading: boolean; isAuthenticated: boolean },
  confirmingSince: number | null,
  now = Date.now()
): AuthPhase {
  if (auth.isAuthenticated) return 'signed-in'
  if (auth.isLoading) return 'loading'
  if (confirmingSince !== null && now - confirmingSince < CONFIRM_MS)
    return 'confirming'
  return 'signed-out'
}
