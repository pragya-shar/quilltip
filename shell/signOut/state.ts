/**
 * The small part of sign-out that a first load needs: the "signed in here"
 * marker and whether a sign-out is under way. The work itself (cleanups,
 * wallet records) is shell/signOut/session.ts, loaded when it runs.
 */
import { hasAuthToken } from '../prePaint'

/** The marker's key. Its value is "1": nothing about the person. */
export const SIGNED_IN_MARKER = 'quilltip:shell:signed-in'

export type MarkerStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>

let signingOut = false

/** Set by `signOutHere` while it runs. */
export function setSigningOut(value: boolean) {
  signingOut = value
}

export function safely(run: () => void) {
  try {
    run()
  } catch {
    // Blocked or read-only storage: nothing more can be done from here.
  }
}

/** Signed in (the server said so): remember that this browser was. */
export function markSignedIn(storage: MarkerStorage | null) {
  if (storage) safely(() => storage.setItem(SIGNED_IN_MARKER, '1'))
}

export function marked(storage: MarkerStorage): boolean {
  try {
    return storage.getItem(SIGNED_IN_MARKER) !== null
  } catch {
    return false
  }
}

/** Whether a sign-out is under way here, or was left unfinished. */
export function isSigningOut(storage: MarkerStorage | null = null): boolean {
  if (signingOut) return true
  return storage ? marked(storage) && !hasAuthToken(storage) : false
}
