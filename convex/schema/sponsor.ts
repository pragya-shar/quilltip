import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * The fee sponsor (`convex/sponsor.ts`): one row per sponsored balance call,
 * and one fee total per UTC day. Spread into `convex/schema.ts`.
 */
export const sponsorTables = {
  sponsoredCalls: defineTable({
    requestId: v.string(),
    userId: v.id('users'),
    /** The caller's passkey account (a contract address). */
    reader: v.string(),
    call: v.union(
      v.literal('open_session'),
      v.literal('deposit'),
      v.literal('register_key'),
      v.literal('revoke_key')
    ),
    /** Stroops deposited, as a decimal string. */
    amount: v.string(),
    key: v.union(
      v.null(),
      v.object({
        publicKey: v.string(),
        validUntil: v.number(),
        spendLimit: v.string(),
      })
    ),
    keyId: v.union(v.null(), v.number()),
    /**
     * `reserved`: limits passed, not simulated yet. `prepared`: the auth
     * entries below are what the passkey must sign. `submitting`: claimed by
     * one submit. `pending`: sent, hash stored, result not known yet (the
     * reconciler finishes it). `sent` and `failed` are final.
     */
    status: v.union(
      v.literal('reserved'),
      v.literal('prepared'),
      v.literal('submitting'),
      v.literal('pending'),
      v.literal('sent'),
      v.literal('failed')
    ),
    /** Base64 auth entries as simulated, in order. */
    entries: v.array(v.string()),
    /** The latest ledger a signature may name as its expiry. */
    maxExpiration: v.number(),
    /**
     * Committed then paid, in stroops: the prepared fee, then the signed
     * envelope's fee once sent, then the fee charged once the result is known.
     */
    feeStroops: v.string(),
    txHash: v.optional(v.string()),
    error: v.optional(v.string()),
    /** The UTC day (`YYYY-MM-DD`) whose budget the request counts against. */
    day: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_request', ['requestId'])
    .index('by_user_created', ['userId', 'createdAt'])
    .index('by_day_status', ['day', 'status']),

  /** Fees the sponsor paid per UTC day, for the global budget. */
  sponsorDays: defineTable({
    day: v.string(),
    spentStroops: v.string(),
  }).index('by_day', ['day']),
}
