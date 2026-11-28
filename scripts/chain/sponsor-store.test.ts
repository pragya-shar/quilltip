/// <reference types="vite/client" />
/**
 * The fee sponsor's records (convex/sponsorStore.ts) and the sign-in gate of
 * its public actions (convex/sponsor.ts): threats T1, T5, T6, T8, T9 and T10
 * of the sponsor's threat list.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  PER_USER_PER_DAY,
  PER_USER_PER_HOUR,
  REQUEST_TTL_MS,
} from '../../convex/lib/sponsor/policy'

const modules = import.meta.glob('../../convex/**/*.ts')
const PASSPHRASE = 'Test SDF Network ; September 2015'
const PASSKEY = StrKey.encodeContract(Buffer.alloc(32, 7))
const NOW = Date.UTC(2026, 10, 28, 12)
const BUDGET = '20000000000'

type T = ReturnType<typeof convexTest>

async function user(
  t: T,
  address: string | null,
  verified = true
): Promise<Id<'users'>> {
  return t.run((ctx) =>
    ctx.db.insert('users', {
      username: `u${Math.random().toString(16).slice(2, 10)}`,
      email: `${Math.random().toString(16).slice(2)}@example.test`,
      stellarAddress: address,
      ...(verified
        ? {
            stellarAddressVerifiedAt: NOW,
            stellarAddressVerifiedNetwork: PASSPHRASE,
          }
        : {}),
      createdAt: NOW,
      updatedAt: NOW,
    })
  )
}

const reserveArgs = (userId: Id<'users'>, now = NOW) => ({
  userId,
  call: 'deposit' as const,
  amount: '78554595',
  key: null,
  keyId: null,
  passphrase: PASSPHRASE,
  dailyBudgetStroops: BUDGET,
  now,
})

async function prepared(t: T, userId: Id<'users'>, now = NOW) {
  const { requestId } = await t.mutation(
    internal.sponsorStore.reserve,
    reserveArgs(userId, now)
  )
  await t.mutation(internal.sponsorStore.recordPrepared, {
    requestId,
    entries: ['AAAA'],
    maxExpiration: 1000,
    feeStroops: '1000',
    now,
  })
  return requestId
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ALLOWED'
  } catch (e) {
    const data = (e as { data?: { code?: string } }).data
    return data?.code ?? String((e as Error).message)
  }
}

describe('who the sponsor serves', () => {
  it('T1: refuses a stranger at both public actions', async () => {
    const t = convexTest(schema, modules)
    expect(
      await code(
        t.action(api.sponsor.prepare, {
          call: 'deposit',
          amount: '1',
          key: null,
          keyId: null,
        })
      )
    ).toBe('NOT_SIGNED_IN')
    expect(
      await code(
        t.action(api.sponsor.submit, { requestId: 'x', signedEntries: [] })
      )
    ).toBe('NOT_SIGNED_IN')
  })

  it('serves a verified passkey account and binds the request to it', async () => {
    const t = convexTest(schema, modules)
    const id = await user(t, PASSKEY)
    const r = await t.mutation(internal.sponsorStore.reserve, reserveArgs(id))
    expect(r.reader).toBe(PASSKEY)
    const row = await t.run((ctx) =>
      ctx.db
        .query('sponsoredCalls')
        .withIndex('by_request', (q) => q.eq('requestId', r.requestId))
        .unique()
    )
    expect(row?.userId).toBe(id)
    expect(row?.status).toBe('reserved')
  })

  it('T6: refuses a wallet (G) reader, an unverified address and no address', async () => {
    const t = convexTest(schema, modules)
    for (const id of [
      await user(t, Keypair.random().publicKey()),
      await user(t, PASSKEY, false),
      await user(t, null),
    ]) {
      expect(
        await code(t.mutation(internal.sponsorStore.reserve, reserveArgs(id)))
      ).toBe('SPONSOR_READER_NOT_PASSKEY')
    }
  })

  it("T5: refuses another user's request", async () => {
    const t = convexTest(schema, modules)
    const owner = await user(t, PASSKEY)
    const other = await user(t, StrKey.encodeContract(Buffer.alloc(32, 8)))
    const requestId = await prepared(t, owner)
    expect(
      await code(
        t.mutation(internal.sponsorStore.claim, {
          requestId,
          userId: other,
          now: NOW,
        })
      )
    ).toBe('SPONSOR_UNKNOWN_REQUEST')
    expect(
      await code(
        t.mutation(internal.sponsorStore.claim, {
          requestId,
          userId: owner,
          now: NOW,
        })
      )
    ).toBe('ALLOWED')
  })
})

