import { describe, expect, it } from 'vitest'
import {
  FEE_MARGIN_STROOPS,
  amountOffer,
  checkOther,
  depositStroops,
  parseDollars,
} from '@/lib/addMoney/amounts'

const XLM = BigInt(10_000_000)
const xlm = (n: number) => (BigInt(n) * XLM).toString()
// $0.10 a Lumen: 10 XLM is $1.
const base = {
  priceUsd: 0.1,
  balance: '0',
  limits: { minDeposit: xlm(10), maxBalance: xlm(1000) },
  spendable: xlm(10_000),
}

describe('the amounts offered', () => {
  it('shows the segments inside the range, then Other', () => {
    const offer = amountOffer(base)
    expect(offer).toMatchObject({
      kind: 'amounts',
      // The floor is 10 XLM = $1.00; a quarter above it, in whole dollars.
      minCents: 200,
      maxCents: 10_000,
      segments: [1000, 2000, 5000],
      other: true,
      chosen: 1000,
      walletLimited: false,
    })
  })

  it('chooses the segment that covers the tip', () => {
    expect(amountOffer({ ...base, needCents: 1500 })).toMatchObject({
      chosen: 2000,
    })
    expect(amountOffer({ ...base, needCents: 100 })).toMatchObject({
      chosen: 1000,
    })
  })

  it('leaves out amounts the wallet cannot spend, keeping a margin for the fee', () => {
    // 150 XLM spendable, less the margin: about $14.99.
    const offer = amountOffer({ ...base, spendable: xlm(150) })
    expect(offer).toMatchObject({
      kind: 'amounts',
      segments: [1000],
      walletLimited: true,
    })
    if (offer.kind !== 'amounts') throw new Error()
    expect(offer.maxCents).toBe(
      Math.floor(
        (Number(BigInt(xlm(150)) - FEE_MARGIN_STROOPS) / 1e7) * 0.1 * 100
      )
    )
  })

  it('leaves out amounts the balance has no room for', () => {
    const offer = amountOffer({ ...base, balance: xlm(850) })
    expect(offer).toMatchObject({ segments: [1000], maxCents: 1500 })
  })

  it('says the wallet is short when it cannot cover the smallest deposit', () => {
    expect(amountOffer({ ...base, spendable: xlm(5) })).toMatchObject({
      kind: 'wallet-short',
      spendable: xlm(5),
      spendableCents: 50,
    })
    // An account that does not exist yet can spend nothing.
    expect(amountOffer({ ...base, spendable: '0' })).toMatchObject({
      kind: 'wallet-short',
    })
  })

  it('says the balance is full when it cannot take the smallest whole-dollar amount', () => {
    // 15 XLM of room is $1.50, below the $2 smallest amount.
    expect(amountOffer({ ...base, balance: xlm(985) })).toMatchObject({
      kind: 'full',
    })
  })

  it('says the balance is full at its limit', () => {
    expect(amountOffer({ ...base, balance: xlm(995) })).toEqual({
      kind: 'full',
      maxBalanceCents: 10_000,
    })
  })

  it('offers no amount without a price or the limits', () => {
    expect(amountOffer({ ...base, priceUsd: null })).toEqual({
      kind: 'price-unknown',
    })
    expect(amountOffer({ ...base, limits: null })).toEqual({
      kind: 'limits-unknown',
    })
  })

  it('makes the smallest amount a whole dollar a quarter above the floor', () => {
    // 10 XLM at $0.1273 is $1.273; a quarter above is $1.59: the smallest is $2.
    const offer = amountOffer({ ...base, priceUsd: 0.1273 })
    if (offer.kind !== 'amounts') throw new Error()
    expect(offer.minCents).toBe(200)
    // At $0.50 the floor is $5.00; a quarter above is $6.25: $7.
    const high = amountOffer({ ...base, priceUsd: 0.5 })
    if (high.kind !== 'amounts') throw new Error()
    expect(high.minCents).toBe(700)
    expect(
      BigInt(depositStroops(offer.minCents, 0.1273))
    ).toBeGreaterThanOrEqual(BigInt(xlm(10)))
  })
})

describe('a typed amount', () => {
  it('reads dollars with up to two decimals', () => {
    expect(parseDollars('12')).toBe(1200)
    expect(parseDollars('$12.5')).toBe(1250)
    expect(parseDollars('12,05')).toBe(1205)
    expect(parseDollars('0')).toBeNull()
    expect(parseDollars('1.234')).toBeNull()
    expect(parseDollars('abc')).toBeNull()
  })

  it('is checked against the range', () => {
    const offer = amountOffer(base)
    if (offer.kind !== 'amounts') throw new Error()
    expect(checkOther(null, offer)).toBe('empty')
    expect(checkOther(199, offer)).toBe('below')
    expect(checkOther(10_001, offer)).toBe('above')
    expect(checkOther(2500, offer)).toBeNull()
  })
})
