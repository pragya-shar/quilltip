import { ConvexError, v } from 'convex/values'
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from './_generated/server'
import type { Id } from './_generated/dataModel'
import { normalizeEmail } from './lib/email'
import { consumeFixedWindow } from './lib/fixedWindowLimit'

// Spam protection without third-party scripts:
// - a hidden honeypot field that people never fill in;
// - a minimum time between the form rendering and submission;
// - one row per email, with a neutral response either way (no enumeration);
// - a global fixed-window limit on new rows.
export const WAITLIST_MIN_FILL_MS = 2_000
export const WAITLIST_GLOBAL_LIMIT = 30
export const WAITLIST_GLOBAL_WINDOW_MS = 60_000
const MAX_NAME = 80
const MAX_INTEREST = 280

export const WAITLIST_STATUSES = ['pending', 'invited', 'joined'] as const

export const join = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    interest: v.optional(v.string()),
    // Honeypot: must be empty.
    website: v.optional(v.string()),
    // Milliseconds the form was open before submit, measured by the client.
    elapsedMs: v.number(),
    source: v.optional(v.string()),
  },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email)
    if (!email) throw new ConvexError('Enter a valid email address.')

    // Bots get the same answer as people, and nothing is stored.
    if (args.website?.trim() || args.elapsedMs < WAITLIST_MIN_FILL_MS) {
      return { ok: true as const }
    }

    const existing = await ctx.db
      .query('waitlist')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first()
    if (existing) return { ok: true as const }

    const limit = await consumeFixedWindow(
      ctx,
      'waitlist:join',
      WAITLIST_GLOBAL_LIMIT,
      WAITLIST_GLOBAL_WINDOW_MS
    )
    if (!limit.ok) {
      throw new ConvexError(
        'Lots of people are joining right now. Try again in a minute.'
      )
    }

    const name = args.name?.trim().slice(0, MAX_NAME) || undefined
    const interest = args.interest?.trim().slice(0, MAX_INTEREST) || undefined
    const source = args.source?.trim().slice(0, 40) || 'waitlist_page'
    const user = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first()
    const now = Date.now()
    await ctx.db.insert('waitlist', {
      email,
      name,
      interest,
      source,
      status: user ? 'joined' : 'pending',
      joinedAt: user ? now : undefined,
      userId: user?._id,
      createdAt: now,
    })
    return { ok: true as const }
  },
})

/** Owner tool: list entries by status, oldest first. */
export const list = internalQuery({
  args: {
    status: v.optional(
      v.union(v.literal('pending'), v.literal('invited'), v.literal('joined'))
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(1, args.limit ?? 100), 500)
    const rows = args.status
      ? await ctx.db
          .query('waitlist')
          .withIndex('by_status', (q) => q.eq('status', args.status))
          .take(limit)
      : await ctx.db.query('waitlist').take(limit)
    return rows.map((row) => ({
      id: row._id,
      email: row.email,
      name: row.name,
      interest: row.interest,
      status: row.status ?? 'pending',
      createdAt: row.createdAt,
      invitedAt: row.invitedAt,
      joinedAt: row.joinedAt,
    }))
  },
})

/**
 * Owner tool: mark pending entries as invited. Sending the invitation itself
 * is a separate, manual step. Dry run by default.
 */
export const invite = internalMutation({
  args: {
    emails: v.array(v.string()),
    apply: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const results: { email: string; result: string }[] = []
    const now = Date.now()
    for (const raw of args.emails) {
      const email = normalizeEmail(raw)
      const row = email
        ? await ctx.db
            .query('waitlist')
            .withIndex('by_email', (q) => q.eq('email', email))
            .first()
        : null
      if (!row) {
        results.push({ email: raw, result: 'not_found' })
        continue
      }
      const status = row.status ?? 'pending'
      if (status !== 'pending') {
        results.push({ email: row.email, result: `already_${status}` })
        continue
      }
      if (args.apply) {
        await ctx.db.patch(row._id, { status: 'invited', invitedAt: now })
      }
      results.push({
        email: row.email,
        result: args.apply ? 'invited' : 'would_invite',
      })
    }
    return { apply: args.apply === true, results }
  },
})

/** Marks a waitlist entry joined when an account with that email exists. */
export async function markWaitlistJoined(
  ctx: MutationCtx,
  userId: Id<'users'>,
  rawEmail: string | undefined
) {
  const email = rawEmail ? normalizeEmail(rawEmail) : null
  if (!email) return
  const row = await ctx.db
    .query('waitlist')
    .withIndex('by_email', (q) => q.eq('email', email))
    .first()
  if (!row || row.status === 'joined') return
  await ctx.db.patch(row._id, {
    status: 'joined',
    joinedAt: Date.now(),
    userId,
  })
}
