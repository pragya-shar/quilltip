/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Id } from '@/convex/_generated/dataModel'

const RECEIPT_ONE = {
  articleId: 'articles:one',
  tipperId: 'users:one' as Id<'users'>,
  amountCents: 100,
  message: 'Thank you',
  stellarNetwork: 'TESTNET' as const,
  stellarSourceAccount: 'GTIPPERONE',
  intentId: 'intent-one' as Id<'articleTipIntents'>,
  signedXdr: 'signed-xdr-one',
  stellarTxId: 'transaction-one',
  contractTipId: 'contract-tip-one',
}

const LEGACY_RECEIPT = {
  articleId: 'articles:legacy',
  tipperId: 'users:one' as Id<'users'>,
  amountCents: 250,
  message: 'Already sent',
  stellarNetwork: 'TESTNET' as const,
  stellarSourceAccount: 'GTIPPERONE',
  intentId: 'intent-legacy' as Id<'articleTipIntents'>,
  stellarTxId: 'transaction-legacy',
}

describe('pendingArticleTipReceipt storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('restores an on-chain receipt after the module is reloaded', async () => {
    const { writePendingArticleTipReceipt } =
      await import('./pendingArticleTipReceipt')
    writePendingArticleTipReceipt(RECEIPT_ONE)

    vi.resetModules()
    const { readPendingArticleTipReceipt } =
      await import('./pendingArticleTipReceipt')

    expect(
      readPendingArticleTipReceipt('articles:one', 'TESTNET', 'users:one')
    ).toEqual(RECEIPT_ONE)
  })

  it('restores current and legacy receipts independently when a stored row is malformed', async () => {
    window.localStorage.setItem(
      'quilltip:pendingArticleTipReceipts',
      JSON.stringify([
        RECEIPT_ONE,
        { articleId: 'articles:broken', stellarTxId: 123 },
        LEGACY_RECEIPT,
      ])
    )

    const { readPendingArticleTipReceipt } =
      await import('./pendingArticleTipReceipt')

    expect(
      readPendingArticleTipReceipt('articles:one', 'TESTNET', 'users:one')
    ).toEqual(RECEIPT_ONE)
    expect(
      readPendingArticleTipReceipt('articles:legacy', 'TESTNET', 'users:one')
    ).toEqual(LEGACY_RECEIPT)
  })

  it('keeps independent receipts and clears only the confirmed article', async () => {
    const {
      clearPendingArticleTipReceipt,
      readPendingArticleTipReceipt,
      writePendingArticleTipReceipt,
    } = await import('./pendingArticleTipReceipt')

    writePendingArticleTipReceipt(RECEIPT_ONE)
    writePendingArticleTipReceipt({
      ...RECEIPT_ONE,
      articleId: 'articles:two',
      intentId: 'intent-two' as Id<'articleTipIntents'>,
      signedXdr: 'signed-xdr-two',
      stellarTxId: 'transaction-two',
    })

    clearPendingArticleTipReceipt('articles:one', 'TESTNET', 'users:one')

    expect(
      readPendingArticleTipReceipt('articles:one', 'TESTNET', 'users:one')
    ).toBeNull()
    expect(
      readPendingArticleTipReceipt('articles:two', 'TESTNET', 'users:one')
    ).toEqual({
      ...RECEIPT_ONE,
      articleId: 'articles:two',
      intentId: 'intent-two' as Id<'articleTipIntents'>,
      signedXdr: 'signed-xdr-two',
      stellarTxId: 'transaction-two',
    })
  })

  it('does not expose or clear another tipper receipt on a shared browser', async () => {
    const {
      clearPendingArticleTipReceipt,
      readPendingArticleTipReceipt,
      writePendingArticleTipReceipt,
    } = await import('./pendingArticleTipReceipt')

    writePendingArticleTipReceipt(RECEIPT_ONE)

    expect(
      readPendingArticleTipReceipt('articles:one', 'TESTNET', 'users:two')
    ).toBeNull()

    clearPendingArticleTipReceipt('articles:one', 'TESTNET', 'users:two')

    expect(
      readPendingArticleTipReceipt('articles:one', 'TESTNET', 'users:one')
    ).toEqual(RECEIPT_ONE)
  })

  it('keeps a legacy receipt isolated by article, tipper, and network', async () => {
    window.localStorage.setItem(
      'quilltip:pendingArticleTipReceipts',
      JSON.stringify([LEGACY_RECEIPT])
    )
    const { readPendingArticleTipReceipt } =
      await import('./pendingArticleTipReceipt')

    expect(
      readPendingArticleTipReceipt('articles:other', 'TESTNET', 'users:one')
    ).toBeNull()
    expect(
      readPendingArticleTipReceipt('articles:legacy', 'MAINNET', 'users:one')
    ).toBeNull()
    expect(
      readPendingArticleTipReceipt('articles:legacy', 'TESTNET', 'users:two')
    ).toBeNull()
    expect(
      readPendingArticleTipReceipt('articles:legacy', 'TESTNET', 'users:one')
    ).toEqual(LEGACY_RECEIPT)
  })

  it('rejects attempts to write a new hash-only receipt', async () => {
    const { writePendingArticleTipReceipt } =
      await import('./pendingArticleTipReceipt')

    expect(() =>
      writePendingArticleTipReceipt(LEGACY_RECEIPT as never)
    ).toThrow(/signed xdr/i)
    expect(window.localStorage.length).toBe(0)
  })

  it('fails closed when the exact signed transaction cannot be durably stored', async () => {
    const { writePendingArticleTipReceipt } =
      await import('./pendingArticleTipReceipt')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded')
    })

    expect(() => writePendingArticleTipReceipt(RECEIPT_ONE)).toThrow(
      /could not be saved for safe recovery/i
    )
    expect(window.localStorage.length).toBe(0)
  })
})
