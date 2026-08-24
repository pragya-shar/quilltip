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
