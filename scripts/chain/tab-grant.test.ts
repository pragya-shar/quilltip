/// <reference types="vite/client" />
/**
 * Practice money in the tab ledger: the gift from `SessionGranted` and
 * `GiftGranted`, a granted key's cap raised by `GrantKeyRaised`, a granted
 * key that spends at most the gift, gift spent first on settlement, and a
 * withdrawal that leaves the gift.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { Keypair } from '@stellar/stellar-sdk'
import schema from '../../convex/schema'
import {
  READER,
  VALID_UNTIL,
  XLM,
  account,
  errorCode,
  ev,
  i128,
  ingest,
  modules,
  prepare,
  seed,
  submit,
  tabEvent,
  tip,
  u32,
  withTabEnv,
} from './tab-kit'

withTabEnv()

const FUNDER = Keypair.random().publicKey()
const GIFT = BigInt(5) * XLM
/** A granted key's cap is the whole gift. */
const CAP = GIFT

const sessionGranted = (
  keyId: number,
  amount: bigint,
  giftAfter: bigint,
  spendLimit = CAP
) =>
  tabEvent(
    'session_granted',
    [FUNDER, READER],
    [
      ['key_id', u32(keyId)],
      ['amount', i128(amount)],
      ['spend_limit', i128(spendLimit)],
      ['gift_after', i128(giftAfter)],
    ]
  )
const grantKeyRaised = (keyId: number, spendLimit: bigint) =>
  tabEvent(
    'grant_key_raised',
    [READER],
    [
      ['key_id', u32(keyId)],
      ['spend_limit', i128(spendLimit)],
    ]
  )
const giftGranted = (amount: bigint, giftAfter: bigint) =>
  tabEvent(
    'gift_granted',
    [FUNDER, READER],
    [
      ['amount', i128(amount)],
      ['gift_after', i128(giftAfter)],
    ]
  )

/** A newcomer: the events `grant_session` publishes, in order. */
async function granted(t: ReturnType<typeof convexTest>) {
  const s = await seed(t, { open: false })
  await ingest(
    t,
    ev.deposited(READER, GIFT, GIFT),
    ev.keyRegistered(READER, 0, VALID_UNTIL, CAP),
    sessionGranted(0, GIFT, GIFT)
  )
  return s
}

async function keyRow(t: ReturnType<typeof convexTest>, keyId: number) {
  return t.run(
    async (ctx) =>
      (await ctx.db.query('tabSessionKeys').collect()).find(
        (k) => k.keyId === keyId
      )!
  )
}

describe('the gift in the ledger', () => {
  it('records the gift and marks the granted key', async () => {
    const t = convexTest(schema, modules)
    await granted(t)
    const a = await account(t)
    expect(a.confirmedBalance).toBe(GIFT.toString())
    expect(a.gift).toBe(GIFT.toString())
    expect((await keyRow(t, 0)).granted).toBe(true)
  })

  it('adds practice money again with GiftGranted', async () => {
    const t = convexTest(schema, modules)
    await granted(t)
    await ingest(
      t,
      ev.deposited(READER, GIFT, GIFT * BigInt(2)),
      giftGranted(GIFT, GIFT * BigInt(2))
    )
    expect((await account(t)).gift).toBe((GIFT * BigInt(2)).toString())
  })

  it('spends gift first when tips settle: all of a granted tip, the gift part of an own-key tip', async () => {
    const t = convexTest(schema, modules)
    await granted(t)
    await ingest(t, ev.keyRegistered(READER, 1))
    await ingest(
      t,
      ev.tabSettled({ keyId: 0, cumulative: CAP, paidAfter: CAP, gross: CAP })
    )
    expect((await account(t)).gift).toBe((GIFT - CAP).toString())
    // An own-key tip larger than the gift left empties it, not below zero.
    const big = BigInt(9) * XLM
    await ingest(
      t,
      ev.deposited(READER, BigInt(10) * XLM, GIFT - CAP + BigInt(10) * XLM)
    )
    await ingest(
      t,
      ev.tabSettled({ keyId: 1, cumulative: big, paidAfter: big, gross: big })
    )
    expect((await account(t)).gift).toBe('0')
  })

  it('leaves the gift in the balance after a withdrawal, and the account open', async () => {
    const t = convexTest(schema, modules)
    await granted(t)
    const own = BigInt(3) * XLM
    await ingest(t, ev.deposited(READER, own, GIFT + own))
    await ingest(
      t,
      ev.withdrawStarted(GIFT + own, 9_000_000),
      ev.withdrawn(own)
    )
    const a = await account(t)
    expect(a.confirmedBalance).toBe(GIFT.toString())
    expect(a.status).toBe('OPEN')
  })

  it('closes an account with no gift on withdrawal, as before', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    await ingest(
      t,
      ev.withdrawStarted(BigInt(10) * XLM, 9_000_000),
      ev.withdrawn(BigInt(10) * XLM)
    )
    const a = await account(t)
    expect(a.confirmedBalance).toBe('0')
    expect(a.status).toBe('CLOSED')
  })
})

