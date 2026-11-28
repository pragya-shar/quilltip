/**
 * Longest a public server read may take (#428). Public pages wait for their
 * reads before the first byte, so a slow or silent backend must not hold the
 * page: after this, the read counts as unreachable and the page shows a
 * fallback that reads without scripts. The proxy's route check uses the same
 * limit.
 *
 * Reads that run one after another add up, so the worst-case first byte is:
 * - `/articles`: 1.5 s (the list);
 * - a writer or article page: 3 s (the route check, then the page's reads,
 *   which run together);
 * - a missing writer or article: 4.5 s, when the moved-handle lookup also
 *   runs out of time.
 */
export const PUBLIC_READ_TIMEOUT_MS = 1500
