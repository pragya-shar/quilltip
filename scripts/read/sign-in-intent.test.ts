// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  INTENT_KEY,
  INTENT_TTL_MS,
  amountWithin,
  keepIntent,
  parseIntent,
  saveIntent,
  takeIntent,
  tipIntent,
} from '@/components/read/signInIntent'

// The read view's mirror of the sign-in package's intent contract
// (lib/auth/intent.ts at 4d7c97ed): its builders, its store and its take,
// for one page whatever the query.

const ARTICLE = 'k57rdfxtrartc1e0000000000000000001'
const TIP = tipIntent({
  path: '/tomas/ledger',
  articleId: ARTICLE,
  passage: { text: 'A line.', startOffset: 10, endOffset: 17 },
  amount: { cents: 100, display: '$1.00', short: '$1' },
  writer: 'Tomás Reyes',
})!

beforeEach(() => sessionStorage.clear())

describe('the sign-in intent contract', () => {
  it('builds a valid intent, and null for anything wrong', () => {
    expect(TIP).toMatchObject({ kind: 'tip', path: '/tomas/ledger' })
    for (const bad of [
      { path: '//evil.example/x' },
      { path: '/\\evil.example' },
      { articleId: 'a b' },
      { amount: { cents: 0, display: '$0' } },
      { amount: { cents: 50_01, display: '$50.01' } },
      { amount: { cents: 100, display: '$1', short: '' } },
      { passage: { text: 'x', startOffset: 5, endOffset: 5 } },
      { writer: '' },
    ])
      expect(
        tipIntent({ ...TIP, ...bad } as never),
        JSON.stringify(bad)
      ).toBeNull()
    expect(
      keepIntent({
        path: '/a',
        articleId: 'a1',
        passage: { text: 'x', startOffset: 0, endOffset: 1 },
      })
    ).not.toBeNull()
    expect(parseIntent({ ...TIP, kind: 'other' })).toBeNull()
  })

  it('stores the package form and is taken once, for its kind and page', () => {
    expect(saveIntent(TIP, 1_000)).toBe(true)
    expect(JSON.parse(sessionStorage.getItem(INTENT_KEY)!)).toEqual({
      v: 1,
      savedAt: 1_000,
      intent: TIP,
    })
    expect(takeIntent('keep', '/tomas/ledger', 2_000)).toBeNull()
    expect(takeIntent('tip', '/tomas/other', 2_000)).toBeNull()
    // The page, whatever the query.
    expect(takeIntent('tip', '/tomas/ledger?run=1', 2_000)).toEqual(TIP)
    expect(takeIntent('tip', '/tomas/ledger', 2_000)).toBeNull()
  })

  it('drops an expired intent', () => {
    saveIntent(TIP, 0)
    expect(takeIntent('tip', TIP.path, INTENT_TTL_MS + 1)).toBeNull()
  })

  it('keeps a resumed amount within the ceiling, never raised', () => {
    expect(amountWithin(250, [100, 200, 300])).toBe(200)
    expect(amountWithin(100, [100, 200])).toBe(100)
    expect(amountWithin(64, [100, 200])).toBeNull()
  })
})
