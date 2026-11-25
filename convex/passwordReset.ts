import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { normalizeEmail } from './lib/email'
import { consumeFixedWindow } from './lib/fixedWindowLimit'

// Limits on reset requests. They apply whether or not an account exists, so
// they reveal nothing about which emails have accounts. Wrong codes are
// limited separately by Convex Auth (failed sign-in attempts per hour).
export const RESET_PER_EMAIL_LIMIT = 3
export const RESET_PER_EMAIL_WINDOW_MS = 60 * 60 * 1000
export const RESET_GLOBAL_LIMIT = 50
export const RESET_GLOBAL_WINDOW_MS = 10 * 60 * 1000

export const consumeRequest = internalMutation({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email) ?? 'invalid'
    const perEmail = await consumeFixedWindow(
      ctx,
      `password-reset:${email}`,
      RESET_PER_EMAIL_LIMIT,
      RESET_PER_EMAIL_WINDOW_MS
    )
    if (!perEmail.ok) return false
    const global = await consumeFixedWindow(
      ctx,
      'password-reset:global',
      RESET_GLOBAL_LIMIT,
      RESET_GLOBAL_WINDOW_MS
    )
    return global.ok
  },
})
