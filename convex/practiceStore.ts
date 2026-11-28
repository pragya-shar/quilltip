/**
 * Records and limits for testnet practice money (`convex/practice.ts`).
 * Internal only.
 *
 * Two limits, both checked before the treasury signs anything:
 * - one grant per account per UTC day;
 * - a daily treasury budget: practice money committed today (pending and
 *   sent grants) plus this grant may not pass `dailyBudgetStroops`.
 * Two rules of order, not limits: the first grant (`session`) comes once per
 * account, and a gift comes only after it (the contract refuses a session
 * grant onto an account with a balance).
 * The kill switch, the price and the treasury floor are checked by the action.
 */
import { ConvexError, v } from 'convex/values'
import { StrKey } from '@stellar/stellar-sdk'
import type { Id } from './_generated/dataModel'
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from './_generated/server'
import { tabAccountForReader, tabKey } from './lib/chain/tabLedger'
import { verifiedStellarAddress } from './lib/walletVerification'

/** A granted key is raised only with this many ledgers (about 5 minutes) left. */
export const RAISE_MARGIN_LEDGERS = 60

function practiceError(code: string, message: string): never {
  throw new ConvexError({ code, message })
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

async function dayRow(ctx: MutationCtx, day: string) {
  return ctx.db
    .query('practiceDays')
    .withIndex('by_day', (q) => q.eq('day', day))
    .unique()
}

async function addGiven(ctx: MutationCtx, day: string, delta: bigint) {
  const row = await dayRow(ctx, day)
  const next = (row ? BigInt(row.givenStroops) : BigInt(0)) + delta
  const givenStroops = (next < BigInt(0) ? BigInt(0) : next).toString()
  if (row) await ctx.db.patch(row._id, { givenStroops })
  else await ctx.db.insert('practiceDays', { day, givenStroops })
}

export const reserve = internalMutation({
  args: {
    userId: v.id('users'),
    kind: v.union(v.literal('session'), v.literal('gift')),
    amount: v.string(),
    devicePublicKey: v.optional(v.string()),
    validUntil: v.optional(v.number()),
    passphrase: v.string(),
    chainEpoch: v.string(),
    latestLedger: v.number(),
    dailyBudgetStroops: v.string(),
    now: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    grantId: Id<'practiceGrants'>
    reader: string
    raiseKeyId: number | null
  }> => {
    const user = await ctx.db.get(args.userId)
    const reader = verifiedStellarAddress(user, args.passphrase)
    if (!reader || !StrKey.isValidContract(reader)) {
      practiceError(
        'PRACTICE_NOT_PASSKEY',
        'Practice money goes to a passkey account.'
      )
    }
    const day = utcDay(args.now)
    const mine = (
      await ctx.db
        .query('practiceGrants')
        .withIndex('by_user', (q) => q.eq('userId', args.userId))
        .collect()
    ).filter((g) => g.status !== 'failed')
    const first = mine.find((g) => g.kind === 'session')
    if (args.kind === 'session' && first) {
      practiceError(
        'PRACTICE_ALREADY_STARTED',
        'Your practice money was already given.'
      )
    }
    if (args.kind === 'gift' && first?.status !== 'sent') {
      practiceError(
        'PRACTICE_NOT_STARTED',
        'Your first practice money comes with your first tip.'
      )
    }
    if (mine.some((g) => g.day === day)) {
      practiceError(
        'PRACTICE_TODAY_USED',
        'Practice money comes once a day. Come back tomorrow.'
      )
    }
    const amount = BigInt(args.amount)
    const given = await dayRow(ctx, day)
    if (
      (given ? BigInt(given.givenStroops) : BigInt(0)) + amount >
      BigInt(args.dailyBudgetStroops)
    ) {
      practiceError(
        'PRACTICE_BUSY',
        "Today's practice money is given out. Come back tomorrow."
      )
    }
    // A gift raises the first grant's key when the index shows it live, so
    // the reader keeps tipping with no new approval.
    let raiseKeyId: number | null = null
    if (args.kind === 'gift' && first?.keyId !== undefined) {
      const account = await tabAccountForReader(ctx, reader, args.chainEpoch)
      const key = account ? await tabKey(ctx, account._id, first.keyId) : null
      if (
        key?.granted &&
        !key.revoked &&
        key.validUntilLedger > args.latestLedger + RAISE_MARGIN_LEDGERS
      ) {
        raiseKeyId = first.keyId
      }
    }
    await addGiven(ctx, day, amount)
    const grantId = await ctx.db.insert('practiceGrants', {
      userId: args.userId,
      reader,
      kind: args.kind,
      amount: args.amount,
      ...(args.devicePublicKey
        ? { devicePublicKey: args.devicePublicKey }
        : {}),
      ...(raiseKeyId !== null ? { keyId: raiseKeyId } : {}),
      ...(args.validUntil !== undefined ? { validUntil: args.validUntil } : {}),
      day,
      status: 'pending',
      createdAt: args.now,
      updatedAt: args.now,
    })
    return { grantId, reader, raiseKeyId }
  },
})

/**
 * The grant is signed and about to be sent: store its hash and time bound
 * first. Throws unless the grant is pending and unsigned, so a grant is never
 * sent without this record.
 */
export const markSigned = internalMutation({
  args: {
    grantId: v.id('practiceGrants'),
    txHash: v.string(),
    maxTime: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.grantId)
    if (!row || row.status !== 'pending' || row.txHash) {
      practiceError('PRACTICE_BAD_STATE', 'The grant is not awaiting signing.')
    }
    await ctx.db.patch(args.grantId, {
      txHash: args.txHash,
      maxTime: args.maxTime,
      signedAt: Math.floor(Date.now() / 1000),
      updatedAt: args.now,
    })
  },
})

