import { POCKET } from '@/shell/navigation'

/**
 * Sign in, then back to the balance page: what `signInHref(POCKET.href)`
 * (shell/signIn.ts) returns, written out because that module brings the
 * sheet stack into the page's first load. A plain link, so it works with no
 * script (scripts/pocket/signed-out-landing.test.ts keeps the two equal).
 */
export const SIGN_IN_BACK = `${POCKET.signIn}?returnTo=${encodeURIComponent(POCKET.href)}`
