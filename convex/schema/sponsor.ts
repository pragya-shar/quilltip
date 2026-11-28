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
     * one submit. `sent` and `failed` are final.
     */
    status: v.union(
      v.literal('reserved'),
      v.literal('prepared'),
      v.literal('submitting'),
      v.literal('sent'),
      v.literal('failed')
    ),
    /** Base64 auth entries as simulated, in order. */
    entries: v.array(v.string()),
    /** The latest ledger a signature may name as its expiry. */
    maxExpiration: v.number(),
    /** Resource fee at prepare, then the fee charged once sent. */
    feeStroops: v.string(),
    txHash: v.optional(v.string()),
    error: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_request', ['requestId'])
    .index('by_user_created', ['userId', 'createdAt']),

  /** Fees the sponsor paid per UTC day, for the global budget. */
  sponsorDays: defineTable({
    day: v.string(),
    spentStroops: v.string(),
  }).index('by_day', ['day']),
}
