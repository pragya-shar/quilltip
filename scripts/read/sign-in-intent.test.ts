// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  INTENT_KEY,
  INTENT_TTL_MS,
  amountWithin,
  keepIntent,
  parseReadIntent,
  saveIntent,
  takeIntent,
  tipIntent,
} from '@/components/read/signInIntent'

// The read view's side of the sign-in package's intent contract: the same
// shapes, key and stored form, taken once for the page it names.

const TIP = tipIntent({
  path: '/tomas/ledger#s-1-0',
  articleId: 'k57rdfxtrartc1e0000000000000000001',
  passage: { text: 'A line.', start: 10, end: 17 },
  amount: { cents: 100, display: '$1' },
  writer: 'Tomás Reyes',
})

beforeEach(() => sessionStorage.clear())

describe('the sign-in intent', () => {
  it('stores the package form and is taken once, for its page only', () => {
    expect(saveIntent(TIP, 1_000)).toBe(true)
    expect(JSON.parse(sessionStorage.getItem(INTENT_KEY)!)).toEqual({
      v: 1,
      savedAt: 1_000,
      intent: TIP,
    })
    expect(takeIntent('/tomas/other', 2_000)).toBeNull()
    expect(takeIntent('/tomas/ledger', 2_000)).toBeNull()
    expect(takeIntent('/tomas/ledger#s-1-0', 2_000)).toEqual(TIP)
    expect(takeIntent('/tomas/ledger#s-1-0', 2_000)).toBeNull()
  })

  it('drops an expired intent', () => {
    saveIntent(TIP, 0)
    expect(takeIntent(TIP.path, INTENT_TTL_MS + 1)).toBeNull()
  })

  it('refuses malformed intents', () => {
    for (const bad of [
      { ...TIP, path: '//evil.example/x' },
      { ...TIP, path: '/\\evil.example' },
      { ...TIP, articleId: 'a b' },
      { ...TIP, amount: { cents: 0, display: '$0' } },
      { ...TIP, amount: { cents: 50_01, display: '$50.01' } },
      { ...TIP, passage: { text: 'x', start: 5, end: 5 } },
      { ...TIP, writer: '' },
      { ...TIP, kind: 'follow' },
      keepIntent({ path: '/a', articleId: 'a1', passage: null as never }),
    ])
      expect(parseReadIntent(bad), JSON.stringify(bad)).toBeNull()
    expect(
      parseReadIntent(
        keepIntent({
          path: '/a',
          articleId: 'a1',
          passage: { text: 'x', start: 0, end: 1 },
        })
      )
    ).not.toBeNull()
  })

  it('keeps a resumed amount within the ceiling, never raised', () => {
    expect(amountWithin(250, [100, 200, 300])).toBe(200)
    expect(amountWithin(100, [100, 200])).toBe(100)
    expect(amountWithin(64, [100, 200])).toBeNull()
  })
})
