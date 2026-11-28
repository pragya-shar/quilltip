import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  CHAIN_RECORD_STATUSES,
  TAB_RECEIPT_STATUSES,
} from '../../convex/lib/chain/schema'
import {
  receiptStatusNote,
  shownTipStatus,
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

describe('every status the backend writes has a label (#547)', () => {
  const v1 = [
    'PENDING',
    'CONFIRMING',
    'CONFIRMED',
    'FAILED',
    'FRAUDULENT',
    'UNVERIFIED',
  ]
  it('v1, v2 chain records and tab tip receipts', () => {
    for (const status of [
      ...v1,
      ...CHAIN_RECORD_STATUSES,
      ...TAB_RECEIPT_STATUSES,
    ]) {
      expect(tipStatusLabel(status), status).not.toMatch(/Unrecognized/)
    }
  })

  it('labels tab receipts as the payment kit does', () => {
    expect(tipStatusLabel('ACCEPTED')).toBe('Settling')
    expect(tipStatusLabel('SETTLED')).toBe('Settled')
    expect(tipStatusLabel('SHORTFALL')).toBe('Waiting for balance')
    expect(tipStatusLabel('UNPAID')).toBe('Not paid')
    expect(tipStatusLabel('REJECTED')).toBe('Not settled')
    expect(tipStatusLabel('VOID_RESET')).toBe('Cleared by reset')
  })

  it('explains tab receipts on the receipt, for the reader and the writer', () => {
    expect(receiptStatusNote({ status: 'SETTLED' })).toBeNull()
    expect(receiptStatusNote({ status: 'ACCEPTED' })).toMatch(
      /not settled yet\. Settles at 5 XLM to this writer, or after 6 hours\./
    )
    expect(receiptStatusNote({ status: 'SHORTFALL' })).toMatch(/next top-up/)
    expect(receiptStatusNote({ status: 'UNPAID', direction: 'sent' })).toMatch(
      /back in your tab balance/
    )
    expect(
      receiptStatusNote({ status: 'UNPAID', direction: 'received' })
    ).toMatch(/will not be paid/)
    expect(
      receiptStatusNote({ status: 'REJECTED', direction: 'received' })
    ).toMatch(/not paid to you/)
    expect(receiptStatusNote({ status: 'VOID_RESET' })).toMatch(/reset/)
    // None of them reads as an unknown record.
    for (const status of TAB_RECEIPT_STATUSES) {
      expect(receiptStatusNote({ status }) ?? '').not.toMatch(
        /does not represent a confirmed payment/
      )
    }
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

/** A reader's accepted tab tips while the tab is short (#643). */
describe('accepted tab tips on a short tab', () => {
  const sent = { status: 'ACCEPTED', direction: 'sent' as const }

  it('show as waiting for a top-up, with no amount or time', () => {
    const status = shownTipStatus(sent, true)
    expect(tipStatusLabel(status)).toBe('Waiting for balance')
    const note = receiptStatusNote({ ...sent, status })
    expect(note).toBe(
      'This tip is recorded, but the tab ran short. It settles after the next top-up.'
    )
    expect(note).not.toMatch(/5 XLM|6 hours/)
  })

  it('keep the settling wording when the tab is not short', () => {
    const status = shownTipStatus(sent, false)
    expect(tipStatusLabel(status)).toBe('Settling')
    expect(receiptStatusNote({ ...sent, status })).toBe(
      'Sent from a tab and not settled yet. Settles at 5 XLM to this writer, or after 6 hours.'
    )
  })

  it('leave settled tips and the writer’s received tips as they are', () => {
    expect(shownTipStatus({ status: 'SETTLED', direction: 'sent' }, true)).toBe(
      'SETTLED'
    )
    expect(
      shownTipStatus({ status: 'ACCEPTED', direction: 'received' }, true)
    ).toBe('ACCEPTED')
  })

  it('read "Waiting for balance" in the wallet history', () => {
    const items = normalizeTipActivity(
      sources([{ contractVersion: 'v2', status: 'ACCEPTED' }])
    )
    const short = renderToStaticMarkup(
      createElement(WalletTipHistory, { items, readerTabShort: true })
    )
    expect(short).toContain('Waiting for balance')
    expect(short).not.toContain('Settling')
    const funded = renderToStaticMarkup(
      createElement(WalletTipHistory, { items, readerTabShort: false })
    )
    expect(funded).toContain('Settling')
  })
})
