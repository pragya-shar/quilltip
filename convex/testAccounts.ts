import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import { normalizeEmail } from './lib/email'
import { emailDomain, normalizeDomain } from './lib/internalAccounts'

// Test-account flag. Only internal functions can set it, so it is changed
// from the Convex dashboard or CLI by someone with deployment access:
//   bunx convex run testAccounts:setTestAccount '{"email":"qa@example.test","isTestAccount":true}'
// New accounts whose email domain is in INTERNAL_ACCOUNT_EMAIL_DOMAINS are
// flagged at sign-up (convex/lib/internalAccounts.ts). Existing accounts are
// flagged with backfillInternalAccountsByDomain, which never runs on its own.

export const setTestAccount = internalMutation({
  args: {
    userId: v.optional(v.id('users')),
    email: v.optional(v.string()),
    isTestAccount: v.boolean(),
  },
  returns: v.object({ userId: v.id('users'), isTestAccount: v.boolean() }),
  handler: async (ctx, args) => {
    let user = args.userId ? await ctx.db.get(args.userId) : null
    if (!user && args.email) {
      const email = normalizeEmail(args.email)
      user = email
        ? await ctx.db
            .query('users')
            .withIndex('by_email', (q) => q.eq('email', email))
            .first()
        : null
    }
    if (!user) throw new Error('User not found')
    await ctx.db.patch(user._id, {
      isTestAccount: args.isTestAccount,
      updatedAt: Date.now(),
    })
    return { userId: user._id, isTestAccount: args.isTestAccount }
  },
})

export const listTestAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('users')
      .withIndex('by_test_account', (q) => q.eq('isTestAccount', true))
      .collect()
    return rows.map((user) => ({
      id: user._id,
      username: user.username,
      email: user.email,
    }))
  },
})

const BACKFILL_PAGE = 200

/**
 * Flags existing accounts whose email domain equals `domain` (exact match,
 * ignoring case; subdomains do not match). A dry run unless `apply` is true.
 * Sets the flag only, never clears it, so running it again changes nothing.
 * Reads one page of users per call; pass `continueCursor` back until
 * `isDone`.
 */
export const backfillInternalAccountsByDomain = internalMutation({
  args: {
    domain: v.string(),
    apply: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    domain: v.string(),
    applied: v.boolean(),
    matched: v.number(),
    flagged: v.number(),
    alreadyFlagged: v.number(),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const domain = normalizeDomain(args.domain)
    if (!domain) {
      throw new ConvexError({
        code: 'INVALID_DOMAIN',
        message: 'Give one domain name, for example example.com.',
      })
    }
    const applied = args.apply === true
    const page = await ctx.db
      .query('users')
      .paginate({ cursor: args.cursor ?? null, numItems: BACKFILL_PAGE })
    let matched = 0
    let flagged = 0
    let alreadyFlagged = 0
    const now = Date.now()
    for (const user of page.page) {
      if (emailDomain(user.email) !== domain) continue
      matched += 1
      if (user.isTestAccount === true) {
        alreadyFlagged += 1
        continue
      }
      flagged += 1
      if (applied) {
        await ctx.db.patch(user._id, { isTestAccount: true, updatedAt: now })
      }
    }
    return {
      domain,
      applied,
      matched,
      flagged,
      alreadyFlagged,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})
