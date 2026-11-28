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

// Sign-up attempts per email, counted whether or not the email has an
// account, so the count tells nothing about which emails have one. There is
// no count across all emails: it would let one caller stop every sign-up.
// Convex functions do not see the caller's address, so nothing here limits
// one caller across many emails.
export const SIGN_UP_PER_EMAIL_LIMIT = 5
export const SIGN_UP_PER_EMAIL_WINDOW_MS = 60 * 60 * 1000

/** Same rules the sign-up and reset forms show, and no NUL character. */
function passwordMeetsRule(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !value.includes('\u0000') &&
    value.length >= PASSWORD_MIN_LENGTH &&
    PASSWORD_REGEX.test(value)
  )
}

// How long a sign-up holds its account id while the library creates the
// account. Creation is one mutation; the hold only outlasts it when the
// action stops before it can release the hold.
export const SIGN_UP_CLAIM_MS = 60 * 1000

/** The hold on one account id (the email as given), in `rateLimits`. */
function claimKey(email: string) {
  return `sign-up-claim:${email}`
}

/**
 * Sign-up hands Convex Auth its password behind this prefix. `hashSecret`
 * removes it, so the stored hash is the password's own; `verifySecret` never
 * accepts it. The library's create path compares the given secret with an
 * account that already has the id (`createAccountFromCredentialsImpl` in
 * `@convex-dev/auth`), in the same transaction as its lookup. With the prefix
 * that comparison always fails, so sign-up can only create: two sign-ups for
 * one new email that both pass `beginSignUp` give one account, one session
 * and one refusal, never a password check. No password can start with the
 * prefix, because the rule refuses NUL.
 */
export const CREATE_ONLY_PREFIX = '\u0000create-only\u0000'

/** The secret sign-up passes to Convex Auth for `password`. */
export function signUpSecret(password: string): string {
  return CREATE_ONLY_PREFIX + password
}

function isCreateOnly(secret: string): boolean {
  return secret.startsWith(CREATE_ONLY_PREFIX)
}

function withoutCreateOnly(secret: string): string {
  return isCreateOnly(secret) ? secret.slice(CREATE_ONLY_PREFIX.length) : secret
}

/**
 * Before a sign-up: counts the attempt, then says whether a password
 * account exists for this email (the account id Convex Auth uses: the
 * email as given). Sign-up for such an email is refused before the
 * password is read; signing in to that account goes through sign-in.
 *
 * The library creates the account in a later, separate transaction, and for
 * an id that exists by then it compares the password and signs in. So a new
 * id is held here, in this transaction, until `endSignUp`: a second sign-up
 * for the same id in the meantime is answered as in use.
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
    const account = await ctx.db
      .query('authAccounts')
      .withIndex('providerAndAccountId', (q) =>
        q.eq('provider', 'password').eq('providerAccountId', email)
      )
      .unique()
    if (account) return 'in-use'
    const now = Date.now()
    const claim = await ctx.db
      .query('rateLimits')
      .withIndex('by_key', (q) => q.eq('key', claimKey(email)))
      .unique()
    if (claim && now - claim.windowStart < SIGN_UP_CLAIM_MS) return 'in-use'
    if (claim) await ctx.db.patch(claim._id, { windowStart: now, count: 1 })
    else {
      await ctx.db.insert('rateLimits', {
        key: claimKey(email),
        windowStart: now,
        count: 1,
      })
    }
    return 'new'
  },
})

/** Releases the hold `beginSignUp` took, whatever the sign-up's outcome. */
export const endSignUp = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, { email }) => {
    const claim = await ctx.db
      .query('rateLimits')
      .withIndex('by_key', (q) => q.eq('key', claimKey(email)))
      .unique()
    if (claim) await ctx.db.delete(claim._id)
    return null
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
  // The library checks the secret sign-up gives it (`signUpSecret`): the
  // rule applies to the password behind the prefix.
  validatePasswordRequirements(value) {
    if (!passwordMeetsRule(withoutCreateOnly(value))) {
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
  crypto: {
    hashSecret: (secret: string) => Promise<string>
    verifySecret: (secret: string, hash: string) => Promise<boolean>
  }
}
const passwordOptions = (password as unknown as { options: CredentialsOptions })
  .options

/** The library's scrypt, with the create-only rule of `CREATE_ONLY_PREFIX`. */
const createOnlyCrypto: CredentialsOptions['crypto'] = {
  hashSecret: (secret) =>
    passwordOptions.crypto.hashSecret(withoutCreateOnly(secret)),
  verifySecret: async (secret, hash) =>
    isCreateOnly(secret)
      ? false
      : passwordOptions.crypto.verifySecret(secret, hash),
}
const baseAuthorize = passwordOptions.authorize

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    {
      ...password,
      options: {
        ...passwordOptions,
        crypto: createOnlyCrypto,
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
            // The rule first: a password that breaks it gets the same answer
            // for every email and does not spend the count.
            const secret = params.password
            if (!passwordMeetsRule(secret)) {
              throw new ConvexError('INVALID_PASSWORD')
            }
            const email = typeof params.email === 'string' ? params.email : ''
            const state = await ctx.runMutation(internal.auth.beginSignUp, {
              email,
            })
            if (state === 'limited') throw new ConvexError(SIGN_UP_RATE_LIMITED)
            if (state === 'in-use') {
              // Sign-up only ever makes new accounts: refused before any
              // password is compared with the account's. One hash, as a new
              // account costs, so the answer takes the same time.
              await passwordOptions.crypto.hashSecret(secret)
              throw new ConvexError(EMAIL_IN_USE)
            }
            try {
              return await baseAuthorize(
                { ...params, password: signUpSecret(secret) },
                ctx
              )
            } catch (error) {
              // Only if the account appeared after the hold ran out (the
              // action stopped for longer than SIGN_UP_CLAIM_MS): the library
              // then compares this sign-up's secret with that account's, and
              // the create-only secret never matches (`CREATE_ONLY_PREFIX`),
              // so it refuses with a plain error, whatever the password;
              // answer with the code.
              if (
                !(error instanceof ConvexError) &&
                error instanceof Error &&
                error.message.endsWith(' already exists')
              ) {
                throw new ConvexError(EMAIL_IN_USE)
              }
              throw error
            } finally {
              await ctx.runMutation(internal.auth.endSignUp, { email })
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
