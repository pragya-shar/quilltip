import { describe, expect, it } from 'vitest'
import { PUBLIC_READ_TIMEOUT_MS } from '../../lib/seo/publicReadTimeout'
import {
  MIN_PAGE_READ_MS,
  REQUEST_READ_BUDGET_MS,
  formatReadDeadline,
  pageReadLimitMs,
  parseReadDeadline,
} from '../../lib/seo/readDeadline'

/** The request read deadline from the proxy to the page (#609). */
describe('the read deadline header', () => {
  const now = 1_790_000_000_000

  it('round-trips the proxy’s value', () => {
    const deadline = now + REQUEST_READ_BUDGET_MS
    expect(parseReadDeadline(formatReadDeadline(deadline), now)).toBe(deadline)
  })

  it.each([
    ['missing', null],
    ['empty', ''],
    ['not digits', '17900000abc'],
    ['negative', '-1'],
    ['decimal', '1790000000000.5'],
    [
      'further than one request budget',
      String(now + REQUEST_READ_BUDGET_MS + 1),
    ],
  ])('ignores a value that is %s', (_, value) => {
    expect(parseReadDeadline(value, now)).toBeNull()
  })

  it('gives the page what is left, at most one read limit', () => {
    expect(pageReadLimitMs(null, now)).toBe(PUBLIC_READ_TIMEOUT_MS)
    expect(pageReadLimitMs(now + REQUEST_READ_BUDGET_MS, now)).toBe(
      PUBLIC_READ_TIMEOUT_MS
    )
    expect(pageReadLimitMs(now + 900, now)).toBe(900)
  })

  it('still gives the page 500 ms when the proxy’s retry finished late', () => {
    // The retry answered after 2.9 s of the 3 s budget, or after it.
    expect(pageReadLimitMs(now + 100, now)).toBe(MIN_PAGE_READ_MS)
    expect(pageReadLimitMs(now - 1000, now)).toBe(MIN_PAGE_READ_MS)
    expect(MIN_PAGE_READ_MS).toBe(500)
  })
})
