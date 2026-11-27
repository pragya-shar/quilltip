import { describe, expect, it } from 'vitest'
import { clearLegacyTipStorage } from '@/lib/tip/legacyTipStorage'

/** A Map-backed Storage, as localStorage behaves. */
function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

describe('clearLegacyTipStorage', () => {
  it('removes the v1 tip entries and keeps everything else', () => {
    const storage = memoryStorage({
      'quilltip:pendingTipIntent': '{}',
      'quilltip:pendingArticleTipReceipts': '[]',
      'quilltip:pendingArticleTipReceipt:v2:a:b:TESTNET': '{"signedXdr":"x"}',
      'quilltip:pendingHighlightTipReceipt:v2:a:b:c': '{"signedXdr":"y"}',
      'quilltip:xlm_usd_tip_rate_v1': '{}',
      // v2 tip state and other keys stay.
      'quilltip:tip-pending:v2:u:article:a': '{}',
      'quilltip:tip-basket:v2:u': '{}',
      'quilltip:pendingHighlightSelection': '{}',
    })
    clearLegacyTipStorage(storage)
    const left = Array.from({ length: storage.length }, (_, i) =>
      storage.key(i)
    )
    expect(left.sort()).toEqual([
      'quilltip:pendingHighlightSelection',
      'quilltip:tip-basket:v2:u',
      'quilltip:tip-pending:v2:u:article:a',
    ])
  })

  it('does nothing when storage cannot be read', () => {
    const blocked = {
      get length(): number {
        throw new Error('SecurityError')
      },
    } as unknown as Storage
    expect(() => clearLegacyTipStorage(blocked)).not.toThrow()
  })
})
