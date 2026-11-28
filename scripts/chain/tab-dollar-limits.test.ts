/**
 * The limits a reader feels are set in dollars and follow the price: at
 * any price the per-tip cap is $5, the daily limit $20, and the default $1
 * tip fits. The XLM settings stay only as guards against a broken price.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it, vi } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import {
  LEDGER,
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
  setLedger,
  submit,
  tip,
  withTabEnv,
} from './tab-kit'

withTabEnv()

const DAY_LEDGERS = 17_280

async function setPrice(
  t: Awaited<ReturnType<typeof at>>['t'],
  priceUsd: number
) {
  await t.run(async (ctx) => {
    const p = await ctx.db.query('xlmPriceCache').first()
    await ctx.db.patch(p!._id, { priceUsd })
  })
}

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

  it('computes no limit without a price: tipping is paused, never priced by the XLM guard', async () => {
    const { t, s } = await at(0.12)
    await t.run(async (ctx) => {
      const p = await ctx.db.query('xlmPriceCache').first()
      await ctx.db.delete(p!._id)
    })
    const reader = as(t, s.readerId)
    expect((await reader.query(api.balance.session, {}))?.limits).toBeNull()
    expect(await reader.query(api.balance.publicTipTerms, {})).toBeNull()
    expect(
      (await reader.query(api.tabs.getMyTab, {}))?.tipLimits?.tipMaxCents
    ).toBeNull()
    expect(await errorCode(prepare(t, s, { cents: 100 }))).toBe(
      'TAB_PRICE_UNAVAILABLE'
    )
  })

  it('checks a submit at the price the tip was quoted at, not today’s', async () => {
    const { t, s } = await at(0.12)
    const five = await prepare(t, s, { cents: 500 })
    // The price moves between prepare and submit, both ways.
    await setPrice(t, 0.5)
    await submit(t, s, five)
    const again = await prepare(t, s, { cents: 500 })
    await setPrice(t, 0.05)
    await submit(t, s, again)
    expect(await errorCode(prepare(t, s, { cents: 501 }))).toBe(
      'TAB_ABOVE_TIP_MAX'
    )
  })

  it('counts the day in cents, so a price move during the day changes nothing', async () => {
    const { t, s } = await at(0.12)
    await tip(t, s, { cents: 500 })
    await tip(t, s, { cents: 500 })
    // $10 so far. At a higher price the XLM already spent is worth more,
    // but the day's dollars stay $10: two more $5 tips fit, then no more.
    await setPrice(t, 0.5)
    expect(
      (await as(t, s.readerId).query(api.balance.session, {}))?.limits
    ).toMatchObject({ acceptedTodayCents: 1000 })
    await tip(t, s, { cents: 500 })
    await setPrice(t, 0.05)
    await tip(t, s, { cents: 500 })
    expect(await errorCode(prepare(t, s, { cents: 10 }))).toBe(
      'TAB_DAILY_LIMIT'
    )
  })

  it('reads an account from before the cents total at the tip price, then counts in cents', async () => {
    const { t, s } = await at(0.12)
    // $18 accepted today, recorded only in base units (150 XLM at $0.12).
    await t.run(async (ctx) => {
      const account = await ctx.db.query('tabAccounts').first()
      await ctx.db.patch(account!._id, {
        acceptedDay: new Date().toISOString().slice(0, 10),
        acceptedToday: (BigInt(150) * XLM).toString(),
        acceptedTodayCents: undefined,
      })
    })
    expect(
      (await as(t, s.readerId).query(api.balance.session, {}))?.limits
    ).toMatchObject({ acceptedTodayCents: 1800 })
    expect(await errorCode(prepare(t, s, { cents: 500 }))).toBe(
      'TAB_DAILY_LIMIT'
    )
    await tip(t, s, { cents: 200 })
    const account = await t.run((ctx) => ctx.db.query('tabAccounts').first())
    expect(account?.acceptedTodayCents).toBe(2000)
    expect(await errorCode(prepare(t, s, { cents: 1 }))).toBe('TAB_DAILY_LIMIT')
  })

  it('starts each UTC day at zero, in cents as in base units', async () => {
    vi.setSystemTime(Date.UTC(2026, 11, 2, 23, 50))
    const { t, s } = await at(0.12)
    for (let i = 0; i < 4; i++) await tip(t, s, { cents: 500 })
    expect(await errorCode(prepare(t, s, { cents: 500 }))).toBe(
      'TAB_DAILY_LIMIT'
    )
    // A new UTC day: the day's total starts again.
    vi.setSystemTime(Date.UTC(2026, 11, 3, 0, 0, 30))
    await setLedger(t, LEDGER + DAY_LEDGERS)
    await t.run(async (ctx) => {
      const p = await ctx.db.query('xlmPriceCache').first()
      await ctx.db.patch(p!._id, { fetchedAt: Date.now() })
    })
    await tip(t, s, { cents: 500 })
    const account = await t.run((ctx) => ctx.db.query('tabAccounts').first())
    expect(account).toMatchObject({
      acceptedDay: '2026-12-03',
      acceptedTodayCents: 500,
    })
  })
})
