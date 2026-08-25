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

function storedReceipt(index: number) {
  const base = {
    ...RECEIPT_ONE,
    articleId: `articles:bounded-${index}`,
    intentId: `intent-bounded-${index}` as Id<'articleTipIntents'>,
    stellarTxId: `transaction-bounded-${index}`,
  }
  if (index % 2 === 0) return base
  const { signedXdr: _signedXdr, ...legacy } = base
  return legacy
}

describe('pendingArticleTipReceipt storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('does not let malformed head, interleaved, or tail rows crowd out 20 valid receipts', async () => {
    const validReceipts = Array.from({ length: 20 }, (_, index) =>
      storedReceipt(index)
    )
    window.localStorage.setItem(
      'quilltip:pendingArticleTipReceipts',
      JSON.stringify([
        { malformed: 'head' },
        ...validReceipts.slice(0, 10),
        { malformed: 'middle' },
        ...validReceipts.slice(10),
        { malformed: 'tail' },
      ])
    )

    const { readPendingArticleTipReceipt } =
      await import('./pendingArticleTipReceipt')

    for (const [index, receipt] of validReceipts.entries()) {
      expect(
        readPendingArticleTipReceipt(
          `articles:bounded-${index}`,
          'TESTNET',
          'users:one'
        )
      ).toEqual(receipt)
    }
  })

  it('caps restored storage at the newest 20 valid receipts after discarding malformed rows', async () => {
    const validReceipts = Array.from({ length: 21 }, (_, index) =>
      storedReceipt(index)
    )
    window.localStorage.setItem(
      'quilltip:pendingArticleTipReceipts',
      JSON.stringify([
        { malformed: 'head' },
        ...validReceipts.slice(0, 7),
        { malformed: 'middle' },
        ...validReceipts.slice(7),
        { malformed: 'tail' },
      ])
    )

    const { readPendingArticleTipReceipt } =
      await import('./pendingArticleTipReceipt')

    expect(
      readPendingArticleTipReceipt('articles:bounded-0', 'TESTNET', 'users:one')
    ).toBeNull()
    for (const [index, receipt] of validReceipts.slice(1).entries()) {
      expect(
        readPendingArticleTipReceipt(
          `articles:bounded-${index + 1}`,
          'TESTNET',
          'users:one'
        )
      ).toEqual(receipt)
    }
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

  it('keeps an unrelated receipt written by another tab during persistence', async () => {
    const { readPendingArticleTipReceipt, writePendingArticleTipReceipt } =
      await import('./pendingArticleTipReceipt')
    const concurrentReceipt = {
      ...RECEIPT_ONE,
      articleId: 'articles:concurrent',
      intentId: 'intent-concurrent' as Id<'articleTipIntents'>,
      signedXdr: 'signed-xdr-concurrent',
      stellarTxId: 'transaction-concurrent',
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
          'quilltip:pendingArticleTipReceipt:v2:concurrent-writer',
          JSON.stringify(concurrentReceipt)
        )
      }
      originalSetItem.call(this, key, value)
    })

    writePendingArticleTipReceipt(RECEIPT_ONE)

    expect(
      readPendingArticleTipReceipt('articles:one', 'TESTNET', 'users:one')
    ).toEqual(RECEIPT_ONE)
    expect(
      readPendingArticleTipReceipt(
        'articles:concurrent',
        'TESTNET',
        'users:one'
      )
    ).toEqual(concurrentReceipt)
  })

  it('rolls back its own new receipt if an interleaved writer fills the twentieth slot', async () => {
    const {
      PENDING_ARTICLE_TIP_RECEIPT_STORAGE_PREFIX,
      readPendingArticleTipReceipt,
      writePendingArticleTipReceipt,
    } = await import('./pendingArticleTipReceipt')
    for (let index = 0; index < 19; index += 1) {
      writePendingArticleTipReceipt({
        ...RECEIPT_ONE,
        articleId: `articles:existing-${index}`,
        intentId: `intent-existing-${index}` as Id<'articleTipIntents'>,
        signedXdr: `signed-xdr-existing-${index}`,
        stellarTxId: `transaction-existing-${index}`,
      })
    }
    const interleavedReceipt = {
      ...RECEIPT_ONE,
      articleId: 'articles:b',
      intentId: 'intent-b' as Id<'articleTipIntents'>,
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
          `${PENDING_ARTICLE_TIP_RECEIPT_STORAGE_PREFIX}writer-b`,
          JSON.stringify(interleavedReceipt)
        )
      }
      originalSetItem.call(this, key, value)
    })

    expect(() =>
      writePendingArticleTipReceipt({
        ...RECEIPT_ONE,
        articleId: 'articles:a',
        intentId: 'intent-a' as Id<'articleTipIntents'>,
        signedXdr: 'signed-xdr-a',
        stellarTxId: 'transaction-a',
      })
    ).toThrow(/20 pending article tips/i)
    expect(
      readPendingArticleTipReceipt('articles:a', 'TESTNET', 'users:one')
    ).toBeNull()
    expect(
      readPendingArticleTipReceipt('articles:b', 'TESTNET', 'users:one')
    ).toEqual(interleavedReceipt)
  })

  it('discards a malformed per-receipt entry without disturbing a valid receipt', async () => {
    const {
      PENDING_ARTICLE_TIP_RECEIPT_STORAGE_PREFIX,
      readPendingArticleTipReceipt,
      writePendingArticleTipReceipt,
    } = await import('./pendingArticleTipReceipt')
    writePendingArticleTipReceipt(RECEIPT_ONE)
    const malformedKey = `${PENDING_ARTICLE_TIP_RECEIPT_STORAGE_PREFIX}broken`
    window.localStorage.setItem(malformedKey, '{not-json')

    expect(
      readPendingArticleTipReceipt('articles:one', 'TESTNET', 'users:one')
    ).toEqual(RECEIPT_ONE)
    expect(window.localStorage.getItem(malformedKey)).toBeNull()
  })

  it('does not repeatedly process a malformed key when cleanup is blocked', async () => {
    const {
      PENDING_ARTICLE_TIP_RECEIPT_STORAGE_PREFIX,
      readPendingArticleTipReceipt,
    } = await import('./pendingArticleTipReceipt')
    const malformedKey = `${PENDING_ARTICLE_TIP_RECEIPT_STORAGE_PREFIX}blocked-cleanup`
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
      readPendingArticleTipReceipt('articles:one', 'TESTNET', 'users:one')
    ).toBeNull()
    expect(removeItem).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem(malformedKey)).toBe('{not-json')
  })

  it('rejects a write that cannot be read back durably', async () => {
    const {
      PENDING_ARTICLE_TIP_RECEIPT_STORAGE_PREFIX,
      writePendingArticleTipReceipt,
    } = await import('./pendingArticleTipReceipt')
    const originalGetItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string
    ) {
      if (key.startsWith(PENDING_ARTICLE_TIP_RECEIPT_STORAGE_PREFIX)) {
        return null
      }
      return originalGetItem.call(this, key)
    })

    expect(() => writePendingArticleTipReceipt(RECEIPT_ONE)).toThrow(
      /could not be saved for safe recovery/i
    )
  })

  it('rolls back a new receipt when storage cannot be enumerated after the write', async () => {
    const { writePendingArticleTipReceipt } =
      await import('./pendingArticleTipReceipt')
    vi.spyOn(Storage.prototype, 'key').mockImplementationOnce(() => {
      throw new Error('enumeration blocked')
    })

    expect(() => writePendingArticleTipReceipt(RECEIPT_ONE)).toThrow(
      /could not be saved for safe recovery/i
    )
    expect(window.localStorage.length).toBe(0)
  })

  it('refuses a twenty-first unresolved receipt without evicting the oldest', async () => {
    const { readPendingArticleTipReceipt, writePendingArticleTipReceipt } =
      await import('./pendingArticleTipReceipt')
    for (let index = 0; index < 20; index += 1) {
      writePendingArticleTipReceipt({
        ...RECEIPT_ONE,
        articleId: `articles:limit-${index}`,
        intentId: `intent-limit-${index}` as Id<'articleTipIntents'>,
        signedXdr: `signed-xdr-limit-${index}`,
        stellarTxId: `transaction-limit-${index}`,
      })
    }

    expect(() =>
      writePendingArticleTipReceipt({
        ...RECEIPT_ONE,
        articleId: 'articles:limit-20',
        intentId: 'intent-limit-20' as Id<'articleTipIntents'>,
        signedXdr: 'signed-xdr-limit-20',
        stellarTxId: 'transaction-limit-20',
      })
    ).toThrow(/20 pending article tips/i)
    expect(
      readPendingArticleTipReceipt('articles:limit-0', 'TESTNET', 'users:one')
    ).toMatchObject({ intentId: 'intent-limit-0' })
    expect(
      readPendingArticleTipReceipt('articles:limit-20', 'TESTNET', 'users:one')
    ).toBeNull()
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
