import { unstable_cache } from 'next/cache'
import { fetchQuery } from 'convex/nextjs'
import { api } from '@/convex/_generated/api'
import type { TodayData, TodayResult } from './types'

/**
 * The longest the page waits for the backend before it renders without the
 * opening. The first response must come even when the backend is slow.
 */
const ANSWER_WITHIN_MS = 3000

/**
 * Seconds a server copy may be reused. The opening holds for a six-hour
 * window, so a minute only delays an unpublished article's removal by that
 * long, and spares the backend a round trip on most requests.
 */
const REUSE_SECONDS = 60

const cachedOpening = unstable_cache(
  async (at: number, exclude: string[]): Promise<TodayResult> =>
    fetchQuery(api.today.opening, { at, exclude }),
  ['today-opening-v1'],
  { revalidate: REUSE_SECONDS }
)

const MINUTE_MS = 60_000

/** Today's opening for this moment, skipping what the reader finished. */
export async function readToday(
  now: number,
  exclude: string[]
): Promise<TodayData> {
  // The minute, not the millisecond: requests in the same minute share one
  // answer. Inside a window the answer does not change with the minute.
  const at = Math.floor(now / MINUTE_MS) * MINUTE_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      cachedOpening(at, exclude),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ANSWER_WITHIN_MS)
      }),
    ])
    return result ? { status: 'ready', result } : { status: 'unreachable' }
  } catch (error) {
    console.error('Today opening fetch failed', error)
    return { status: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}
