import { api } from '@/convex/_generated/api'
import { publicQuery } from '@/lib/seo/publicQuery'

/**
 * The state of the public article list, read by the proxy before `/articles`
 * renders (#609). Today it is only the outage signal: one indexed lookup
 * that answers when the backend can serve reads. It uses an existing public
 * query on purpose: a frontend deployed ahead of its backend (a preview
 * before the backend push, a cutover between its steps, a backend rollback)
 * must not call a function that does not exist yet and read that as an
 * outage. The list change counter of
 * #628 will add `version` here, so one read is both the outage signal and the
 * key of the list's cache, with no change to the proxy.
 */
export type ReadingListState = { version?: string }

/**
 * A handle no writer can have: handleFormatError rejects it, because "@" and
 * "-" are outside the handle pattern (lib/profile/handleRules.ts), and
 * publicContentPath never treats it as a writer. Pinned by
 * scripts/perf/reading-list-state.test.ts.
 */
export const NO_SUCH_HANDLE = '@reading-list-state'

// #628 swaps this query for its list change counter, after its backend
// change is deployed first.
export async function readingListState(
  limitMs: number
): Promise<ReadingListState> {
  await publicQuery(limitMs, api.publicRoutes.publicRouteExists, {
    username: NO_SUCH_HANDLE,
  })
  return {}
}
