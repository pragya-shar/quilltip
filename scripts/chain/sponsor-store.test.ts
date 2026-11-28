/// <reference types="vite/client" />
/**
 * The fee sponsor's records (convex/sponsorStore.ts) and the sign-in gate of
 * its public actions (convex/sponsor.ts): threats T1, T5, T6, T8, T9, T10 and
 * T21 of the sponsor's threat list, the budget commitments, and the public
 * readiness answer.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it, vi } from 'vitest'
import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  PER_USER_PER_DAY,
  PER_USER_PER_HOUR,
  READINESS_TTL_MS,
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

const reserveArgs = (userId: Id<'users'>, now = NOW, budget = BUDGET) => ({
  userId,
  call: 'deposit' as const,
  amount: '78554595',
  key: null,
  keyId: null,
  passphrase: PASSPHRASE,
  dailyBudgetStroops: budget,
  now,
})

async function prepared(
  t: T,
  userId: Id<'users'>,
  now = NOW,
  fee = '1000',
  budget = BUDGET
) {
  const { requestId } = await t.mutation(
    internal.sponsorStore.reserve,
    reserveArgs(userId, now, budget)
  )
  await t.mutation(internal.sponsorStore.recordPrepared, {
    requestId,
    entries: ['AAAA'],
    maxExpiration: 1000,
    commitStroops: fee,
    dailyBudgetStroops: budget,
    now,
  })
  return requestId
}

async function signed(
  t: T,
  userId: Id<'users'>,
  requestId: string,
  fee = '1000',
  now = NOW
) {
  await t.mutation(internal.sponsorStore.claim, { requestId, userId, now })
  await t.mutation(internal.sponsorStore.markSigned, {
    requestId,
    txHash: `h${requestId.slice(0, 8)}`,
    envelopeFee: fee,
    maxTime: Math.floor(now / 1000) + 120,
    now,
  })
}

async function spentToday(t: T) {
  return t.run(async (ctx) =>
    (await ctx.db.query('sponsorDays').collect()).map((d) => d.spentStroops)
  )
}

async function status(t: T, requestId: string) {
  return t.run(async (ctx) => {
    const rows = (await ctx.db.query('sponsoredCalls').collect()) as {
      requestId: string
      status: string
    }[]
    return rows.find((r) => r.requestId === requestId)?.status
  })
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
        t.mutation(internal.sponsorStore.reserveDeploy, {
          reader: PASSKEY,
          commitStroops: '400100',
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
    await signed(t, a, requestId)
    await t.mutation(internal.sponsorStore.fail, {
      requestId,
      error: 'SPONSOR_TX_FAILED',
      feeStroops: '700',
      force: true,
      now: NOW,
    })
    const { requestId: deploy } = await t.mutation(
      internal.sponsorStore.reserveDeploy,
      {
        reader: PASSKEY,
        commitStroops: '400100',
        dailyBudgetStroops: BUDGET,
        now: NOW,
      }
    )
    await t.mutation(internal.sponsorStore.finish, {
      requestId: deploy,
      txHash: 'd',
      feeStroops: '300',
      now: NOW,
    })
    expect(await spentToday(t)).toEqual(['1000'])
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

describe('the daily budget is reserved, not only checked', () => {
  it('refuses a request whose prepared fee would overshoot what is already committed', async () => {
    const t = convexTest(schema, modules)
    const users = [
      await user(t, PASSKEY),
      await user(t, StrKey.encodeContract(Buffer.alloc(32, 11))),
      await user(t, StrKey.encodeContract(Buffer.alloc(32, 12))),
    ]
    // Budget 1000, three requests that may cost 900 each.
    const first = await prepared(t, users[0]!, NOW, '900', '1000')
    expect(await status(t, first)).toBe('prepared')
    expect(await code(prepared(t, users[1]!, NOW, '900', '1000'))).toBe(
      'SPONSOR_BUDGET_REACHED'
    )
    // A claimed and pending request still counts.
    await signed(t, users[0]!, first, '900')
    expect(await code(prepared(t, users[2]!, NOW, '200', '1000'))).toBe(
      'SPONSOR_BUDGET_REACHED'
    )
    // Once it settles at its real fee, the rest of the day is free again.
    await t.mutation(internal.sponsorStore.finish, {
      requestId: first,
      txHash: 'h',
      feeStroops: '300',
      now: NOW,
    })
    expect(await code(prepared(t, users[2]!, NOW, '600', '1000'))).toBe(
      'ALLOWED'
    )
  })

  it('an expired prepared request no longer holds budget', async () => {
    const t = convexTest(schema, modules)
    await prepared(t, await user(t, PASSKEY), NOW, '900', '1000')
    const later = NOW + REQUEST_TTL_MS
    expect(
      await code(
        prepared(
          t,
          await user(t, StrKey.encodeContract(Buffer.alloc(32, 13))),
          later,
          '900',
          '1000'
        )
      )
    ).toBe('ALLOWED')
  })
})

describe('a sent transaction is never lost', () => {
  it('the submit path cannot mark a pending request failed; the reconciler can', async () => {
    const t = convexTest(schema, modules)
    const id = await user(t, PASSKEY)
    const r = await prepared(t, id)
    await signed(t, id, r, '1100')
    await t.mutation(internal.sponsorStore.fail, {
      requestId: r,
      error: 'SPONSOR_PENDING',
      now: NOW,
    })
    expect(await status(t, r)).toBe('pending')
    const open = await t.query(internal.sponsorStore.openRows, {
      now: NOW + 60_000,
      olderThanMs: 30_000,
    })
    expect(open.pending.map((s) => s.requestId)).toEqual([r])
    await t.mutation(internal.sponsorStore.fail, {
      requestId: r,
      error: 'SPONSOR_TX_FAILED',
      feeStroops: '700',
      force: true,
      now: NOW,
    })
    expect(await status(t, r)).toBe('failed')
    expect(await spentToday(t)).toEqual(['700'])
  })

  it('stores the hash, the envelope fee and the time bound, and only for a request being submitted', async () => {
    const t = convexTest(schema, modules)
    const id = await user(t, PASSKEY)
    const r = await prepared(t, id)
    const args = {
      requestId: r,
      txHash: 'abc',
      envelopeFee: '900',
      maxTime: 1_800_000_000,
      now: NOW,
    }
    // Prepared but not claimed: refused, so nothing would be sent.
    expect(await code(t.mutation(internal.sponsorStore.markSigned, args))).toBe(
      'SPONSOR_BAD_STATE'
    )
    await t.mutation(internal.sponsorStore.claim, {
      requestId: r,
      userId: id,
      now: NOW,
    })
    await t.mutation(internal.sponsorStore.markSigned, args)
    const row = await t.run((ctx) =>
      ctx.db
        .query('sponsoredCalls')
        .withIndex('by_request', (q) => q.eq('requestId', r))
        .unique()
    )
    expect(row).toMatchObject({
      status: 'pending',
      txHash: 'abc',
      feeStroops: '900',
      maxTime: 1_800_000_000,
    })
  })

  it('the reconciler sees pending requests from any day, and submitting ones only past their lifetime', async () => {
    const t = convexTest(schema, modules)
    const id = await user(t, PASSKEY)
    const old = NOW - 3 * 86_400_000
    const r1 = await prepared(t, id, old)
    await signed(t, id, r1, '1000', old)
    const r2 = await prepared(t, id, NOW)
    await t.mutation(internal.sponsorStore.claim, {
      requestId: r2,
      userId: id,
      now: NOW,
    })
    const early = await t.query(internal.sponsorStore.openRows, {
      now: NOW + 60_000,
      olderThanMs: 30_000,
    })
    expect(early.pending.map((p) => p.requestId)).toEqual([r1])
    expect(early.abandoned).toEqual([])
    const late = await t.query(internal.sponsorStore.openRows, {
      now: NOW + REQUEST_TTL_MS + 1,
      olderThanMs: 30_000,
    })
    expect(late.abandoned).toEqual([r2])
  })
})

describe('the budget holds what open requests may cost', () => {
  it('a request being submitted holds its commitment; a failed one releases it', async () => {
    const t = convexTest(schema, modules)
    const a = await user(t, PASSKEY)
    const b = await user(t, StrKey.encodeContract(Buffer.alloc(32, 14)))
    const first = await prepared(t, a, NOW, '900', '1000')
    await t.mutation(internal.sponsorStore.claim, {
      requestId: first,
      userId: a,
      now: NOW,
    })
    expect(await code(prepared(t, b, NOW, '200', '1000'))).toBe(
      'SPONSOR_BUDGET_REACHED'
    )
    await t.mutation(internal.sponsorStore.fail, {
      requestId: first,
      error: 'SPONSOR_SIMULATION_FAILED',
      now: NOW,
    })
    expect(await code(prepared(t, b, NOW, '900', '1000'))).toBe('ALLOWED')
  })

  it('finish books the fee once', async () => {
    const t = convexTest(schema, modules)
    const a = await user(t, PASSKEY)
    const r = await prepared(t, a)
    await signed(t, a, r)
    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.sponsorStore.finish, {
        requestId: r,
        txHash: 'h',
        feeStroops: '500',
        now: NOW,
      })
    }
    expect(await spentToday(t)).toEqual(['500'])
  })

  it('a deploy commits its cap before anything is signed, so concurrent deploys cannot overshoot', async () => {
    const t = convexTest(schema, modules)
    const deploy = () =>
      code(
        t.mutation(internal.sponsorStore.reserveDeploy, {
          reader: PASSKEY,
          commitStroops: '400',
          dailyBudgetStroops: '1000',
          now: NOW,
        })
      )
    expect(await deploy()).toBe('ALLOWED')
    expect(await deploy()).toBe('ALLOWED')
    expect(await deploy()).toBe('SPONSOR_BUDGET_REACHED')
  })
})

describe('the public answer for the newcomer sheet', () => {
  async function ready(t: T, ok: boolean, at: number) {
    await t.mutation(internal.sponsorStore.recordReadiness, {
      service: 'sponsor',
      ready: ok,
      failed: ok ? [] : ['below_floor'],
      warnings: [],
      fingerprint: 'f',
      now: at,
    })
  }

  it('is true only when switched on and the latest check passed recently', async () => {
    const t = convexTest(schema, modules)
    vi.stubEnv('SPONSOR_ENABLED', 'true')
    try {
      const ask = () => t.query(api.sponsorStore.passkeyTipAvailable, {})
      expect(await ask()).toBe(false)
      await ready(t, false, Date.now())
      expect(await ask()).toBe(false)
      await ready(t, true, Date.now() - READINESS_TTL_MS - 1)
      expect(await ask()).toBe(false)
      await ready(t, true, Date.now())
      expect(await ask()).toBe(true)
      vi.stubEnv('SPONSOR_ENABLED', 'false')
      expect(await ask()).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('the order of checks', () => {
  it('limits run before the secret is read', async () => {
    const t = convexTest(schema, modules)
    vi.stubEnv('STELLAR_NETWORK', 'TESTNET')
    vi.stubEnv('SPONSOR_ENABLED', 'true')
    vi.stubEnv('TAB_CONTRACT_ID', StrKey.encodeContract(Buffer.alloc(32, 21)))
    vi.stubEnv('TOKEN_CONTRACT_ID', StrKey.encodeContract(Buffer.alloc(32, 22)))
    vi.stubEnv('SPONSOR_ACCOUNT_WASM_HASH', 'c5'.repeat(32))
    vi.stubEnv('SPONSOR_ACCOUNT_DEPLOYER', Keypair.random().publicKey())
    vi.stubEnv('SPONSOR_PUBLIC_KEY', Keypair.random().publicKey())
    vi.stubEnv('SPONSOR_SECRET', '')
    try {
      const id = await user(t, PASSKEY)
      for (let i = 0; i < PER_USER_PER_HOUR; i++) {
        await t.mutation(
          internal.sponsorStore.reserve,
          reserveArgs(id, Date.now() + i)
        )
      }
      const asUser = t.withIdentity({ subject: `${id}|session` })
      // Over the hourly limit with no secret set: the limit answers, not the key.
      expect(
        await code(
          asUser.action(api.sponsor.prepare, {
            call: 'deposit',
            amount: '78554595',
            key: null,
            keyId: null,
          })
        )
      ).toBe('SPONSOR_RATE_LIMITED')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
