import { describe, expect, it } from 'vitest'
import {
  addOperation,
  quickTipsOperation,
  readingFromSession,
  type SessionShape,
} from '@/lib/addMoney/operation'
import { keyPlan } from '@/lib/tab-ui/key-plan'

const XLM = 10_000_000

function session(usd: number): SessionShape {
  return {
    userId: 'reader',
    status: 'open',
    tokens: [{ confirmed: String(1000 * XLM), available: String(1000 * XLM) }],
    prices: [{ token: 'xlm', usd, at: 1 }],
    settlement: { enabled: true },
    ledger: { sequence: 100, closedAt: 1 },
  }
}

describe('the approval cap uses the server’s price', () => {
  for (const usd of [0.05, 0.12, 0.5])
    it(`at ${usd} dollars a Lumen, from the session to the key plan`, () => {
      const reading = readingFromSession(session(usd), {
        address: 'G'.padEnd(56, 'A'),
        keys: [],
        device: 'none',
        deviceKeyId: null,
      })
      expect(reading.priceUsd).toBe(usd)
      const add = addOperation(reading, 1000, true)!
      expect(add.priceUsd).toBe(usd)
      const quick = quickTipsOperation(reading)
      expect(quick.priceUsd).toBe(usd)
      // 1000 XLM is above $50 at each price: the cap is $50 of XLM.
      const plan = keyPlan({
        latestLedger: 100,
        tabBalanceAfter: add.balanceAfter,
        priceUsd: add.priceUsd,
      })
      expect(Number(plan.spendLimit)).toBe(
        Math.floor((5000 * XLM) / (usd * 100))
      )
    })

  it('makes no add request without a price', () => {
    const reading = readingFromSession(
      { ...session(0.12), prices: [] },
      { address: null, keys: [], device: null, deviceKeyId: null }
    )
    expect(reading.priceUsd).toBeNull()
    expect(addOperation(reading, 1000, true)).toBeNull()
  })
})
