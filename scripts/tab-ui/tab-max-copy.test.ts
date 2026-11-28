import { describe, expect, it } from 'vitest'

import { TAB_TIP_DIALOG } from '../../lib/copy/tab'
import { formatXlm } from '../../lib/payments/format'
import { formatCents } from '../../lib/tip/v2/amount'

/**
 * The tab tip maximum states the limit as it is set, in XLM, with the dollar
 * figure as a hint in the #670 form, never as a real market price (#676).
 */
const hint = (stroops: string, cents: number) =>
  TAB_TIP_DIALOG.maxHint(formatXlm(stroops), formatCents(cents))
const above = (stroops: string, cents: number) =>
  TAB_TIP_DIALOG.aboveMax(formatXlm(stroops), formatCents(cents))

describe('tab tip maximum copy', () => {
  it('names the XLM limit, then the dollars it would be worth if real', () => {
    expect(hint('50000000', 450)).toBe(
      'Tab tips go up to 5 XLM, worth about $4.50 if this were real XLM.'
    )
    expect(above('50000000', 450)).toEqual({
      title: 'Tab tips go up to 5 XLM',
      detail:
        'That is about $4.50 if this were real XLM. Choose $4.50 or less, or send this amount from your wallet.',
    })
  })

  it('writes a limit that is not a whole number in the app number form', () => {
    expect(hint('25000000', 25)).toBe(
      'Tab tips go up to 2.5 XLM, worth about $0.25 if this were real XLM.'
    )
    expect(above('12345678', 1).title).toBe('Tab tips go up to 1.2345678 XLM')
    // Whole dollars carry no cents, as on the send buttons.
    expect(hint('500000000', 1200)).toBe(
      'Tab tips go up to 50 XLM, worth about $12 if this were real XLM.'
    )
  })

  it('points at no real market', () => {
    const texts = [
      hint('50000000', 450),
      above('50000000', 450).title,
      above('50000000', 450).detail,
    ]
    for (const text of texts) {
      expect(text).not.toMatch(/today|market|price/i)
    }
  })
})
