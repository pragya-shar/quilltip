import { getSafeReturnPath } from '@/lib/auth/safeReturnPath'
import { WELCOME_PATH } from '@/lib/navigation/siteNavigation'

export const DEFAULT_WELCOME_DESTINATION = '/write'

/** Where setup sends the writer: the page they came for, or the writing desk. */
export function welcomeDestination(next: string | null | undefined): string {
  const safe = getSafeReturnPath(next, '')
  return safe && safe !== '/' && !safe.startsWith(WELCOME_PATH)
    ? safe
    : DEFAULT_WELCOME_DESTINATION
}

/** The setup page, keeping the page a new writer was heading to. */
export function buildWelcomeHref(next: string | null | undefined): string {
  const safe = getSafeReturnPath(next, '')
  if (!safe || safe === '/' || safe.startsWith(WELCOME_PATH)) {
    return WELCOME_PATH
  }
  return `${WELCOME_PATH}?next=${encodeURIComponent(safe)}`
}
