import { getSafeReturnPath } from '@/lib/auth/safeReturnPath'
import { sameSitePath } from '@/lib/auth/returnPath'

/** The reset page's address, carrying the way back (`returnTo`) when there
 * is one other than Today. */
export function resetHref(returnTo?: string): string {
  const back = returnTo ? sameSitePath(getSafeReturnPath(returnTo)) : '/'
  return back === '/'
    ? '/signin/reset'
    : `/signin/reset?returnTo=${encodeURIComponent(back)}`
}
