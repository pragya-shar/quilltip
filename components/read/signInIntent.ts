/**
 * What a signed-out reader was doing when they pressed Tip or Keep, so it
 * survives sign-in. With a sign-in sheet the shell carries it
 * (`openSignIn`). Without one, and with no script, the link goes to the
 * sign-in page with a same-site return path that includes the line's
 * anchor; with scripts the intent is also stored for this tab before
 * leaving, for the sign-in package to read once
 * (`sessionStorage['quilltip:sign-in-intent:v1']`).
 *
 * The amount is a ceiling, never an order: on return the money layer
 * checks it against the reader's own ladder and never raises it, and
 * signing in sends nothing.
 */
import type { Cents } from '@/hooks/read/payments'

export const SIGN_IN_INTENT_KEY = 'quilltip:sign-in-intent:v1'

export type ReadSignInIntent = {
  kind: 'tip' | 'keep'
  articleId: string
  /** Where to return: the article's path, with the line's `#s-{p}-{k}`. */
  href: string
  amount: Cents | null
  passage: { text: string; startOffset: number; endOffset: number } | null
  at: number
}

/** The article's path, with the line's anchor when it has one. */
export function returnPathFor(articleHref: string, anchor: string | null) {
  return anchor ? `${articleHref}#${anchor}` : articleHref
}

/** The sign-in page, returning to `returnTo` (a same-site path). */
export function signInHref(returnTo: string) {
  return `/login?next=${encodeURIComponent(returnTo)}`
}

/** Stores the intent for this tab. Storage may be blocked: then the
 * return path alone carries the reader back. */
export function rememberIntent(intent: ReadSignInIntent) {
  try {
    sessionStorage.setItem(SIGN_IN_INTENT_KEY, JSON.stringify(intent))
  } catch {
    // The link still returns to the article and its line.
  }
}
