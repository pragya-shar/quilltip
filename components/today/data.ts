import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { fetchQuery } from 'convex/nextjs'
import { api } from '@/convex/_generated/api'
import { withinLimit } from './readLimit'
import type { TodayData, TodayResult } from './types'

/**
 * Seconds a server copy may be reused. The opening holds for a UTC day
 * (D22); this short reuse bounds how long an unpublished article can stay
 * on Today (60 s) and spares the backend a round trip on most requests. A
 * newly published article joins the candidates the next UTC day. Only
 * answers are stored: a failed read throws inside, and a late one is cut
 * off outside, so "unreachable" is never cached.
 */
const REUSE_SECONDS = 60

const cachedOpening = unstable_cache(
  async (at: number, exclude: string[]): Promise<TodayResult> =>
    fetchQuery(api.today.opening, { at, exclude }),
  ['today-opening-v1'],
  { revalidate: REUSE_SECONDS }
)

const MINUTE_MS = 60_000

/**
 * Today's opening for this moment, skipping what the reader finished, within
 * the public read limit (D21). Worst case for the first byte of `/`: the
 * limit (1.5 s) plus the render; the proxy's route check does not run for
 * `/`. One read per request: the page and its metadata share it.
 */
export const readToday = cache(
  async (minute: number, excludeKey: string): Promise<TodayData> => {
    const exclude = excludeKey ? excludeKey.split('.') : []
    try {
      const result = await withinLimit(
        cachedOpening(minute * MINUTE_MS, exclude)
      )
      return { status: 'ready', result }
    } catch (error) {
      console.error('Today opening read failed', error)
      return { status: 'unreachable' }
    }
  }
)

/** The arguments `readToday` caches on: the minute and the skip list. */
export function todayReadKey(now: number, exclude: readonly string[]) {
  return [Math.floor(now / MINUTE_MS), exclude.join('.')] as const
}
