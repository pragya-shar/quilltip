import { describe, expect, it } from 'vitest'
import { rowSpoken } from '@/components/pocket/rowAmount'
import { MONEY_TEXT_SAMPLES } from '@/lib/payments/money-samples'
import { convertedMoney, money } from '@/lib/payments/money'
import { figureState } from '@/system/money/figure'

// The balance reads the money layer's text and spoken text as written, and
// these are the layer's own samples of both: every sample draws as a
// figure, and a row says each signed sample exactly as the layer does.

const SIGN = { minus: '−', plus: '+' } as const

describe('the money layer’s samples on the balance', () => {
  it.each(MONEY_TEXT_SAMPLES.map((s) => [s.name, s] as const))(
    '%s draws as a figure',
    (_, sample) => {
      const value = sample.format?.converted
        ? convertedMoney(sample.cents)
        : money(sample.cents)
      expect(figureState(value).kind).toBe('value')
    }
  )

  it.each(
    MONEY_TEXT_SAMPLES.filter((s) => !s.format?.converted).map(
      (s) => [s.name, s] as const
    )
  )('a row says %s as the layer does', (_, sample) => {
    const sign = sample.format?.sign ? SIGN[sample.format.sign] : ''
    expect(rowSpoken(money(sample.cents), sign)).toBe(sample.spoken)
  })
})
