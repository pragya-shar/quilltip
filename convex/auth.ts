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

/**
 * Sign-up hands Convex Auth its password behind this prefix. `hashSecret`
 * removes it, so the stored hash is the password's own; `verifySecret` never
 * accepts it. The library's create path compares the given secret with an
 * account that already has the id (`createAccountFromCredentialsImpl` in
 * `@convex-dev/auth`), in the same transaction as the lookup. With the prefix
 * that comparison always fails, so sign-up can only create: two sign-ups for
 * one new email that both pass `signUpCheck` give one account and one
 * refusal, never a password check. No password can start with the prefix,
 * because the rule refuses NUL.
 */
export const CREATE_ONLY_PREFIX = '\u0000create-only\u0000'

/** The secret sign-up passes to Convex Auth for `password`. */
export function signUpSecret(password: string): string {
  return CREATE_ONLY_PREFIX + password
}

function isCreateOnly(secret: string): boolean {
  return secret.startsWith(CREATE_ONLY_PREFIX)
}

/** Same rules the sign-up and reset forms show, and no NUL character. */
function validatePassword(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.includes('\u0000') ||
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
  // The library checks the sign-up secret it is given (`signUpSecret`); the
  // rule applies to the password behind the prefix.
  validatePasswordRequirements: (value: string) =>
    validatePassword(
      isCreateOnly(value) ? value.slice(CREATE_ONLY_PREFIX.length) : value
    ),
  reset: ResendPasswordReset,
  // Email verification is not enabled yet.
})

// ConvexCredentials keeps the real authorize in `options`, which Convex Auth
// merges over the provider when it materializes it.
type CredentialsOptions = {
  authorize: NonNullable<typeof password.authorize>
  crypto: {
    hashSecret: (secret: string) => Promise<string>
    verifySecret: (secret: string, hash: string) => Promise<boolean>
  }
}
const passwordOptions = (password as unknown as { options: CredentialsOptions })
  .options
const baseAuthorize = passwordOptions.authorize

/** The library's scrypt, with the create-only rule of `CREATE_ONLY_PREFIX`. */
const createOnlyCrypto: CredentialsOptions['crypto'] = {
  hashSecret: (secret) =>
    passwordOptions.crypto.hashSecret(
      isCreateOnly(secret) ? secret.slice(CREATE_ONLY_PREFIX.length) : secret
    ),
  verifySecret: async (secret, hash) =>
    isCreateOnly(secret)
      ? false
      : passwordOptions.crypto.verifySecret(secret, hash),
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    {
      ...password,
      options: {
        ...passwordOptions,
        crypto: createOnlyCrypto,
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
            const email = typeof params.email === 'string' ? params.email : ''
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
            // Create only: if an account with this id appears meanwhile,
            // the library refuses instead of comparing passwords.
            return baseAuthorize(
              { ...params, password: signUpSecret(params.password as string) },
              ctx
            )
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