describe('limits (T8)', () => {
  it(`refuses call ${PER_USER_PER_HOUR + 1} within an hour`, async () => {
    const t = convexTest(schema, modules)
    const id = await user(t, PASSKEY)
    for (let i = 0; i < PER_USER_PER_HOUR; i++) {
      expect(
        await code(
          t.mutation(internal.sponsorStore.reserve, reserveArgs(id, NOW + i))
        )
      ).toBe('ALLOWED')
    }
    expect(
      await code(
        t.mutation(internal.sponsorStore.reserve, reserveArgs(id, NOW + 10))
      )
    ).toBe('SPONSOR_RATE_LIMITED')
    // The next hour opens the window again.
    expect(
      await code(
        t.mutation(
          internal.sponsorStore.reserve,
          reserveArgs(id, NOW + 3_600_001)
        )
      )
    ).toBe('ALLOWED')
  })

  it(`refuses call ${PER_USER_PER_DAY + 1} within a day`, async () => {
    const t = convexTest(schema, modules)
    const id = await user(t, PASSKEY)
    let ok = 0
    for (let h = 0; h < 5; h++) {
      for (let i = 0; i < PER_USER_PER_HOUR; i++) {
        if (
          (await code(
            t.mutation(
              internal.sponsorStore.reserve,
              reserveArgs(id, NOW + h * 3_600_001 + i)
            )
          )) === 'ALLOWED'
        )
          ok++
      }
    }
    expect(ok).toBe(PER_USER_PER_DAY)
  })

  it("refuses everyone once the day's fee budget is used", async () => {
    const t = convexTest(schema, modules)
    const a = await user(t, PASSKEY)
    const b = await user(t, StrKey.encodeContract(Buffer.alloc(32, 9)))
    const requestId = await prepared(t, a)
    await t.mutation(internal.sponsorStore.claim, {
      requestId,
      userId: a,
      now: NOW,
    })
    await t.mutation(internal.sponsorStore.finish, {
      requestId,
      txHash: 'h',
      feeStroops: BUDGET,
      now: NOW,
    })
    expect(
      await code(
        t.mutation(internal.sponsorStore.reserve, reserveArgs(b, NOW + 1))
      )
    ).toBe('SPONSOR_BUDGET_REACHED')
    expect(
      await code(
        t.mutation(internal.sponsorStore.checkBudget, {
          dailyBudgetStroops: BUDGET,
          now: NOW + 1,
        })
      )
    ).toBe('SPONSOR_BUDGET_REACHED')
    // The next UTC day starts a new budget.
    expect(
      await code(
        t.mutation(
          internal.sponsorStore.reserve,
          reserveArgs(b, NOW + 86_400_000)
        )
      )
    ).toBe('ALLOWED')
  })

  it("counts a failed transaction's fee, and a deploy fee, against the day", async () => {
    const t = convexTest(schema, modules)
    const a = await user(t, PASSKEY)
    const requestId = await prepared(t, a)
    await t.mutation(internal.sponsorStore.claim, {
      requestId,
      userId: a,
      now: NOW,
    })
    await t.mutation(internal.sponsorStore.fail, {
      requestId,
      error: 'SPONSOR_TX_FAILED',
      feeStroops: '700',
      now: NOW,
    })
    await t.mutation(internal.sponsorStore.recordFee, {
      feeStroops: '300',
      now: NOW,
    })
    const day = await t.run((ctx) => ctx.db.query('sponsorDays').collect())
    expect(day.map((d) => d.spentStroops)).toEqual(['1000'])
  })
})

describe('one submit per request (T9, T10)', () => {
  it('T9: refuses a second claim of the same request', async () => {
    const t = convexTest(schema, modules)
    const id = await user(t, PASSKEY)
    const requestId = await prepared(t, id)
    expect(
      await code(
        t.mutation(internal.sponsorStore.claim, {
          requestId,
          userId: id,
          now: NOW,
        })
      )
    ).toBe('ALLOWED')
    expect(
      await code(
        t.mutation(internal.sponsorStore.claim, {
          requestId,
          userId: id,
          now: NOW,
        })
      )
    ).toBe('SPONSOR_BAD_STATE')
  })

  it('refuses a request that was never prepared', async () => {
    const t = convexTest(schema, modules)
    const id = await user(t, PASSKEY)
    const { requestId } = await t.mutation(
      internal.sponsorStore.reserve,
      reserveArgs(id)
    )
    expect(
      await code(
        t.mutation(internal.sponsorStore.claim, {
          requestId,
          userId: id,
          now: NOW,
        })
      )
    ).toBe('SPONSOR_BAD_STATE')
  })

  it('T10: refuses an expired request, every time', async () => {
    const t = convexTest(schema, modules)
    const id = await user(t, PASSKEY)
    const requestId = await prepared(t, id)
    expect(
      await code(
        t.mutation(internal.sponsorStore.claim, {
          requestId,
          userId: id,
          now: NOW + REQUEST_TTL_MS,
        })
      )
    ).toBe('SPONSOR_EXPIRED')
    expect(
      await code(
        t.mutation(internal.sponsorStore.claim, {
          requestId,
          userId: id,
          now: NOW + REQUEST_TTL_MS + 1,
        })
      )
    ).toBe('SPONSOR_EXPIRED')
  })

  it('does not turn a sent request into a failure', async () => {
    const t = convexTest(schema, modules)
    const id = await user(t, PASSKEY)
    const requestId = await prepared(t, id)
    await t.mutation(internal.sponsorStore.claim, {
      requestId,
      userId: id,
      now: NOW,
    })
    await t.mutation(internal.sponsorStore.finish, {
      requestId,
      txHash: 'h',
      feeStroops: '10',
      now: NOW,
    })
    await t.mutation(internal.sponsorStore.fail, {
      requestId,
      error: 'late',
      now: NOW,
    })
    const row = await t.run((ctx) =>
      ctx.db
        .query('sponsoredCalls')
        .withIndex('by_request', (q) => q.eq('requestId', requestId))
        .unique()
    )
    expect(row?.status).toBe('sent')
  })
})
