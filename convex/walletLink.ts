/**
 * Linking a Stellar address to an account requires proof of control.
 *
 * 1. `createWalletChallenge({ address, origin })` stores a challenge bound to
 *    the signed-in user, the address, the backend's network passphrase and the
 *    site origin. It expires after five minutes.
 * 2. The wallet signs the returned message (SEP-53) or, when it cannot sign
 *    messages, the returned transaction (never submitted; see
 *    convex/lib/walletChallenge.ts).
 * 3. `verifyWalletChallenge({ challengeId, origin, proof })` checks the proof
 *    and links the address as verified.
 *
 * A challenge is used once: the first verification attempt marks it used
 * whatever the outcome. Verification failures are returned, not thrown, so
 * that mark is kept. Convex runs each mutation as a serialisable transaction,
 * so two attempts on one challenge, or two accounts verifying one address,
 * cannot both succeed.
 */

import { ConvexError, v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { internalMutation, mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { consumeFixedWindow } from './lib/fixedWindowLimit'
import {
  WALLET_CHALLENGE_TTL_MS,
  challengeMessage,
  challengeTransaction,
  checkWalletProof,
  isValidAccountAddress,
  newNonce,
  normalizeOrigin,
  type WalletChallengeFields,
} from './lib/walletChallenge'
import {
  isStellarAddressVerified,
  walletLinkState,
  walletNetworkPassphrase,
} from './lib/walletVerification'

export const CHALLENGES_PER_USER = 10
export const CHALLENGE_WINDOW_MS = 10 * 60 * 1000

/** Error codes thrown by `createWalletChallenge`. */
export type CreateChallengeError =
  | 'NOT_AUTHENTICATED'
  | 'INVALID_ADDRESS'
  | 'ORIGIN_NOT_ALLOWED'
  | 'RATE_LIMITED'

/** Reasons `verifyWalletChallenge` returns for a refused proof. */
export type VerifyChallengeFailure =
  | 'CHALLENGE_NOT_FOUND'
  | 'CHALLENGE_USED'
  | 'CHALLENGE_EXPIRED'
  | 'ORIGIN_MISMATCH'
  | 'NETWORK_MISMATCH'
  | 'SIGNATURE_INVALID'
  | 'TRANSACTION_CHANGED'
  | 'ADDRESS_IN_USE'

/**
 * Origins allowed to request a challenge: SITE_URL's origin, any in
 * WALLET_LINK_ORIGINS (comma separated), and http://localhost or
 * http://127.0.0.1 (any port) when SITE_URL is unset or itself local.
 */
export function allowedOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false
  const site = process.env.SITE_URL
    ? normalizeOrigin(process.env.SITE_URL)
    : null
  const extra = (process.env.WALLET_LINK_ORIGINS ?? '')
    .split(',')
    .map((o) => normalizeOrigin(o.trim()))
    .filter((o): o is string => o !== null)
  if (normalized === site || extra.includes(normalized)) return true
  const local = (value: string | null) =>
    value === null || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(value)
  return local(site) && local(normalized)
}

function fieldsOf(challenge: {
  address: string
  userId: Id<'users'>
  networkPassphrase: string
  origin: string
  nonce: string
  issuedAt: number
  expiresAt: number
}): WalletChallengeFields {
  return {
    address: challenge.address,
    userId: challenge.userId,
    networkPassphrase: challenge.networkPassphrase,
    origin: challenge.origin,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  }
}

export const createWalletChallenge = mutation({
  args: { address: v.string(), origin: v.string() },
  returns: v.object({
    challengeId: v.id('walletChallenges'),
    message: v.string(),
    transactionXdr: v.string(),
    networkPassphrase: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('NOT_AUTHENTICATED')
    const address = args.address.trim()
    if (!isValidAccountAddress(address)) {
      throw new ConvexError('INVALID_ADDRESS')
    }
    const origin = normalizeOrigin(args.origin)
    if (!origin || !allowedOrigin(origin)) {
      throw new ConvexError('ORIGIN_NOT_ALLOWED')
    }
    const limit = await consumeFixedWindow(
      ctx,
      `wallet-challenge:${userId}`,
      CHALLENGES_PER_USER,
      CHALLENGE_WINDOW_MS
    )
    if (!limit.ok) throw new ConvexError('RATE_LIMITED')

    const now = Date.now()
    const fields: Omit<WalletChallengeFields, 'userId'> = {
      address,
      networkPassphrase: walletNetworkPassphrase(),
      origin,
      nonce: newNonce(),
      issuedAt: now,
      expiresAt: now + WALLET_CHALLENGE_TTL_MS,
    }
    const challengeId = await ctx.db.insert('walletChallenges', {
      userId,
      ...fields,
    })
    const full = { ...fields, userId }
    return {
      challengeId,
      message: challengeMessage(full),
      transactionXdr: challengeTransaction(full).toXDR(),
      networkPassphrase: fields.networkPassphrase,
      expiresAt: fields.expiresAt,
    }
  },
})

export const verifyWalletChallenge = mutation({
  args: {
    challengeId: v.id('walletChallenges'),
    origin: v.string(),
    proof: v.union(
      v.object({ kind: v.literal('message'), signature: v.string() }),
      v.object({ kind: v.literal('transaction'), signedXdr: v.string() })
    ),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      address: v.string(),
      verifiedAt: v.number(),
    }),
    v.object({ ok: v.literal(false), reason: v.string() })
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('NOT_AUTHENTICATED')
    const fail = (reason: VerifyChallengeFailure) =>
      ({ ok: false, reason }) as const

    const challenge = await ctx.db.get(args.challengeId)
    // Another account's challenge looks the same as a missing one.
    if (!challenge || challenge.userId !== userId) {
      return fail('CHALLENGE_NOT_FOUND')
    }
    if (challenge.usedAt !== undefined) return fail('CHALLENGE_USED')

    const now = Date.now()
    const settle = async (
      outcome: VerifyChallengeFailure | 'VERIFIED'
    ): Promise<void> => {
      await ctx.db.patch(challenge._id, { usedAt: now, outcome })
    }

    if (now > challenge.expiresAt) {
      await settle('CHALLENGE_EXPIRED')
      return fail('CHALLENGE_EXPIRED')
    }
    if (normalizeOrigin(args.origin) !== challenge.origin) {
      await settle('ORIGIN_MISMATCH')
      return fail('ORIGIN_MISMATCH')
    }
    const network = walletNetworkPassphrase()
    if (challenge.networkPassphrase !== network) {
      await settle('NETWORK_MISMATCH')
      return fail('NETWORK_MISMATCH')
    }
    const check = checkWalletProof(fieldsOf(challenge), args.proof)
    if (!check.ok) {
      await settle(check.reason)
      return fail(check.reason)
    }

    // One verified owner per address on this network.
    const holders = await ctx.db
      .query('users')
      .withIndex('by_stellar_address', (q) =>
        q.eq('stellarAddress', challenge.address)
      )
      .take(50)
    const taken = holders.some(
      (holder) =>
        holder._id !== userId && isStellarAddressVerified(holder, network)
    )
    if (taken) {
      await settle('ADDRESS_IN_USE')
      return fail('ADDRESS_IN_USE')
    }

    await ctx.db.patch(userId, {
      stellarAddress: challenge.address,
      stellarAddressVerifiedAt: now,
      stellarAddressVerifiedNetwork: network,
      updatedAt: now,
    })
    await settle('VERIFIED')
    return { ok: true as const, address: challenge.address, verifiedAt: now }
  },
})

/** The signed-in user's linked address and whether it is verified. */
export const getMyWalletLink = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      address: v.union(v.string(), v.null()),
      state: v.union(
        v.literal('none'),
        v.literal('unverified'),
        v.literal('verified')
      ),
      verifiedAt: v.union(v.number(), v.null()),
      networkPassphrase: v.string(),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const user = await ctx.db.get(userId)
    if (!user) return null
    const network = walletNetworkPassphrase()
    const state = walletLinkState(user, network)
    return {
      address: user.stellarAddress ?? null,
      state,
      verifiedAt: state === 'verified' ? user.stellarAddressVerifiedAt! : null,
      networkPassphrase: network,
    }
  },
})

/** Removes challenges that expired more than a day ago (cron). */
export const pruneWalletChallenges = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const old = await ctx.db
      .query('walletChallenges')
      .withIndex('by_expires', (q) => q.lt('expiresAt', cutoff))
      .take(200)
    for (const row of old) await ctx.db.delete(row._id)
    return old.length
  },
})
