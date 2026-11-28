import { unstable_cache } from 'next/cache'
import { fetchQuery } from 'convex/nextjs'
import { api } from '@/convex/_generated/api'
import { withinReadLimit } from '@/shell/public/boundedRead'
import type { TodayData, TodayResult } from './types'

const MINUTE_MS = 60_000

/**
 * Seconds the answer for a reader with no skip list may be reused. The
 * opening changes once per UTC hour; this short reuse bounds how long an
 * unpublished article can stay on Today (60 s) and spares the backend a
 * round trip on most requests. The key stays the minute, not the hour:
 * the hour's own articles are read up to the moment rendered, so a newly
 * published article shows within a minute when the list has room (or opens
 * Today when nothing older exists), and joins the hour's order at the next
 * UTC hour. Only answers are stored: a failed read throws inside, and a
 * late one is cut off outside, so "unreachable" is never cached.
 */
const REUSE_SECONDS = 60

/** Keyed by the minute only: one entry per minute, whoever asks. */
const cachedOpening = unstable_cache(
  async (minute: number): Promise<TodayResult> =>
    fetchQuery(api.today.opening, { at: minute * MINUTE_MS }),
  ['today-opening-v2'],
  { revalidate: REUSE_SECONDS }
)

/**
 * Today's opening for this moment, within the public read limit (1.5 s).
 * Without a skip list the answer comes from the cache above; with one (a
 * returning reader, already validated by `skipList`) the read goes to the
 * backend directly, so no cookie value can create cache entries. Worst case
 * for the first byte of `/`: the limit (1.5 s) plus the render; the proxy's
 * route check does not run for `/`.
 */
export async function readToday(
  now: number,
  skip: readonly string[]
): Promise<TodayData> {
  const minute = Math.floor(now / MINUTE_MS)
  try {
    const result = await withinReadLimit(
      skip.length === 0
        ? cachedOpening(minute)
        : fetchQuery(api.today.opening, {
            at: minute * MINUTE_MS,
            exclude: [...skip],
          })
    )
    return { status: 'ready', result }
  } catch (error) {
    console.error('Today opening read failed', error)
    return { status: 'unreachable' }
  }
}
