/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Id } from '@/convex/_generated/dataModel'

const STORAGE_KEY = 'quilltip:pendingHighlightTipReceipts'

const RECEIPT_ONE = {
  articleId: 'articles:one',
  highlightId: 'highlight-one',
  tipperId: 'users:one' as Id<'users'>,
  amountCents: 100,
  stellarNetwork: 'TESTNET' as const,
  stellarSourceAccount: 'GTIPPERONE',
  intentId: 'intent-one' as Id<'highlightTipIntents'>,
  stellarTxId: 'transaction-one',
  contractTipId: 'contract-tip-one',
}

describe('pendingHighlightTipReceipt storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('restores an accepted highlight receipt after the module is reloaded', async () => {
    const { writePendingHighlightTipReceipt } =
      await import('./pendingHighlightTipReceipt')
    writePendingHighlightTipReceipt(RECEIPT_ONE)

    vi.resetModules()
    const { readPendingHighlightTipReceipt } =
      await import('./pendingHighlightTipReceipt')

    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:one'
      )
    ).toEqual(RECEIPT_ONE)
  })

  it('isolates receipts by tipper, intent, article, highlight, and network', async () => {
    const {
      clearPendingHighlightTipReceipt,
      readPendingHighlightTipReceipt,
      writePendingHighlightTipReceipt,
    } = await import('./pendingHighlightTipReceipt')
    const newerReceipt = {
      ...RECEIPT_ONE,
      intentId: 'intent-two' as Id<'highlightTipIntents'>,
      stellarTxId: 'transaction-two',
    }
    writePendingHighlightTipReceipt(RECEIPT_ONE)
    writePendingHighlightTipReceipt(newerReceipt)
    writePendingHighlightTipReceipt({
      ...RECEIPT_ONE,
      tipperId: 'users:two' as Id<'users'>,
      intentId: 'intent-three' as Id<'highlightTipIntents'>,
      stellarTxId: 'transaction-three',
    })
    writePendingHighlightTipReceipt({
      ...RECEIPT_ONE,
      highlightId: 'highlight-two',
      intentId: 'intent-four' as Id<'highlightTipIntents'>,
      stellarTxId: 'transaction-four',
    })

    clearPendingHighlightTipReceipt(RECEIPT_ONE)

    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:one'
      )
    ).toEqual(newerReceipt)
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:two'
      )
    ).toMatchObject({ intentId: 'intent-three' })
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-two',
        'TESTNET',
        'users:one'
      )
    ).toMatchObject({ intentId: 'intent-four' })
    expect(
      readPendingHighlightTipReceipt(
        'articles:two',
        'highlight-one',
        'TESTNET',
        'users:one'
      )
    ).toBeNull()
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'MAINNET',
        'users:one'
      )
    ).toBeNull()
  })

  it('discards malformed entries while retaining valid receipts', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([RECEIPT_ONE, { articleId: 'broken' }])
    )

    const { readPendingHighlightTipReceipt } =
      await import('./pendingHighlightTipReceipt')

    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:one'
      )
    ).toEqual(RECEIPT_ONE)
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    ).toEqual([RECEIPT_ONE])
  })

  it('survives malformed JSON and localStorage read failures', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not-json')
    const { readPendingHighlightTipReceipt } =
      await import('./pendingHighlightTipReceipt')

    expect(() =>
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:one'
      )
    ).not.toThrow()
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:one'
      )
    ).toBeNull()

    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('storage blocked')
    })
    expect(() =>
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:one'
      )
    ).not.toThrow()
  })

  it('keeps an in-memory recovery copy when localStorage writes fail', async () => {
    const { readPendingHighlightTipReceipt, writePendingHighlightTipReceipt } =
      await import('./pendingHighlightTipReceipt')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('storage full')
    })

    writePendingHighlightTipReceipt(RECEIPT_ONE)

    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:one'
      )
    ).toEqual(RECEIPT_ONE)
  })

  it('deterministically keeps only the 20 most recently written receipts', async () => {
    const { readPendingHighlightTipReceipt, writePendingHighlightTipReceipt } =
      await import('./pendingHighlightTipReceipt')
    for (let index = 0; index < 21; index += 1) {
      writePendingHighlightTipReceipt({
        ...RECEIPT_ONE,
        highlightId: `highlight-${index}`,
        intentId: `intent-${index}` as Id<'highlightTipIntents'>,
        stellarTxId: `transaction-${index}`,
      })
    }

    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-0',
        'TESTNET',
        'users:one'
      )
    ).toBeNull()
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-1',
        'TESTNET',
        'users:one'
      )
    ).toMatchObject({ intentId: 'intent-1' })
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-20',
        'TESTNET',
        'users:one'
      )
    ).toMatchObject({ intentId: 'intent-20' })
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    ).toHaveLength(20)
  })
})
