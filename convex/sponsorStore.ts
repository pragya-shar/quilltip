/**
 * The fee sponsor's records (`convex/sponsor.ts` calls these): who asked,
 * what was prepared, and the limits. Internal only: no client reaches them.
 *
 * Every sponsored balance call is bound to the user who asked and to that
 * user's own verified passkey account; it runs through reserved → prepared →
 * submitting → sent or failed, so a request is submitted at most once.
 */
import { ConvexError, v } from 'convex/values'
import { StrKey } from '@stellar/stellar-sdk'
import { internalMutation, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { consumeFixedWindow } from './lib/fixedWindowLimit'
import { verifiedStellarAddress } from './lib/walletVerification'
import {
  PER_USER_PER_DAY,
  PER_USER_PER_HOUR,
  REQUEST_TTL_MS,
} from './lib/sponsor/policy'

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

function sponsorError(code: string, message: string): never {
  throw new ConvexError({ code, message })
}

/** The UTC day a timestamp falls in, as `YYYY-MM-DD`. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

async function daySpent(ctx: MutationCtx, day: string) {
  const row = await ctx.db
    .query('sponsorDays')
    .withIndex('by_day', (q) => q.eq('day', day))
    .unique()
  return { row, spent: row ? BigInt(row.spentStroops) : BigInt(0) }
}

async function addDaySpent(ctx: MutationCtx, fee: bigint, now: number) {
  const day = utcDay(now)
  const { row, spent } = await daySpent(ctx, day)
  const next = (spent + fee).toString()
  if (row) await ctx.db.patch(row._id, { spentStroops: next })
  else await ctx.db.insert('sponsorDays', { day, spentStroops: next })
}

function randomRequestId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const keyValidator = v.union(
  v.null(),
  v.object({
    publicKey: v.string(),
    validUntil: v.number(),
    spendLimit: v.string(),
  })
)
const callValidator = v.union(
  v.literal('open_session'),
  v.literal('deposit'),
  v.literal('register_key'),
  v.literal('revoke_key')
)

/**
 * Checks the caller and the limits, then records the request. The reader is
 * always the caller's own verified contract address: a wallet (G) reader
 * pays its own fees and is refused here.
 */
export const reserve = internalMutation({
  args: {
    userId: v.id('users'),
    call: callValidator,
    amount: v.string(),
    key: keyValidator,
    keyId: v.union(v.null(), v.number()),
    passphrase: v.string(),
    dailyBudgetStroops: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    const reader = verifiedStellarAddress(user, args.passphrase)
    if (!reader || !StrKey.isValidContract(reader)) {
      sponsorError(
        'SPONSOR_READER_NOT_PASSKEY',
        'Only a verified passkey account is sponsored.'
      )
    }
    const { spent } = await daySpent(ctx, utcDay(args.now))
    if (spent >= BigInt(args.dailyBudgetStroops)) {
      sponsorError(
        'SPONSOR_BUDGET_REACHED',
        "Today's sponsored fees are used up."
      )
    }
    for (const [key, limit, windowMs] of [
      [`sponsor:hour:${args.userId}`, PER_USER_PER_HOUR, HOUR_MS],
      [`sponsor:day:${args.userId}`, PER_USER_PER_DAY, DAY_MS],
    ] as const) {
      const r = await consumeFixedWindow(ctx, key, limit, windowMs, args.now)
      if (!r.ok) {
        sponsorError(
          'SPONSOR_RATE_LIMITED',
          `Too many sponsored calls. Try again in ${Math.ceil(r.retryAfterMs / 60_000)} min.`
        )
      }
    }
    const requestId = randomRequestId()
    await ctx.db.insert('sponsoredCalls', {
      requestId,
      userId: args.userId,
      reader,
      call: args.call,
      amount: args.amount,
      key: args.key,
      keyId: args.keyId,
      status: 'reserved',
      entries: [],
      maxExpiration: 0,
      feeStroops: '0',
      expiresAt: args.now + REQUEST_TTL_MS,
      createdAt: args.now,
      updatedAt: args.now,
    })
    return { requestId, reader }
  },
})

async function byRequest(
  ctx: MutationCtx,
  requestId: string
): Promise<Doc<'sponsoredCalls'>> {
  const row = await ctx.db
    .query('sponsoredCalls')
    .withIndex('by_request', (q) => q.eq('requestId', requestId))
    .unique()
  if (!row) sponsorError('SPONSOR_UNKNOWN_REQUEST', 'Unknown request.')
  return row
}

export const recordPrepared = internalMutation({
  args: {
    requestId: v.string(),
    entries: v.array(v.string()),
    maxExpiration: v.number(),
    feeStroops: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await byRequest(ctx, args.requestId)
    if (row.status !== 'reserved') {
      sponsorError(
        'SPONSOR_BAD_STATE',
        'The request is not awaiting preparation.'
      )
    }
    await ctx.db.patch(row._id, {
      status: 'prepared',
      entries: args.entries,
      maxExpiration: args.maxExpiration,
      feeStroops: args.feeStroops,
      updatedAt: args.now,
    })
  },
})

/**
 * Hands a prepared request to exactly one submit: same user, not expired,
 * not claimed before.
 */
export const claim = internalMutation({
  args: { requestId: v.string(), userId: v.id('users'), now: v.number() },
  handler: async (ctx, args) => {
    const row = await byRequest(ctx, args.requestId)
    if (row.userId !== (args.userId as Id<'users'>)) {
      sponsorError('SPONSOR_UNKNOWN_REQUEST', 'Unknown request.')
    }
    if (row.status !== 'prepared') {
      sponsorError('SPONSOR_BAD_STATE', 'This request was already used.')
    }
    // A throw rolls the mutation back, so an expired row keeps its status;
    // it can never be claimed because the time check runs on every claim.
    if (args.now >= row.expiresAt) {
      sponsorError('SPONSOR_EXPIRED', 'The request expired. Nothing was sent.')
    }
    await ctx.db.patch(row._id, { status: 'submitting', updatedAt: args.now })
    return row
  },
})

export const finish = internalMutation({
  args: {
    requestId: v.string(),
    txHash: v.string(),
    feeStroops: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await byRequest(ctx, args.requestId)
    await ctx.db.patch(row._id, {
      status: 'sent',
      txHash: args.txHash,
      feeStroops: args.feeStroops,
      updatedAt: args.now,
    })
    await addDaySpent(ctx, BigInt(args.feeStroops), args.now)
  },
})

export const fail = internalMutation({
  args: {
    requestId: v.string(),
    error: v.string(),
    feeStroops: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await byRequest(ctx, args.requestId)
    if (row.status === 'sent') return
    await ctx.db.patch(row._id, {
      status: 'failed',
      error: args.error.slice(0, 500),
      updatedAt: args.now,
    })
    // A transaction that reached the ledger and failed still cost a fee.
    if (args.feeStroops)
      await addDaySpent(ctx, BigInt(args.feeStroops), args.now)
  },
})

/** Counts a fee paid outside a request (an account deploy) against the day. */
export const recordFee = internalMutation({
  args: { feeStroops: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    await addDaySpent(ctx, BigInt(args.feeStroops), args.now)
  },
})

/** Refuses when today's budget is used up (the deploy path checks this first). */
export const checkBudget = internalMutation({
  args: { dailyBudgetStroops: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const { spent } = await daySpent(ctx, utcDay(args.now))
    if (spent >= BigInt(args.dailyBudgetStroops)) {
      sponsorError(
        'SPONSOR_BUDGET_REACHED',
        "Today's sponsored fees are used up."
      )
    }
  },
})
