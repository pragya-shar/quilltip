import { describe, expect, it } from 'vitest'
import { activityLists } from '@/components/pocket/activityModel'
import { rowWords, tipsCount } from '@/components/pocket/copy'
import type { ActivityItem, ActivityView } from '@/lib/pocket/types'

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
    article: { id: null, title: 'A', href: null },
    passage: null,
    amount: m(25),
    net: m(24.375),
    paid: m(0),
    paidNet: m(0),
    fee: m(0.625),
    unpaid: m(0),
    unpaidNet: m(0),
    status: 'sent',
    reason: null,
    at,
    lagging: false,
    txHash: null,
    exact: null,
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

describe('the Pocket activity: two labelled lists, never merged', () => {
  it('shows each list that has rows: Your tips, then Tips to you', () => {
    const lists = activityLists(
      view([tip('reader', 'r1', 30)]),
      view([tip('writer', 'w1', 20)])
    )
    expect(lists.status).toBe('ready')
    expect(lists.lists.map((l) => l.title)).toEqual([
      'Your tips',
      'Tips to you',
    ])
  })

  it('leaves out an empty list and keeps the server order', () => {
    const lists = activityLists(
      view([tip('reader', 'r2', 10), tip('reader', 'r1', 30)]),
      view([])
    )
    expect(lists.lists).toHaveLength(1)
    expect(lists.lists[0]!.view.items.map((i) => i.id)).toEqual(['r2', 'r1'])
  })

  it('is loading until both answer, empty with no rows, unavailable when neither can answer', () => {
    expect(
      activityLists(view([], { status: 'loading' }), view([])).status
    ).toBe('loading')
    expect(activityLists(view([]), view([])).status).toBe('empty')
    expect(
      activityLists(
        view([], { status: 'unavailable' }),
        view([], { status: 'unavailable' })
      ).status
    ).toBe('unavailable')
    const one = activityLists(
      view([tip('reader', 'r1', 1)]),
      view([], { status: 'unavailable' })
    )
    expect(one.lists.map((l) => l.view.status)).toEqual([
      'ready',
      'unavailable',
    ])
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
