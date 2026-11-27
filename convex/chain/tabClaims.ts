/**
 * Collected tab earnings (`authorEarnings.collectedBaseUnits`) and the
 * `Claimed` events behind them (docs/operations/chain-runbook.md,
 * "Collected earnings").
 *
 * Each applied `Claimed` event has a `tabClaims` record, so it changes
 * collected earnings once, whatever is re-dispatched, replayed or rebuilt.
 * Two internal operations:
 *
 * - `seedClaimRecords`: once after this change is deployed, records the
 *   `Claimed` events already applied (stored as `done`) without changing any
 *   total. Until it has run, a re-dispatch of such an event would add it
 *   again.
 * - `recomputeCollected`: sets collected earnings to the sum of a writer's
 *   records, with a dry run, and records each correction.
 *
 * The Tab contract keeps no total of past claims (only `claimable(owner)`,
 * what is left to claim), so the records are the reference.
 */
import { v } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from '../_generated/server'
import { readChainEnv } from '../lib/chain/env'
import { recordClaim, uniqueVerifiedUser } from '../lib/chain/tabLedger'

const ZERO = BigInt(0)

/**
 * Records `Claimed` events that were applied before `tabClaims` existed:
 * every stored `claimed` event of the Tab contract handled as `done` in the
 * current epoch. Totals are not changed. One page per call; call again with
 * `continueCursor` until `isDone`. Without `apply` it only counts.
 */
export const seedClaimRecords = internalMutation({
  args: {
    apply: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    const token = chain.tokenContractId
    if (!chain.tabContractId || !token) {
      return { checked: 0, seeded: 0, isDone: true, continueCursor: null }
    }
    const page = await ctx.db
      .query('chainEvents')
      .withIndex('by_type_ledger', (q) => q.eq('type', 'claimed'))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: Math.min(Math.max(1, args.limit ?? 200), 500),
      })
    let seeded = 0
    const now = Date.now()
    for (const doc of page.page) {
      if (
        doc.handled !== 'done' ||
        doc.chainEpoch !== chain.chainEpoch ||
        doc.contractId !== chain.tabContractId
      ) {
        continue
      }
      const recipient = String(doc.topics[1])
      const amount = BigInt(String((doc.data as { amount?: unknown }).amount))
      const user = await uniqueVerifiedUser(ctx, recipient, chain.passphrase)
      if (!user) continue
      if (args.apply !== true) {
        const existing = await ctx.db
          .query('tabClaims')
          .withIndex('by_epoch_event', (q) =>
            q.eq('chainEpoch', doc.chainEpoch).eq('eventId', doc.eventId)
          )
          .first()
        if (!existing) seeded++
        continue
      }
      if (
        await recordClaim(ctx, {
          doc,
          recipient,
          userId: user._id,
          token,
          amount,
          source: 'seeded',
          now,
        })
      ) {
        seeded++
      }
    }
    return {
      checked: page.page.length,
      seeded,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    }
  },
})

/** Σ of a writer's claim records per token. */
async function recordedTotals(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>
): Promise<Map<string, { amount: bigint; claims: number }>> {
  const totals = new Map<string, { amount: bigint; claims: number }>()
  for await (const row of ctx.db
    .query('tabClaims')
    .withIndex('by_user_token', (q) => q.eq('userId', userId))) {
    const t = totals.get(row.token) ?? { amount: ZERO, claims: 0 }
    totals.set(row.token, {
      amount: t.amount + BigInt(row.amount),
      claims: t.claims + 1,
    })
  }
  return totals
}

type Difference = {
  userId: Id<'users'>
  token: string
  before: string
  after: string
  claims: number
}

async function differencesFor(
  ctx: QueryCtx | MutationCtx,
  earnings: Doc<'authorEarnings'>
): Promise<Difference[]> {
  const totals = await recordedTotals(ctx, earnings.userId)
  const tokens = new Set([
    ...totals.keys(),
    ...Object.keys(earnings.collectedBaseUnits ?? {}),
  ])
  const out: Difference[] = []
  for (const token of tokens) {
    const before = earnings.collectedBaseUnits?.[token] ?? '0'
    const after = (totals.get(token)?.amount ?? ZERO).toString()
    if (before !== after) {
      out.push({
        userId: earnings.userId,
        token,
        before,
        after,
        claims: totals.get(token)?.claims ?? 0,
      })
    }
  }
  return out
}

/**
 * Compares each writer's collected earnings with the sum of their claim
 * records and, with `apply`, sets them to it and records the correction.
 * One writer (`userId`), or a page of all writers (call again with
 * `continueCursor` until `isDone`). Run `seedClaimRecords` first after
 * deploying, or claims applied before it look missing.
 */
export const recomputeCollected = internalMutation({
  args: {
    userId: v.optional(v.id('users')),
    apply: v.optional(v.boolean()),
    note: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let rows: Doc<'authorEarnings'>[]
    let isDone = true
    let continueCursor: string | null = null
    if (args.userId) {
      const row = await ctx.db
        .query('authorEarnings')
        .withIndex('by_user', (q) => q.eq('userId', args.userId!))
        .first()
      rows = row ? [row] : []
    } else {
      const page = await ctx.db.query('authorEarnings').paginate({
        cursor: args.cursor ?? null,
        numItems: Math.min(Math.max(1, args.limit ?? 100), 200),
      })
      rows = page.page
      isDone = page.isDone
      continueCursor = page.isDone ? null : page.continueCursor
    }
    const differences: Difference[] = []
    const now = Date.now()
    for (const row of rows) {
      const found = await differencesFor(ctx, row)
      differences.push(...found)
      if (args.apply !== true || found.length === 0) continue
      const collected = { ...(row.collectedBaseUnits ?? {}) }
      for (const d of found) {
        collected[d.token] = d.after
        await ctx.db.insert('tabClaimCorrections', {
          userId: d.userId,
          token: d.token,
          before: d.before,
          after: d.after,
          claims: d.claims,
          ...(args.note ? { note: args.note } : {}),
          createdAt: now,
        })
        console.info(
          JSON.stringify({
            code: 'CHAIN_TAB_COLLECTED_CORRECTED',
            ...d,
            userId: String(d.userId),
          })
        )
      }
      await ctx.db.patch(row._id, {
        collectedBaseUnits: collected,
        updatedAt: now,
      })
    }
    return {
      status: args.apply === true ? 'applied' : 'dry_run',
      checked: rows.length,
      differences,
      isDone,
      continueCursor,
    }
  },
})
