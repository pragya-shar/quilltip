/**
 * Sign-out, wherever it happens. Three rules:
 *
 * 1. While signed in, the shell keeps a marker in storage that says only
 *    "signed in here" (no ID, no name). A shell page that finds the marker
 *    and no session token knows the person signed out somewhere the shell
 *    did not see (a legacy page, another tab, a page change mid sign-out):
 *    it runs the cleanups and removes the marker.
 * 2. With no session token held, no wallet record stays in storage: every
 *    reader's remembered wallet and the wallet kit's keys are removed on
 *    each shell load and each change to signed out. A record a wallet's
 *    teardown writes after sign-out is gone at the next one, in any order.
 * 3. While a sign-out runs, `isSigningOut()` is true, and a guard that
 *    sends a signed-out reader to sign in writes no return path
 *    (`signInHref` in shell/signIn.ts): the reader asked to leave, not to
 *    come back.
 */
import { forgetAllRememberedWallets } from '@/lib/wallet/remembered-wallet'
import { hasAuthToken } from '../prePaint'
import {
  SIGN_OUT_BEFORE,
  SIGN_OUT_CLEANUPS,
  runBeforeSignOut,
  runSignOutCleanups,
} from './index'
import type { SignOutAfter, SignOutWho } from './types'

import {
  SIGNED_IN_MARKER,
  marked,
  safely,
  setSigningOut,
  type MarkerStorage,
} from './state'

export { SIGNED_IN_MARKER, isSigningOut, markSignedIn } from './state'

/** The packages' cleanups, told what did not finish before sign-out. */
const cleanUp = (after: SignOutAfter) =>
  runSignOutCleanups(SIGN_OUT_CLEANUPS, after)

/**
 * What a shell load or a change to signed out does: with no token held,
 * remove every wallet record; if the marker says this browser was signed
 * in, run the cleanups (given `after`: on a later page, nothing is known
 * to be unfinished) and then remove the marker. Returns whether the
 * cleanups ran.
 */
export async function settleSignedOut(
  storage: MarkerStorage | null,
  run: (after: SignOutAfter) => Promise<unknown> = cleanUp,
  after: SignOutAfter = { unfinished: [] }
): Promise<boolean> {
  if (!storage || hasAuthToken(storage)) return false
  forgetAllRememberedWallets(storage)
  if (!marked(storage)) return false
  await run(after)
  // A cleanup or a wallet's teardown may have written again meanwhile.
  forgetAllRememberedWallets(storage)
  safely(() => storage.removeItem(SIGNED_IN_MARKER))
  return true
}

/**
 * Signs out from a shell page: `signOut` is Convex Auth's
 * (`useAuthActions().signOut`), and `who` is the person signing out, which
 * every caller passes (`userId` may be null: the actions then do nothing).
 * While a session token is still held, the packages' actions before
 * sign-out run first (`before`, bounded: never longer than its limit), and
 * the names of those that did not finish go to the cleanups. Wallet
 * records go first and again at the end, and on `pagehide` if the page
 * changes in between; the cleanups run once the token is gone. A page
 * change before the end leaves the marker, so the next shell page finishes
 * the work.
 */
export async function signOutHere(
  signOut: () => Promise<void>,
  storage: MarkerStorage | null,
  who: SignOutWho,
  run: (after: SignOutAfter) => Promise<unknown> = cleanUp,
  before:
    | ((who: SignOutWho) => Promise<readonly string[]>)
    | null = SIGN_OUT_BEFORE.length > 0
    ? (person) => runBeforeSignOut(SIGN_OUT_BEFORE, person)
    : null
): Promise<void> {
  setSigningOut(true)
  const forget = () => forgetAllRememberedWallets(storage)
  const target = typeof window === 'undefined' ? null : window
  target?.addEventListener('pagehide', forget)
  forget()
  try {
    // With the session still held: the server can act on this browser's
    // behalf. Bounded and best effort; never with an expired session.
    // With none registered, sign-out starts in the same task, as before.
    let unfinished: readonly string[] = []
    if (before && storage && hasAuthToken(storage))
      unfinished = await before(who).catch(() => [])
    await signOut()
    await settleSignedOut(storage, run, { unfinished })
  } finally {
    forget()
    target?.removeEventListener('pagehide', forget)
    setSigningOut(false)
  }
}
