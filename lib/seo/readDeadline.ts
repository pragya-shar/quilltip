import { PUBLIC_READ_TIMEOUT_MS } from '@/lib/seo/publicReadTimeout'

/**
 * The time by which a public page's server reads must end, passed from the
 * proxy to the page (#609). The proxy checks the route (with one retry)
 * before the page renders; the page's reads get only the time left, so the
 * whole first byte stays within about two read limits.
 *
 * The value is Unix epoch milliseconds in decimal digits only. The proxy
 * removes any copy a client sends, on every request, and stamps its own on
 * the full loads it checks. It is a timing hint only: never an authorisation
 * input and never a cache key.
 */
export const READ_DEADLINE_HEADER = 'x-quilltip-read-deadline'

/** The whole budget the proxy gives a request: its check and the page. */
export const REQUEST_READ_BUDGET_MS = 2 * PUBLIC_READ_TIMEOUT_MS

/**
 * The least time a page's read gets, even when the proxy's retry finished
 * late. A read that misses it shows the page's readable fallback; a reload
 * starts a fresh deadline.
 */
export const MIN_PAGE_READ_MS = 500

export function formatReadDeadline(epochMs: number): string {
  return String(Math.round(epochMs))
}

/**
 * The deadline in the header, or null when it is missing, not digits only,
 * or further away than a whole request budget (then the page uses the full
 * read limit, as without the proxy).
 */
export function parseReadDeadline(
  value: string | null,
  now = Date.now()
): number | null {
  if (!value || !/^\d{1,15}$/.test(value)) return null
  const deadline = Number(value)
  if (deadline > now + REQUEST_READ_BUDGET_MS) return null
  return deadline
}

/** How long one of the page's reads may take now. */
export function pageReadLimitMs(
  deadline: number | null,
  now = Date.now()
): number {
  if (deadline === null) return PUBLIC_READ_TIMEOUT_MS
  return Math.min(
    PUBLIC_READ_TIMEOUT_MS,
    Math.max(MIN_PAGE_READ_MS, deadline - now)
  )
}
