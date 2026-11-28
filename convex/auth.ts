import { Password } from '@convex-dev/auth/providers/Password'
import { convexAuth } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { markWaitlistJoined } from './waitlist'
import { classifyNewAccount } from './lib/internalAccounts'
import { normalizeEmail } from './lib/email'
import { consumeFixedWindow } from './lib/fixedWindowLimit'
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_REGEX,
} from '../lib/validations/password-rules'
import {
  RESET_UNAVAILABLE,
  ResendPasswordReset,
  passwordResetConfigured,
} from './lib/passwordResetEmail'

export const PASSWORD_RESET_RATE_LIMITED = 'PASSWORD_RESET_RATE_LIMITED'
export const PASSWORD_RESET_INVALID_CODE = 'PASSWORD_RESET_INVALID_CODE'

// Sign-up answers with these codes. A production deployment replaces the
// text of a plain error with a generic one, so the form reads codes.
export const EMAIL_IN_USE = 'EMAIL_IN_USE'
export const SIGN_UP_RATE_LIMITED = 'SIGN_UP_RATE_LIMITED'

// Sign-up attempts, counted whether or not the email has an account, so the
// count tells nothing about which emails have one.
export const SIGN_UP_PER_EMAIL_LIMIT = 10
export const SIGN_UP_PER_EMAIL_WINDOW_MS = 60 * 60 * 1000
export const SIGN_UP_GLOBAL_LIMIT = 300
export const SIGN_UP_GLOBAL_WINDOW_MS = 10 * 60 * 1000

/**
 * Before a sign-up: counts the attempt, then says whether a password
 * account exists for this email (the account id Convex Auth uses: the
 * email as given). Sign-up for such an email is refused before the
 * password is read; signing in to that account goes through sign-in.
 */
export const beginSignUp = internalMutation({
  args: { email: v.string() },
  returns: v.union(v.literal('new'), v.literal('in-use'), v.literal('limited')),
  handler: async (ctx, { email }) => {
    const key = normalizeEmail(email) ?? 'invalid'
    const perEmail = await consumeFixedWindow(
      ctx,
      `sign-up:${key}`,
      SIGN_UP_PER_EMAIL_LIMIT,
      SIGN_UP_PER_EMAIL_WINDOW_MS
    )
    if (!perEmail.ok) return 'limited'
    const global = await consumeFixedWindow(
      ctx,
      'sign-up:global',
      SIGN_UP_GLOBAL_LIMIT,
      SIGN_UP_GLOBAL_WINDOW_MS
    )
    if (!global.ok) return 'limited'
    const account = await ctx.db
      .query('authAccounts')
      .withIndex('providerAndAccountId', (q) =>
        q.eq('provider', 'password').eq('providerAccountId', email)
      )
      .unique()
    return account ? 'in-use' : 'new'
  },
})

const password = Password({
  // Profile mapping for user creation
  profile(params) {
    const now = Date.now()
    const handle = `q${crypto.randomUUID().replaceAll('-', '').slice(0, 19)}`
    return {
      email: params.email as string,
      name: params.name as string,
      // Generated here, not taken from the request, so signup cannot claim
      // a handle that belongs to someone (including an earlier handle).
      // Writers choose their own handle later from their profile.
      username: handle,
      usernameLower: handle.toLowerCase(),
      createdAt: now,
      updatedAt: now,
    }
  },
  // Same rules the sign-up and reset forms show.
  validatePasswordRequirements(value) {
    if (
      !value ||
      value.length < PASSWORD_MIN_LENGTH ||
      !PASSWORD_REGEX.test(value)
    ) {
      throw new ConvexError('INVALID_PASSWORD')
    }
  },
  reset: ResendPasswordReset,
  // Email verification is not enabled yet.
})

// ConvexCredentials keeps the real authorize in `options`, which Convex Auth
// merges over the provider when it materializes it.
type CredentialsOptions = {
  authorize: NonNullable<typeof password.authorize>
}
const passwordOptions = (password as unknown as { options: CredentialsOptions })
  .options
const baseAuthorize = passwordOptions.authorize

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    {
      ...password,
      options: {
        ...passwordOptions,
        // Reset requests answer the same way for every email, so the response
        // never reveals whether an account exists.
        authorize: async (
          params: Parameters<typeof baseAuthorize>[0],
          ctx: Parameters<typeof baseAuthorize>[1]
        ) => {
          if (params.flow === 'reset-verification') {
            try {
              return await baseAuthorize(params, ctx)
            } catch (error) {
              // One answer for unknown emails, wrong, used or expired codes.
              if (error instanceof ConvexError) throw error
              throw new ConvexError(PASSWORD_RESET_INVALID_CODE)
            }
          }
          if (params.flow === 'signUp') {
            const email = typeof params.email === 'string' ? params.email : ''
            const state = await ctx.runMutation(internal.auth.beginSignUp, {
              email,
            })
            if (state === 'limited') throw new ConvexError(SIGN_UP_RATE_LIMITED)
            // Refused before the library compares any password with the
            // account's: sign-up only ever makes new accounts.
            if (state === 'in-use') throw new ConvexError(EMAIL_IN_USE)
            return baseAuthorize(params, ctx)
          }
          if (params.flow !== 'reset') return baseAuthorize(params, ctx)
          if (!passwordResetConfigured()) {
            throw new ConvexError(RESET_UNAVAILABLE)
          }
          const allowed: boolean = await ctx.runMutation(
            internal.passwordReset.consumeRequest,
            { email: String(params.email ?? '') }
          )
          if (!allowed) throw new ConvexError(PASSWORD_RESET_RATE_LIMITED)
          try {
            return await baseAuthorize(params, ctx)
          } catch (error) {
            // Unknown email: log, answer as usual. Delivery is scheduled
            // separately, so it cannot change this response or its timing.
            console.warn('[passwordReset] request not sent', {
              reason: error instanceof Error ? error.message : 'unknown',
            })
            return null
          }
        },
      },
    } as typeof password,
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId, profile }) {
      await afterAccountCreatedOrUpdated(ctx as unknown as MutationCtx, {
        userId: userId as Id<'users'>,
        existingUserId: (existingUserId ?? null) as Id<'users'> | null,
        email: profile.email,
      })
    },
  },
})

/**
 * Runs after Convex Auth writes an account. Only a new account is handled:
 * sign-in and password reset pass `existingUserId` and change nothing here.
 */
export async function afterAccountCreatedOrUpdated(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>
    existingUserId: Id<'users'> | null
    email: string | undefined
  }
) {
  if (args.existingUserId) return
  // A new account closes the matching waitlist entry, if any.
  await markWaitlistJoined(ctx, args.userId, args.email)
  // Internal (staff) accounts by email domain, for usage metrics.
  await classifyNewAccount(ctx, args.userId, args.email)
}
