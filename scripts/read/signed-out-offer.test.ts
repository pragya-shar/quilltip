import { describe, expect, it } from 'vitest'
import { signedOutOfferFor } from '@/hooks/read/payments'

const shown = (offer: ReturnType<typeof signedOutOfferFor>) =>
  offer && {
    amount: offer.amount.display,
    amounts: offer.amounts.map((a) => a.display),
  }

describe('the signed-out offer follows the ladder rule', () => {
  it('a low cap (about 64¢) offers 10¢, 25¢ and 50¢, from the smallest', () => {
    expect(shown(signedOutOfferFor({ minCents: 10, perTipCents: 64 }))).toEqual(
      {
        amount: '$0.10',
        amounts: ['$0.10', '$0.25', '$0.50'],
      }
    )
  })

  it('a high cap offers the largest four, with $1 by default', () => {
    expect(
      shown(signedOutOfferFor({ minCents: 10, perTipCents: 1000 }))
    ).toEqual({ amount: '$1', amounts: ['$1', '$2', '$3', '$5'] })
  })

  it('never offers a raw ceiling, and offers nothing when no rung fits', () => {
    const offer = signedOutOfferFor({ minCents: 10, perTipCents: 99 })
    expect(offer!.amounts.map((a) => a.cents)).toEqual([10, 25, 50])
    expect(signedOutOfferFor({ minCents: 10, perTipCents: 9 })).toBeNull()
  })
})