export const finish = internalMutation({
  args: {
    grantId: v.id('practiceGrants'),
    txHash: v.string(),
    keyId: v.optional(v.number()),
    ledger: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.grantId)
    if (!row || row.status !== 'pending') return
    await ctx.db.patch(args.grantId, {
      status: 'sent',
      txHash: args.txHash,
      ...(args.keyId !== undefined ? { keyId: args.keyId } : {}),
      ...(args.ledger !== undefined ? { ledger: args.ledger } : {}),
      updatedAt: args.now,
    })
  },
})

/**
 * Closes a grant as failed and returns its amount to the day's budget. A
 * grant with a hash may still land, so it stays pending unless `force` (the
 * network's answer is FAILED, or its time bound passed with no answer).
 */
export const fail = internalMutation({
  args: {
    grantId: v.id('practiceGrants'),
    error: v.string(),
    force: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.grantId)
    if (!row || row.status !== 'pending') return
    if (row.txHash && !args.force) return
    await ctx.db.patch(args.grantId, {
      status: 'failed',
      error: args.error.slice(0, 200),
      updatedAt: args.now,
    })
    await addGiven(ctx, row.day, -BigInt(row.amount))
  },
})

/** Pending grants older than `olderThanMs`, oldest first, from any day. */
export const openGrants = internalQuery({
  args: { now: v.number(), olderThanMs: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('practiceGrants')
      .withIndex('by_status_updated', (q) =>
        q.eq('status', 'pending').lt('updatedAt', args.now - args.olderThanMs)
      )
      .take(50)
    return rows.map((r) => ({
      grantId: r._id,
      kind: r.kind,
      txHash: r.txHash ?? null,
      maxTime: r.maxTime ?? 0,
      signedAt: r.signedAt ?? 0,
      updatedAt: r.updatedAt,
    }))
  },
})

/** When the treasury last had a grant confirmed on chain, or null. */
export const lastGoodGrant = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query('practiceGrants')
      .withIndex('by_status_updated', (q) => q.eq('status', 'sent'))
      .order('desc')
      .first()
    return row ? row.updatedAt : null
  },
})

/**
 * The user's first grant when it was made for this same device key, so a
 * repeated `grantFirst` from the same browser answers with that grant (or
 * "still pending") instead of a refusal. Null otherwise.
 */
export const sessionReplay = internalQuery({
  args: { userId: v.id('users'), devicePublicKey: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('practiceGrants')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect()
    const first = rows.find(
      (g) => g.kind === 'session' && g.status !== 'failed'
    )
    if (!first || first.devicePublicKey !== args.devicePublicKey) return null
    return {
      status: first.status,
      txHash: first.txHash ?? null,
      ledger: first.ledger ?? null,
      amount: first.amount,
      keyId: first.keyId ?? null,
      validUntil: first.validUntil ?? null,
    }
  },
})
