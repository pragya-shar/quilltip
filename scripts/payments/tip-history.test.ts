import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  receiptStatusNote,
  tipGenerationLabel,
  tipStatusLabel,
} from '../../components/account/TipReceiptDialog'
import { WalletTipHistory } from '../../components/account/WalletTipHistory'
import {
  normalizeTipActivity,
  type TipActivityItem,
  type TipActivitySources,
} from '../../lib/account/tipActivity'

/** Tip history and receipt for v2 statuses and earlier rows (#547). */
describe('tip status labels', () => {
  it('gives every v2 status a designed label, as the payment kit says it', () => {
    expect(tipStatusLabel('PREPARED')).toBe('In progress')
    expect(tipStatusLabel('SUBMITTED')).toBe('Confirming')
    expect(tipStatusLabel('MISMATCH')).toBe('Under review')
    expect(tipStatusLabel('MISMATCH', 'author')).toBe('Sent to updated address')
    expect(tipStatusLabel('EXPIRED')).toBe('Timed out')
    for (const status of ['PREPARED', 'SUBMITTED', 'MISMATCH', 'EXPIRED']) {
      expect(tipStatusLabel(status)).not.toMatch(/Unrecognized/)
    }
    // v1 labels stay.
    expect(tipStatusLabel('CONFIRMED')).toBe('Confirmed')
    expect(tipStatusLabel('FRAUDULENT')).toBe('Rejected')
  })

  it('says what each unconfirmed v2 row means on the receipt', () => {
    expect(receiptStatusNote({ status: 'CONFIRMED' })).toBeNull()
    expect(receiptStatusNote({ status: 'SUBMITTED' })).toMatch(
      /awaiting verification/
    )
    // Money may have moved: never "does not represent a payment".
    expect(receiptStatusNote({ status: 'MISMATCH' })).toMatch(
      /do not send it again/
    )
    expect(
      receiptStatusNote({ status: 'MISMATCH', mismatchReason: 'author' })
    ).toMatch(/registered for this article/)
    expect(receiptStatusNote({ status: 'EXPIRED' })).toMatch(/nothing was paid/)
  })
})

const article = (o: Record<string, unknown>) => ({
  _id: `tip-${o.status}-${o.contractVersion}`,
  status: 'CONFIRMED',
  createdAt: 1_795_000_000_000,
  amountCents: 100,
  tipperId: 'reader',
  authorId: 'writer',
  authorName: 'Ada Lovelace',
  tipperName: 'Reader',
  articleTitle: 'On Writing Well',
  sourceArticle: null,
  stellarNetwork: 'TESTNET',
  ...o,
})

function sources(rows: Record<string, unknown>[]): TipActivitySources {
  return {
    sentArticles: rows.map(article),
    receivedArticles: [],
    sentPassages: [],
    receivedPassages: [],
  } as unknown as TipActivitySources
}

describe('the contract generation of a row', () => {
  it('keeps contractVersion from the tip reads', () => {
    const items = normalizeTipActivity(
      sources([{ contractVersion: 'v1' }, { contractVersion: 'v2' }])
    )
    expect(items.map((i) => i.contractVersion).sort()).toEqual(['v1', 'v2'])
  })

  it('labels earlier rows "Testnet v1" in the history, and v2 rows "Testnet"', () => {
    const items: TipActivityItem[] = normalizeTipActivity(
      sources([
        { contractVersion: 'v1', articleTitle: 'Earlier essay' },
        {
          contractVersion: 'v2',
          articleTitle: 'Newer essay',
          createdAt: 1_795_000_100_000,
        },
      ])
    )
    expect(
      tipGenerationLabel(items.find((i) => i.contractVersion === 'v1')!)
    ).toBe('Testnet v1')
    expect(
      tipGenerationLabel(items.find((i) => i.contractVersion === 'v2')!)
    ).toBeNull()
    const html = renderToStaticMarkup(
      createElement(WalletTipHistory, { items })
    )
    const rows = html.split('<li').slice(1)
    expect(rows).toHaveLength(2)
    const earlier = rows.find((r) => r.includes('Earlier essay'))!
    const newer = rows.find((r) => r.includes('Newer essay'))!
    expect(earlier).toContain('<span>Testnet v1</span>')
    expect(newer).toContain('<span>Testnet</span>')
    expect(newer).not.toContain('Testnet v1')
  })

  it('labels a v2 row in flight with its status, not "Unrecognized"', () => {
    const items = normalizeTipActivity(
      sources([{ contractVersion: 'v2', status: 'SUBMITTED' }])
    )
    const html = renderToStaticMarkup(
      createElement(WalletTipHistory, { items })
    )
    expect(html).toContain('Confirming')
    expect(html).not.toContain('Unrecognized')
  })
})
