import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { normalizeEmail } from './lib/email'
import { consumeFixedWindow } from './lib/fixedWindowLimit'

// Sign-up attempts per email. Counted before the account lookup, for every
// email, so a refusal for too many attempts says nothing about whether the
// email has an account.
export const SIGN_UP_PER_EMAIL_LIMIT = 5
export const SIGN_UP_PER_EMAIL_WINDOW_MS = 60 * 60 * 1000

/**
 * The first step of every password sign-up (convex/auth.ts). Counts the
 * attempt, then reports whether the password provider already has an account
 * with exactly this id. The provider uses the email as typed as the account
 * id, so the lookup does too; the limit key is the normalized email, so case
 * and spacing variants share one count.
 */
export const checkAttempt = internalMutation({
  args: { email: v.string() },
  returns: v.union(v.literal('ok'), v.literal('exists'), v.literal('limited')),
  handler: async (ctx, args) => {
    const key = normalizeEmail(args.email) ?? 'invalid'
    const limit = await consumeFixedWindow(
      ctx,
      `sign-up:${key}`,
      SIGN_UP_PER_EMAIL_LIMIT,
      SIGN_UP_PER_EMAIL_WINDOW_MS
    )
    if (!limit.ok) return 'limited'
    const account = await ctx.db
      .query('authAccounts')
      .withIndex('providerAndAccountId', (q) =>
        q.eq('provider', 'password').eq('providerAccountId', args.email)
      )
      .unique()
    return account ? 'exists' : 'ok'
  },
})
