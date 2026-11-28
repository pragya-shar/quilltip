import { Password } from '@convex-dev/auth/providers/Password'
import { convexAuth } from '@convex-dev/auth/server'
import { ConvexError } from 'convex/values'
import { internal } from './_generated/api'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { markWaitlistJoined } from './waitlist'
import { classifyNewAccount } from './lib/internalAccounts'
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
/** Sign-up with an email that already has an account. */
export const EMAIL_IN_USE = 'EMAIL_IN_USE'
/** Too many sign-up attempts with one email (convex/signUpCheck.ts). */
export const SIGN_UP_RATE_LIMITED = 'SIGN_UP_RATE_LIMITED'

/** Same rules the sign-up and reset forms show. */
function validatePassword(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length < PASSWORD_MIN_LENGTH ||
    !PASSWORD_REGEX.test(value)
  ) {
    throw new ConvexError('INVALID_PASSWORD')
  }
}

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
  validatePasswordRequirements: validatePassword,
  reset: ResendPasswordReset,
  // Email verification is not enabled yet.
})

// ConvexCredentials keeps the real authorize in `options`, which Convex Auth
// merges over the provider when it materializes it.
type CredentialsOptions = {
  authorize: NonNullable<typeof password.authorize>
  crypto: { hashSecret: (secret: string) => Promise<string> }
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
        // Sign-up refuses an email that has an account before any password
        // check. Reset requests answer the same way for every email, so the
        // response never reveals whether an account exists.
        authorize: async (
          params: Parameters<typeof baseAuthorize>[0],
          ctx: Parameters<typeof baseAuthorize>[1]
        ) => {
          if (params.flow === 'signUp') {
            // Sign-up only creates accounts. An email that already has one is
            // refused here, before the library sees the password, so sign-in
            // is the only flow that checks a password.
            validatePassword(params.password)
            const email = String(params.email ?? '')
            const verdict: 'ok' | 'exists' | 'limited' = await ctx.runMutation(
              internal.signUpCheck.checkAttempt,
              { email }
            )
            if (verdict === 'limited') {
              throw new ConvexError(SIGN_UP_RATE_LIMITED)
            }
            if (verdict === 'exists') {
              // Hash once, as a new account does, so this answer takes about
              // as long as a sign-up that creates an account.
              await passwordOptions.crypto.hashSecret(String(params.password))
              throw new ConvexError(EMAIL_IN_USE)
            }
            return baseAuthorize(params, ctx)
          }
          if (params.flow === 'reset-verification') {
            try {
              return await baseAuthorize(params, ctx)
            } catch (error) {
              // One answer for unknown emails, wrong, used or expired codes.
              if (error instanceof ConvexError) throw error
              throw new ConvexError(PASSWORD_RESET_INVALID_CODE)
            }
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
