/// <reference types="vite/client" />
/**
 * Practice money limits (convex/practiceStore.ts): the two limits (once a day
 * per account, a daily treasury budget), the order (one first grant, gifts
 * after it), a gift raising only a live granted key, and the pending rules:
 * a failed grant gives its budget back, a sent or hashed one never fails
 * without the network's answer. The sign-in gate of the actions too.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import { createHash } from 'node:crypto'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

const modules = import.meta.glob('../../convex/**/*.ts')
const PASSPHRASE = 'Test SDF Network ; September 2015'
const NOW = Date.UTC(2026, 10, 28, 12)
const DAY = 86_400_000
type T = ReturnType<typeof convexTest>

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

async function user(
  t: T,
  address: string | null = StrKey.encodeContract(
    Buffer.from(hash(Math.random().toString()), 'hex')
  )
) {
  return t.run((ctx) =>
    ctx.db.insert('users', {
      username: `u${Math.random().toString(16).slice(2, 10)}`,
      email: `${Math.random().toString(16).slice(2)}@example.test`,
      stellarAddress: address,
      stellarAddressVerifiedAt: NOW,
      stellarAddressVerifiedNetwork: PASSPHRASE,
      createdAt: NOW,
      updatedAt: NOW,
    })
  )
}

const AMOUNT = BigInt(392_772_977)
const LEDGER = 1_000_000
const EPOCH = 'testnet-epoch'

const args = (
  userId: Id<'users'>,
  o: {
    kind?: 'session' | 'gift'
    now?: number
    budget?: bigint
    latestLedger?: number
  } = {}
) => ({
  userId,
  kind: o.kind ?? ('gift' as const),
  amount: AMOUNT.toString(),
  passphrase: PASSPHRASE,
  chainEpoch: EPOCH,
  latestLedger: o.latestLedger ?? LEDGER,
  dailyBudgetStroops: (o.budget ?? AMOUNT * BigInt(100)).toString(),
  now: o.now ?? NOW,
})

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ALLOWED'
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e)
  }
}

const reserve = (t: T, a: ReturnType<typeof args>) =>
  t.mutation(internal.practiceStore.reserve, a)

/** A reader whose first grant was sent, with key 0 indexed as granted. */
async function started(
  t: T,
  key: { revoked?: boolean; validUntilLedger?: number; granted?: boolean } = {}
) {
  const id = await user(t)
  const r = await reserve(t, args(id, { kind: 'session', now: NOW - DAY }))
  await t.mutation(internal.practiceStore.finish, {
    grantId: r.grantId,
    txHash: 'first',
    keyId: 0,
    now: NOW - DAY,
  })
  await t.run(async (ctx) => {
    const acct = await ctx.db.insert('tabAccounts', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      userId: id,
      readerAddress: r.reader,
      tabContractId: StrKey.encodeContract(Buffer.alloc(32, 7)),
      settledSinceBalance: [],
      confirmedBalance: AMOUNT.toString(),
      outstanding: '0',
      acceptedToday: '0',
      acceptedDay: '2026-11-27',
      status: 'OPEN',
      pendingKeys: [],
      createdAt: NOW,
      updatedAt: NOW,
    })
    await ctx.db.insert('tabSessionKeys', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      tabAccountId: acct,
      keyId: 0,
      publicKey: 'ab'.repeat(32),
      validUntilLedger: key.validUntilLedger ?? LEDGER + 7 * 17_280,
      spendLimit: AMOUNT.toString(),
      spentOnChain: '0',
      acceptedTotal: '0',
      revoked: key.revoked ?? false,
      extractable: false,
      granted: key.granted ?? true,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })
  return id
}

const given = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query('practiceDays').collect())[0])

