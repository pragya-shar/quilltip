import { api } from '@/convex/_generated/api'
import { publicQuery } from '@/lib/seo/publicQuery'

/**
 * The state of the public article list, read by the proxy before `/articles`
 * renders (#609). Today it is only the outage signal: one indexed lookup
 * that answers when the backend can serve reads. The list change counter of
 * #628 will add `version` here, so one read is both the outage signal and the
 * key of the list's cache, with no change to the proxy.
 */
export type ReadingListState = { version?: string }

/** No handle can start with "@" (lib/profile/handleRules.ts). */
const NO_SUCH_HANDLE = '@reading-list-state'

export async function readingListState(
  limitMs: number
): Promise<ReadingListState> {
  await publicQuery(limitMs, api.publicRoutes.publicRouteExists, {
    username: NO_SUCH_HANDLE,
  })
  return {}
}
