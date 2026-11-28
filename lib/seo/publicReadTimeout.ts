/**
 * Longest a public server read may take (#428). Public pages wait for their
 * reads before the first byte, so a slow or silent backend must not hold the
 * page: after this, the read counts as unreachable and the page shows a
 * fallback that reads without scripts. The proxy's route check uses the same
 * limit.
 *
 * Since #609 the proxy checks `/articles`, writer and article pages first
 * (each attempt within this limit, retried once) and stamps a request
 * deadline of two limits; the page's reads get what is left, at least
 * 500 ms (lib/seo/readDeadline.ts). So the worst-case first byte is:
 * - an outage (the check failed twice): 3 s, the 503 outage response, or at
 *   once while the outage is remembered;
 * - a page whose check succeeded: within the 3 s budget, or 3.5 s when the
 *   retry answered at the very end and the page's reads use their 500 ms;
 * - a missing page whose moved-handle lookup also runs out: the same, then
 *   the readable fallback, never a 404.
 */
export const PUBLIC_READ_TIMEOUT_MS = 1500