describe('practice money limits', () => {
  it('refuses the actions to a stranger', async () => {
    const t = convexTest(schema, modules)
    expect(
      await code(
        t.action(api.practice.grantFirst, { devicePublicKey: 'ab'.repeat(32) })
      )
    ).toBe('NOT_SIGNED_IN')
    expect(await code(t.action(api.practice.grantDaily, {}))).toBe(
      'NOT_SIGNED_IN'
    )
  })

  it('serves a passkey account only', async () => {
    const t = convexTest(schema, modules)
    for (const id of [
      await user(t, Keypair.random().publicKey()),
      await user(t, null),
    ]) {
      expect(await code(reserve(t, args(id, { kind: 'session' })))).toBe(
        'PRACTICE_NOT_PASSKEY'
      )
    }
  })

  it('gives the first grant once, ever, and a gift only after it was sent', async () => {
    const t = convexTest(schema, modules)
    const id = await user(t)
    expect(await code(reserve(t, args(id)))).toBe('PRACTICE_NOT_STARTED')
    const r = await reserve(t, args(id, { kind: 'session' }))
    expect(
      await code(reserve(t, args(id, { kind: 'session', now: NOW + 3 * DAY })))
    ).toBe('PRACTICE_ALREADY_STARTED')
    // Still pending: no gift yet.
    expect(await code(reserve(t, args(id, { now: NOW + DAY })))).toBe(
      'PRACTICE_NOT_STARTED'
    )
    await t.mutation(internal.practiceStore.finish, {
      grantId: r.grantId,
      txHash: 'h',
      keyId: 0,
      now: NOW,
    })
    expect(await code(reserve(t, args(id, { now: NOW + DAY })))).toBe('ALLOWED')
  })

  it('once a day per account, again the next day', async () => {
    const t = convexTest(schema, modules)
    const id = await started(t)
    expect(await code(reserve(t, args(id)))).toBe('ALLOWED')
    expect(await code(reserve(t, args(id)))).toBe('PRACTICE_TODAY_USED')
    expect(await code(reserve(t, args(id, { now: NOW + DAY })))).toBe('ALLOWED')
  })

  it('no other limit: many days in a row, and many accounts on one day', async () => {
    const t = convexTest(schema, modules)
    const id = await started(t)
    for (let d = 0; d < 40; d++) {
      expect(await code(reserve(t, args(id, { now: NOW + d * DAY })))).toBe(
        'ALLOWED'
      )
    }
    for (let i = 0; i < 5; i++) {
      expect(
        await code(reserve(t, args(await user(t), { kind: 'session' })))
      ).toBe('ALLOWED')
    }
  })

  it('a daily treasury budget for everyone', async () => {
    const t = convexTest(schema, modules)
    const budget = AMOUNT * BigInt(2)
    for (let i = 0; i < 2; i++) {
      expect(
        await code(reserve(t, args(await user(t), { kind: 'session', budget })))
      ).toBe('ALLOWED')
    }
    expect(
      await code(reserve(t, args(await user(t), { kind: 'session', budget })))
    ).toBe('PRACTICE_BUSY')
    expect((await given(t))?.givenStroops).toBe(budget.toString())
    // The next day has its own budget.
    expect(
      await code(
        reserve(
          t,
          args(await user(t), { kind: 'session', budget, now: NOW + DAY })
        )
      )
    ).toBe('ALLOWED')
  })

  it('a failed grant gives its budget and its day back; a pending one keeps both', async () => {
    const t = convexTest(schema, modules)
    const id = await started(t)
    const r = await reserve(t, args(id))
    await t.mutation(internal.practiceStore.fail, {
      grantId: r.grantId,
      error: 'SPONSOR_SIMULATION_FAILED',
      now: NOW,
    })
    const today = async () =>
      t.run(async (ctx) =>
        (await ctx.db.query('practiceDays').collect()).find(
          (d) => d.day === '2026-11-28'
        )
      )
    expect((await today())?.givenStroops).toBe('0')
    const again = await reserve(t, args(id))
    expect(await code(reserve(t, args(id)))).toBe('PRACTICE_TODAY_USED')
    expect((await today())?.givenStroops).toBe(AMOUNT.toString())
    expect(again.grantId).toBeDefined()
  })

  it('never fails a sent grant, nor a hashed one without force', async () => {
    const t = convexTest(schema, modules)
    const id = await started(t)
    const r = await reserve(t, args(id))
    await t.mutation(internal.practiceStore.markSigned, {
      grantId: r.grantId,
      txHash: 'h',
      maxTime: Math.floor(NOW / 1000) + 120,
      now: NOW,
    })
    await t.mutation(internal.practiceStore.fail, {
      grantId: r.grantId,
      error: 'SPONSOR_PENDING',
      now: NOW,
    })
    expect((await t.run((ctx) => ctx.db.get(r.grantId)))?.status).toBe(
      'pending'
    )
    await t.mutation(internal.practiceStore.finish, {
      grantId: r.grantId,
      txHash: 'h',
      now: NOW,
    })
    await t.mutation(internal.practiceStore.fail, {
      grantId: r.grantId,
      error: 'late',
      force: true,
      now: NOW,
    })
    expect((await t.run((ctx) => ctx.db.get(r.grantId)))?.status).toBe('sent')
  })

  it('records a signed grant once: hash and time bound, only while unsigned', async () => {
    const t = convexTest(schema, modules)
    const r = await reserve(t, args(await user(t), { kind: 'session' }))
    const sign = () =>
      t.mutation(internal.practiceStore.markSigned, {
        grantId: r.grantId,
        txHash: 'h1',
        maxTime: 1_800_000_000,
        now: NOW,
      })
    await sign()
    expect(await code(sign())).toBe('PRACTICE_BAD_STATE')
    expect(await t.run((ctx) => ctx.db.get(r.grantId))).toMatchObject({
      txHash: 'h1',
      maxTime: 1_800_000_000,
    })
  })

  it('lists open grants for the reconciler from any day, with or without a hash', async () => {
    const t = convexTest(schema, modules)
    const old = NOW - 3 * DAY
    const a = await reserve(
      t,
      args(await user(t), { kind: 'session', now: old })
    )
    const b = await reserve(t, args(await user(t), { kind: 'session' }))
    await t.mutation(internal.practiceStore.markSigned, {
      grantId: b.grantId,
      txHash: 'hb',
      maxTime: Math.floor(NOW / 1000) + 120,
      now: NOW,
    })
    const open = await t.query(internal.practiceStore.openGrants, {
      now: NOW + 60_000,
      olderThanMs: 30_000,
    })
    expect(open.map((s) => s.txHash).sort()).toEqual([null, 'hb'].sort())
    expect(open.find((s) => s.grantId === a.grantId)?.kind).toBe('session')
  })
})

describe('a gift raises the granted key', () => {
  it('raises a live granted key', async () => {
    const t = convexTest(schema, modules)
    const id = await started(t)
    expect((await reserve(t, args(id))).raiseKeyId).toBe(0)
  })

  it('does not raise a revoked, ending or own key: the gift comes with no key', async () => {
    const t = convexTest(schema, modules)
    for (const key of [
      { revoked: true },
      { validUntilLedger: LEDGER + 30 },
      { granted: false },
    ]) {
      const id = await started(t, key)
      expect((await reserve(t, args(id))).raiseKeyId).toBeNull()
    }
  })
})
