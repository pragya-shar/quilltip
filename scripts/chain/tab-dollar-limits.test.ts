/**
 * The limits a reader feels are set in dollars and follow the price: at
 * any price the per-tip cap is $5, the daily limit $20, and the default $1
 * tip fits. The XLM settings stay only as guards against a broken price.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import {
  READER,
  VALID_UNTIL,
  XLM,
  as,
  errorCode,
  ev,
  ingest,
  modules,
  prepare,
  seed,
  tip,
  withTabEnv,
} from './tab-kit'

withTabEnv()

async function at(priceUsd: number) {
  const t = convexTest(schema, modules)
  const s = await seed(t, { open: false })
  await t.run(async (ctx) => {
    const p = await ctx.db.query('xlmPriceCache').first()
    await ctx.db.patch(p!._id, { priceUsd })
  })
  await ingest(
    t,
    ev.deposited(READER, BigInt(1000) * XLM, BigInt(1000) * XLM),
    ev.keyRegistered(READER, 0, VALID_UNTIL, BigInt(1000) * XLM)
  )
  return { t, s }
}

describe('limits a reader feels are in dollars, at any price', () => {
  for (const priceUsd of [0.05, 0.12, 0.5])
    it(`at ${priceUsd} dollars a Lumen: $5 per tip, $20 a day, and $1 is accepted`, async () => {
      const { t, s } = await at(priceUsd)
      const reader = as(t, s.readerId)
      expect(
        (await reader.query(api.balance.session, {}))?.limits
      ).toMatchObject({
        perTipCents: 500,
        dailyCents: 2000,
        defaultTipCents: 100,
      })
      expect(
        (await reader.query(api.balance.publicTipTerms, {}))?.perTipCents
      ).toBe(500)
      expect(
        (await reader.query(api.tabs.getMyTab, {}))?.tipLimits?.tipMaxCents
      ).toBe(500)
      await tip(t, s, { cents: 100 })
      expect(await errorCode(prepare(t, s, { cents: 501 }))).toBe(
        'TAB_ABOVE_TIP_MAX'
      )
      await tip(t, s, { cents: 500 })
    })

  it('keeps an XLM setting as a guard when it is lower than the dollar cap', async () => {
    process.env.TAB_TIP_MAX = String(BigInt(2) * XLM)
    try {
      // $1 a Lumen: the 2 XLM guard is $2, below the $5 cap.
      const { t, s } = await at(1)
      expect(await errorCode(prepare(t, s, { cents: 201 }))).toBe(
        'TAB_ABOVE_TIP_MAX'
      )
      await tip(t, s, { cents: 200 })
    } finally {
      delete process.env.TAB_TIP_MAX
    }
  })

  it('stops a day at $20, whatever the price', async () => {
    const { t, s } = await at(0.05)
    for (let i = 0; i < 4; i++) await tip(t, s, { cents: 500 })
    expect(await errorCode(prepare(t, s, { cents: 100 }))).toBe(
      'TAB_DAILY_LIMIT'
    )
  })
})
