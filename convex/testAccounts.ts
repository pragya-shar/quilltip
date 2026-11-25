import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import { normalizeEmail } from './lib/email'

// Test-account flag. Only internal functions can set it, so it is changed
// from the Convex dashboard or CLI by someone with deployment access:
//   bunx convex run testAccounts:setTestAccount '{"email":"qa@example.test","isTestAccount":true}'

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
