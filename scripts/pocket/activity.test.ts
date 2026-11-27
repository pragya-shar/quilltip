import { describe, expect, it, vi } from 'vitest'
import { mergeActivity } from '@/components/pocket/activityModel'
import { rowWords, tipsCount } from '@/components/pocket/copy'
import type { ActivityItem, ActivityView } from '@/components/pocket/types'

const m = (cents: number) => ({
  cents,
  display: `$${(cents / 100).toFixed(2)}`,
})

function tip(
  role: 'reader' | 'writer',
  id: string,
  at: number,
  over: Partial<ActivityItem> = {}
): ActivityItem {
  return {
    id,
    requestId: id,
    role,
    counterparty: {
      name: role === 'reader' ? 'Theo Marsh' : 'A reader',
      username: null,
    },
    article: { title: 'A', href: null },
    passage: null,
    amount: m(25),
    net: m(24.375),
    paid: m(0),
    paidNet: m(0),
    status: 'sent',
    reason: null,
    at,
    lagging: false,
    txHash: null,
    ...over,
  }
}

const view = (
  items: ActivityItem[],
  over: Partial<ActivityView> = {}
): ActivityView => ({
  status: 'ready',
  items,
  canLoadMore: false,
  loadMore: () => {},
  ...over,
})

describe('the Pocket activity: two server-paged lists as one', () => {
  it('orders both lists newest first, each row once', () => {
    const merged = mergeActivity(
      view([tip('reader', 'r1', 30), tip('reader', 'r2', 10)]),
      view([tip('writer', 'w1', 20), tip('writer', 'w1', 20)])
    )
    expect(merged.status).toBe('ready')
    expect(merged.entries.map((e) => e.key)).toEqual([
      'reader:r1',
      'writer:w1',
      'reader:r2',
    ])
  })

  it('holds back rows a list with more pages could still precede', () => {
    // The reader list has more pages below its oldest loaded row (at 50):
    // a writer row at 10 may not be shown before them.
    const loadMore = vi.fn()
    const merged = mergeActivity(
      view([tip('reader', 'r1', 60), tip('reader', 'r2', 50)], {
        canLoadMore: true,
        loadMore,
      }),
      view([tip('writer', 'w1', 55), tip('writer', 'w2', 10)])
    )
    expect(merged.entries.map((e) => e.key)).toEqual([
      'reader:r1',
      'writer:w1',
      'reader:r2',
    ])
    expect(merged.canLoadMore).toBe(true)
    merged.loadMore()
    expect(loadMore).toHaveBeenCalledOnce()
  })

  it('is loading until both lists answer, and partial when one cannot', () => {
    expect(
      mergeActivity(view([], { status: 'loading' }), view([])).status
    ).toBe('loading')
    const partial = mergeActivity(
      view([tip('reader', 'r1', 1)]),
      view([], { status: 'unavailable' })
    )
    expect(partial.status).toBe('partial')
    expect(partial.entries).toHaveLength(1)
    expect(
      mergeActivity(
        view([], { status: 'unavailable' }),
        view([], { status: 'unavailable' })
      ).status
    ).toBe('unavailable')
  })
})

describe('the words for a tip', () => {
  it('never says "not charged" for a tip paid in part', () => {
    for (const reason of ['shortfall', 'expired', 'rejected', 'reset'] as const)
      for (const role of ['reader', 'writer'] as const) {
        const words = rowWords(
          tip(role, 'x', 1, {
            status: 'not-paid',
            reason,
            paid: m(10),
            paidNet: m(9.75),
          })
        )
        expect(`${words.short} ${words.long}`).not.toMatch(/not charged/)
        expect(words.status).not.toBe('failed')
      }
  })

  it('says "not charged" only when nothing of the tip was paid', () => {
    const words = rowWords(
      tip('reader', 'x', 1, { status: 'not-paid', reason: 'expired' })
    )
    expect(words.status).toBe('failed')
    expect(words.short).toBe('Did not complete. You were not charged.')
    const held = rowWords(
      tip('reader', 'x', 1, { status: 'not-paid', reason: 'shortfall' })
    )
    expect(held.status).toBe('pending')
    expect(held.short).not.toMatch(/not charged/)
  })

  it('says On its way, and slower than usual when it lags', () => {
    expect(rowWords(tip('writer', 'x', 1)).short).toBe('On its way')
    expect(rowWords(tip('writer', 'x', 1, { lagging: true })).short).toBe(
      'On its way, slower than usual'
    )
  })

  it('counts tips as tips', () => {
    expect(tipsCount(1)).toBe('1 tip')
    expect(tipsCount(1320)).toBe('1,320 tips')
  })
})