describe('acceptance with a granted key', () => {
  it('accepts tips under a granted key up to the whole gift', async () => {
    const t = convexTest(schema, modules)
    const s = await granted(t)
    // At $1 per XLM, the $5 gift covers $5 of tips. With no own money the
    // balance refuses first; the cap is the same amount.
    for (let i = 0; i < 5; i++) await tip(t, s, { cents: 100 })
    expect(await errorCode(tip(t, s, { cents: 1 }))).toBe('TAB_OVER_BALANCE')
  })

  it('refuses a granted-key tip larger than the gift left after accepted tips', async () => {
    const t = convexTest(schema, modules)
    const s = await granted(t)
    await ingest(t, ev.keyRegistered(READER, 1))
    // Own money too, so the balance is not what refuses.
    await ingest(
      t,
      ev.deposited(READER, BigInt(10) * XLM, GIFT + BigInt(10) * XLM)
    )
    // An own-key tip of $4.50 is accepted first and spends gift first.
    await tip(t, s, { cents: 450, keyId: 1 })
    expect(await errorCode(tip(t, s, { cents: 100, keyId: 0 }))).toBe(
      'TAB_OVER_GIFT'
    )
    // The own key still tips from own money.
    await tip(t, s, { cents: 100, keyId: 1 })
  })

  it('a second gift raises the same key, so tipping goes on with no approval', async () => {
    const t = convexTest(schema, modules)
    const s = await granted(t)
    for (let i = 0; i < 5; i++) await tip(t, s, { cents: 100 })
    expect(await errorCode(tip(t, s, { cents: 100 }))).toBe('TAB_OVER_BALANCE')
    await ingest(
      t,
      ev.deposited(READER, GIFT, GIFT * BigInt(2)),
      grantKeyRaised(0, GIFT * BigInt(2)),
      giftGranted(GIFT, GIFT * BigInt(2))
    )
    expect((await keyRow(t, 0)).spendLimit).toBe((GIFT * BigInt(2)).toString())
    await tip(t, s, { cents: 100 })
  })

  it('applies a raised cap once and never lowers it', async () => {
    const t = convexTest(schema, modules)
    await granted(t)
    await ingest(t, grantKeyRaised(0, GIFT * BigInt(3)))
    await ingest(t, grantKeyRaised(0, GIFT * BigInt(2)))
    expect((await keyRow(t, 0)).spendLimit).toBe((GIFT * BigInt(3)).toString())
  })

  it('a tip accepted before a withdrawal keeps its claim on the gift: the mirror never lets the gift go twice', async () => {
    const t = convexTest(schema, modules)
    const s = await granted(t)
    await ingest(t, ev.keyRegistered(READER, 1))
    const own = BigInt(10) * XLM
    await ingest(t, ev.deposited(READER, own, GIFT + own))
    // An own-key tip of $4.50 is accepted, not settled yet.
    await tip(t, s, { cents: 450, keyId: 1 })
    // The withdrawal pays the reader's own money; the gift stays.
    await ingest(
      t,
      ev.withdrawStarted(GIFT + own, 9_000_000),
      ev.withdrawn(own)
    )
    const a = await account(t)
    expect(a.confirmedBalance).toBe(GIFT.toString())
    expect(a.gift).toBe(GIFT.toString())
    // The accepted tip still holds its part of the gift: a granted-key tip
    // may take only what is left ($0.50), never the $4.50 again. (The
    // balance check refuses first here; the gift check would too.)
    expect(await errorCode(tip(t, s, { cents: 100, keyId: 0 }))).toBe(
      'TAB_OVER_BALANCE'
    )
    await tip(t, s, { cents: 50, keyId: 0 })
    // The accepted tip then settles from the gift, as the contract does.
    const paid = (BigInt(450) * XLM) / BigInt(100)
    await ingest(
      t,
      ev.tabSettled({
        keyId: 1,
        cumulative: paid,
        paidAfter: paid,
        gross: paid,
      })
    )
    expect((await account(t)).gift).toBe((GIFT - paid).toString())
  })

  it('keeps a prepared tip valid until submit', async () => {
    const t = convexTest(schema, modules)
    const s = await granted(t)
    const p = await prepare(t, s, { cents: 100 })
    await submit(t, s, p)
    expect((await keyRow(t, 0)).acceptedTotal).not.toBe('0')
  })
})
