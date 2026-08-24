/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Id } from '@/convex/_generated/dataModel'

const RECEIPT_ONE = {
  articleId: 'articles:one',
  highlightId: 'highlight-one',
  tipperId: 'users:one' as Id<'users'>,
  amountCents: 100,
  stellarNetwork: 'TESTNET' as const,
  stellarSourceAccount: 'GTIPPERONE',
  intentId: 'intent-one' as Id<'highlightTipIntents'>,
  signedXdr: 'signed-xdr-one',
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

  it('durably restores the exact signed transaction after the module reloads', async () => {
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

  it('stores each receipt under its own key so interleaved writers cannot overwrite one another', async () => {
    const {
      PENDING_HIGHLIGHT_TIP_RECEIPT_STORAGE_PREFIX,
      readPendingHighlightTipReceipt,
      writePendingHighlightTipReceipt,
    } = await import('./pendingHighlightTipReceipt')
    const concurrentReceipt = {
      ...RECEIPT_ONE,
      articleId: 'articles:two',
      highlightId: 'highlight-two',
      intentId: 'intent-two' as Id<'highlightTipIntents'>,
      signedXdr: 'signed-xdr-two',
      stellarTxId: 'transaction-two',
    }
    const originalSetItem = Storage.prototype.setItem
    let interleaved = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (!interleaved && value.includes('intent-one')) {
        interleaved = true
        originalSetItem.call(
          this,
          `${PENDING_HIGHLIGHT_TIP_RECEIPT_STORAGE_PREFIX}concurrent-writer`,
          JSON.stringify(concurrentReceipt)
        )
      }
      originalSetItem.call(this, key, value)
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
    expect(
      readPendingHighlightTipReceipt(
        'articles:two',
        'highlight-two',
        'TESTNET',
        'users:one'
      )
    ).toEqual(concurrentReceipt)
    expect(
      Array.from({ length: window.localStorage.length }, (_, index) =>
        window.localStorage.key(index)
      ).filter((key) =>
        key?.startsWith(PENDING_HIGHLIGHT_TIP_RECEIPT_STORAGE_PREFIX)
      )
    ).toHaveLength(2)
  })

  it('rolls back its own new receipt if an interleaved writer fills the twentieth slot', async () => {
    const {
      PENDING_HIGHLIGHT_TIP_RECEIPT_STORAGE_PREFIX,
      readPendingHighlightTipReceipt,
      writePendingHighlightTipReceipt,
    } = await import('./pendingHighlightTipReceipt')
    for (let index = 0; index < 19; index += 1) {
      writePendingHighlightTipReceipt({
        ...RECEIPT_ONE,
        highlightId: `existing-${index}`,
        intentId: `existing-intent-${index}` as Id<'highlightTipIntents'>,
        signedXdr: `existing-signed-xdr-${index}`,
        stellarTxId: `existing-transaction-${index}`,
      })
    }
    const interleavedReceipt = {
      ...RECEIPT_ONE,
      highlightId: 'highlight-b',
      intentId: 'intent-b' as Id<'highlightTipIntents'>,
      signedXdr: 'signed-xdr-b',
      stellarTxId: 'transaction-b',
    }
    const originalSetItem = Storage.prototype.setItem
    let interleaved = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (!interleaved && value.includes('intent-a')) {
        interleaved = true
        originalSetItem.call(
          this,
          `${PENDING_HIGHLIGHT_TIP_RECEIPT_STORAGE_PREFIX}writer-b`,
          JSON.stringify(interleavedReceipt)
        )
      }
      originalSetItem.call(this, key, value)
    })

    expect(() =>
      writePendingHighlightTipReceipt({
        ...RECEIPT_ONE,
        highlightId: 'highlight-a',
        intentId: 'intent-a' as Id<'highlightTipIntents'>,
        signedXdr: 'signed-xdr-a',
        stellarTxId: 'transaction-a',
      })
    ).toThrow(/20 pending highlight tips/i)
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-a',
        'TESTNET',
        'users:one'
      )
    ).toBeNull()
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-b',
        'TESTNET',
        'users:one'
      )
    ).toEqual(interleavedReceipt)
  })

  it('isolates and clears receipts by tipper, intent, article, highlight, and network', async () => {
    const {
      clearPendingHighlightTipReceipt,
      readPendingHighlightTipReceipt,
      writePendingHighlightTipReceipt,
    } = await import('./pendingHighlightTipReceipt')
    const otherTipperReceipt = {
      ...RECEIPT_ONE,
      tipperId: 'users:two' as Id<'users'>,
      intentId: 'intent-two' as Id<'highlightTipIntents'>,
      signedXdr: 'signed-xdr-two',
      stellarTxId: 'transaction-two',
    }
    writePendingHighlightTipReceipt(RECEIPT_ONE)
    writePendingHighlightTipReceipt(otherTipperReceipt)

    clearPendingHighlightTipReceipt(RECEIPT_ONE)

    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:one'
      )
    ).toBeNull()
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:two'
      )
    ).toEqual(otherTipperReceipt)
    expect(
      readPendingHighlightTipReceipt(
        'articles:two',
        'highlight-one',
        'TESTNET',
        'users:two'
      )
    ).toBeNull()
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'MAINNET',
        'users:two'
      )
    ).toBeNull()
  })

  it('discards malformed per-receipt entries without disturbing valid receipts', async () => {
    const {
      PENDING_HIGHLIGHT_TIP_RECEIPT_STORAGE_PREFIX,
      readPendingHighlightTipReceipt,
      writePendingHighlightTipReceipt,
    } = await import('./pendingHighlightTipReceipt')
    writePendingHighlightTipReceipt(RECEIPT_ONE)
    const malformedKey = `${PENDING_HIGHLIGHT_TIP_RECEIPT_STORAGE_PREFIX}broken`
    window.localStorage.setItem(malformedKey, '{not-json')

    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:one'
      )
    ).toEqual(RECEIPT_ONE)
    expect(window.localStorage.getItem(malformedKey)).toBeNull()
  })

  it('does not crash on localStorage read failures', async () => {
    const { readPendingHighlightTipReceipt } =
      await import('./pendingHighlightTipReceipt')
    vi.spyOn(Storage.prototype, 'key').mockImplementationOnce(() => {
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

  it('does not repeatedly process a malformed key when cleanup is blocked', async () => {
    const {
      PENDING_HIGHLIGHT_TIP_RECEIPT_STORAGE_PREFIX,
      readPendingHighlightTipReceipt,
    } = await import('./pendingHighlightTipReceipt')
    const malformedKey = `${PENDING_HIGHLIGHT_TIP_RECEIPT_STORAGE_PREFIX}blocked-cleanup`
    window.localStorage.setItem(malformedKey, '{not-json')
    const originalRemoveItem = Storage.prototype.removeItem
    const removeItem = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementationOnce(() => {
        throw new Error('cleanup blocked')
      })
      .mockImplementation(function (this: Storage, key: string) {
        originalRemoveItem.call(this, key)
      })

    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:one'
      )
    ).toBeNull()
    expect(removeItem).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem(malformedKey)).toBe('{not-json')
  })

  it('fails the mandatory durable write instead of keeping an in-memory-only copy', async () => {
    const { readPendingHighlightTipReceipt, writePendingHighlightTipReceipt } =
      await import('./pendingHighlightTipReceipt')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('storage full')
    })

    expect(() => writePendingHighlightTipReceipt(RECEIPT_ONE)).toThrow(
      /could not be saved/i
    )
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-one',
        'TESTNET',
        'users:one'
      )
    ).toBeNull()
  })

  it('rejects a write that cannot be read back durably', async () => {
    const { writePendingHighlightTipReceipt } =
      await import('./pendingHighlightTipReceipt')
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValueOnce(null)

    expect(() => writePendingHighlightTipReceipt(RECEIPT_ONE)).toThrow(
      /could not be saved/i
    )
  })

  it('aborts a new write when existing receipt keys cannot be counted safely', async () => {
    const { writePendingHighlightTipReceipt } =
      await import('./pendingHighlightTipReceipt')
    window.localStorage.setItem('unrelated', 'value')
    vi.spyOn(Storage.prototype, 'key').mockImplementationOnce(() => {
      throw new Error('enumeration blocked')
    })

    expect(() => writePendingHighlightTipReceipt(RECEIPT_ONE)).toThrow(
      /could not be saved/i
    )
    expect(window.localStorage.length).toBe(1)
  })

  it('refuses a twenty-first unsettled receipt without evicting any existing receipt', async () => {
    const { readPendingHighlightTipReceipt, writePendingHighlightTipReceipt } =
      await import('./pendingHighlightTipReceipt')
    for (let index = 0; index < 20; index += 1) {
      writePendingHighlightTipReceipt({
        ...RECEIPT_ONE,
        highlightId: `highlight-${index}`,
        intentId: `intent-${index}` as Id<'highlightTipIntents'>,
        signedXdr: `signed-xdr-${index}`,
        stellarTxId: `transaction-${index}`,
      })
    }

    expect(() =>
      writePendingHighlightTipReceipt({
        ...RECEIPT_ONE,
        highlightId: 'highlight-20',
        intentId: 'intent-20' as Id<'highlightTipIntents'>,
        signedXdr: 'signed-xdr-20',
        stellarTxId: 'transaction-20',
      })
    ).toThrow(/20 pending highlight tips/i)
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-0',
        'TESTNET',
        'users:one'
      )
    ).toMatchObject({ intentId: 'intent-0' })
    expect(
      readPendingHighlightTipReceipt(
        'articles:one',
        'highlight-20',
        'TESTNET',
        'users:one'
      )
    ).toBeNull()
  })
})
