import { describe, expect, it } from 'vitest'
import { defaultChoice, tipChoices } from '@/lib/payments/views'
import { tipAmount } from '@/lib/payments/money'
import { keyPlan } from '@/lib/tab-ui/key-plan'

const XLM = 10_000_000

describe('the tip opens at $1 at any price', () => {
  for (const priceUsd of [0.05, 0.12, 0.5])
    it(`at ${priceUsd} dollars a Lumen`, () => {
      // The server's figures at this price: the cap is $5 (500 cents).
      const { amounts } = tipChoices({
        minCents: 1,
        perTipCents: 500,
        dailyLeftCents: 2000,
        spendableCents: 1000,
      })
      const cents = defaultChoice(amounts)
      expect(cents).toBe(100)
      expect(tipAmount(cents!).short).toBe('$1')
    })
})

describe('a device approval is capped at $50 of XLM, or the balance', () => {
  for (const priceUsd of [0.05, 0.12, 0.5])
    it(`at ${priceUsd} dollars a Lumen`, () => {
      const cap = Math.floor((5000 * XLM) / (priceUsd * 100))
      const big = keyPlan({
        latestLedger: 1,
        tabBalanceAfter: String(10_000 * XLM),
        priceUsd,
      })
      expect(Number(big.spendLimit)).toBe(cap)
      // A $10 deposit: the cap is the balance, ten $1 tips.
      const ten = Math.floor((1000 * XLM) / (priceUsd * 100))
      expect(
        keyPlan({ latestLedger: 1, tabBalanceAfter: String(ten), priceUsd })
          .spendLimit
      ).toBe(String(ten))
    })

  it('falls back to 50 XLM with no price', () => {
    expect(
      keyPlan({ latestLedger: 1, tabBalanceAfter: String(1000 * XLM) })
        .spendLimit
    ).toBe(String(50 * XLM))
  })
})
