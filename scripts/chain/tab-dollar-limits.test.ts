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
import {
  centsToStroops,
  checkTabTip,
  TAB_PRICE_MAX_AGE_MS,
  tabLimits,
} from '../../convex/lib/chain/tabLedger'
import { checkTabTipAmount } from '../../lib/tab-ui/tip-limits'

withTabEnv()

const DAY_LEDGERS = 17_280

async function setPrice(
  t: Awaited<ReturnType<typeof at>>['t'],
  priceUsd: number,
  fetchedAt?: number
) {
  await t.run(async (ctx) => {
    const p = await ctx.db.query('xlmPriceCache').first()
    await ctx.db.patch(p!._id, {
      priceUsd,
      ...(fetchedAt === undefined ? {} : { fetchedAt }),
    })
  })
}

/** What each read states, and what prepare answers, for one reader. */
async function reads(t: Awaited<ReturnType<typeof at>>['t'], s: Seeded) {
  const reader = as(t, s.readerId)
  return {
    session: (await reader.query(api.balance.session, {}))?.limits ?? null,
    terms: await reader.query(api.balance.publicTipTerms, {}),
    myTab: (await reader.query(api.tabs.getMyTab, {}))?.tipLimits ?? null,
  }
}

type Seeded = Awaited<ReturnType<typeof at>>['s']

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
    expect(
      (await as(t, s.readerId).query(api.tabs.getMyTab, {}))?.tipLimits
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

describe('the settings, the guards and the price', () => {
  it('moves both caps with TAB_TIP_MAX_CENTS and TAB_DAILY_LIMIT_CENTS', async () => {
    vi.stubEnv('TAB_TIP_MAX_CENTS', '300')
    vi.stubEnv('TAB_DAILY_LIMIT_CENTS', '700')
    const { t, s } = await at(0.12)
    const r = await reads(t, s)
    expect(r.session).toMatchObject({ perTipCents: 300, dailyCents: 700 })
    expect(r.terms).toMatchObject({ perTipCents: 300 })
    expect(r.myTab).toMatchObject({ tipMaxCents: 300, dailyLimitCents: 700 })
    expect(await errorCode(prepare(t, s, { cents: 301 }))).toBe(
      'TAB_ABOVE_TIP_MAX'
    )
    await tip(t, s, { cents: 300 })
    await tip(t, s, { cents: 300 })
    expect(await errorCode(prepare(t, s, { cents: 101 }))).toBe(
      'TAB_DAILY_LIMIT'
    )
    await tip(t, s, { cents: 100 })
  })

  for (const name of ['TAB_TIP_MAX_CENTS', 'TAB_DAILY_LIMIT_CENTS'])
    for (const value of ['0', '0500', '5.00', '1000000', '$5'])
      it(`refuses ${name}=${value} everywhere`, async () => {
        vi.stubEnv(name, value)
        const { t, s } = await at(0.12)
        expect(await reads(t, s)).toEqual({
          session: null,
          terms: null,
          myTab: null,
        })
        expect(await errorCode(prepare(t, s, { cents: 100 }))).toBe(
          'TAB_CONFIG_INVALID'
        )
      })

  it('keeps the XLM daily guard when it is below the dollar day', async () => {
    // 10 XLM is $1.20 at $0.12: the guard binds before $20.
    vi.stubEnv('TAB_DAILY_LIMIT', (BigInt(10) * XLM).toString())
    const { t, s } = await at(0.12)
    expect((await reads(t, s)).session).toMatchObject({ dailyCents: 120 })
    await tip(t, s, { cents: 100 })
    expect(await errorCode(prepare(t, s, { cents: 100 }))).toBe(
      'TAB_DAILY_LIMIT'
    )
  })

  it('states the per-tip figure from the XLM guard when it binds', async () => {
    // 2 XLM is 24 cents at $0.12.
    vi.stubEnv('TAB_TIP_MAX', (BigInt(2) * XLM).toString())
    const { t, s } = await at(0.12)
    const r = await reads(t, s)
    expect(r.session).toMatchObject({ perTipCents: 24 })
    expect(r.terms).toMatchObject({ perTipCents: 24 })
    expect(await errorCode(prepare(t, s, { cents: 25 }))).toBe(
      'TAB_ABOVE_TIP_MAX'
    )
    await tip(t, s, { cents: 24 })
  })

  it('bounds a price read far too low by 100 XLM a tip and 400 XLM a day', async () => {
    // At $0.05 the guards equal the dollar limits: $5 and $20 still fit.
    const low = await at(0.05)
    for (let i = 0; i < 4; i++) await tip(low.t, low.s, { cents: 500 })
    // At $0.006, "$5" would be 833 XLM: the 100 XLM guard refuses it.
    const broken = await at(0.006)
    expect(await errorCode(prepare(broken.t, broken.s, { cents: 500 }))).toBe(
      'TAB_ABOVE_TIP_MAX'
    )
    expect(tabLimits({}, 0.006)).toEqual({
      tipMax: BigInt(100) * XLM,
      dailyLimit: BigInt(400) * XLM,
    })
  })

  it('states no limit from a price prepare would refuse as too old', async () => {
    const { t, s } = await at(0.12)
    // A minute inside the age limit: still a price.
    await setPrice(t, 0.12, Date.now() - TAB_PRICE_MAX_AGE_MS + 60_000)
    const fresh = await reads(t, s)
    expect(fresh.session).toMatchObject({ perTipCents: 500 })
    expect(fresh.terms).toMatchObject({
      perTipCents: 500,
      priceMaxAgeMs: TAB_PRICE_MAX_AGE_MS,
    })
    // A minute past it: no read states a limit, and prepare refuses.
    await setPrice(t, 0.12, Date.now() - TAB_PRICE_MAX_AGE_MS - 60_000)
    const stale = await reads(t, s)
    expect(stale.session).toBeNull()
    expect(stale.terms).toBeNull()
    expect(await errorCode(prepare(t, s, { cents: 100 }))).toBe(
      'TAB_PRICE_UNAVAILABLE'
    )
  })

  it('refuses every unusable price with the coded refusal', async () => {
    const { t, s } = await at(0.12)
    const check = (priceUsd: number | null) =>
      errorCode(
        t.run((ctx) =>
          checkTabTip(ctx, {
            userId: s.readerId,
            articleId: s.articleId,
            keyId: 0,
            amount: BigInt(1) * XLM,
            amountCents: 12,
            priceUsd,
            now: Date.now(),
          })
        )
      )
    for (const price of [null, 0, -1, NaN, Infinity, -Infinity])
      expect(await check(price)).toBe('TAB_PRICE_UNAVAILABLE')
    expect(await check(0.12)).toBe('no error')
    // So small a price that the amount overflows: no usable price either.
    expect(
      await errorCode(
        Promise.resolve().then(() => centsToStroops(2000, 1e-300))
      )
    ).toBe('TAB_PRICE_UNAVAILABLE')
    await setPrice(t, 1e-300)
    expect(await errorCode(prepare(t, s, { cents: 100 }))).toBe(
      'TAB_PRICE_UNAVAILABLE'
    )
    // Without a finite price only the XLM guards remain.
    expect(tabLimits({}, Infinity)).toEqual(tabLimits({}, null))
  })

  it('tells the older tip dialog the day in cents, as the server counts it', async () => {
    const check = async (t: Awaited<ReturnType<typeof at>>['t'], s: Seeded) => {
      const tab = (await as(t, s.readerId).query(api.tabs.getMyTab, {}))!
      return checkTabTipAmount({
        cents: 500,
        limits: tab.tipLimits!,
        free: tab.available,
        now: Date.now(),
      })
    }
    // $10 at $0.12, then the price rises: $10 is left, and $5 fits.
    const rise = await at(0.12)
    await tip(rise.t, rise.s, { cents: 500 })
    await tip(rise.t, rise.s, { cents: 500 })
    await setPrice(rise.t, 0.5)
    expect(await check(rise.t, rise.s)).toMatchObject({ ok: true })
    await tip(rise.t, rise.s, { cents: 500 })
    // $20 at $0.50, then the price falls: nothing is left.
    const fall = await at(0.5)
    for (let i = 0; i < 4; i++) await tip(fall.t, fall.s, { cents: 500 })
    await setPrice(fall.t, 0.05)
    expect(await check(fall.t, fall.s)).toMatchObject({
      ok: false,
      reason: 'daily-limit',
      left: '0',
    })
    expect(await errorCode(prepare(fall.t, fall.s, { cents: 500 }))).toBe(
      'TAB_DAILY_LIMIT'
    )
  })

  it('accepts a prepared tip at its quote within 5 minutes, also after the price is gone', async () => {
    const { t, s } = await at(0.12)
    const p = await prepare(t, s, { cents: 500 })
    await t.run(async (ctx) => {
      const price = await ctx.db.query('xlmPriceCache').first()
      await ctx.db.delete(price!._id)
    })
    vi.setSystemTime(Date.now() + 4 * 60 * 1000)
    expect((await submit(t, s, p)).alreadyAccepted).toBe(false)
  })
})
