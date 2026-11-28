import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * The fee sponsor (`convex/sponsor.ts`): one row per sponsored balance call,
 * and one fee total per UTC day. Spread into `convex/schema.ts`.
 */
export const sponsorTables = {
  sponsoredCalls: defineTable({
    requestId: v.string(),
    /** The caller; unset for an account deploy (internal, after a verified registration). */
    userId: v.optional(v.id('users')),
    /** The caller's passkey account (a contract address); for a deploy, the new account. */
    reader: v.string(),
    call: v.union(
      v.literal('open_session'),
      v.literal('deposit'),
      v.literal('register_key'),
      v.literal('revoke_key'),
      v.literal('deploy')
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
     * one submit, nothing signed yet. `pending`: signed, hash stored before
     * the send; the result is not known yet (the reconciler finishes it from
     * the network's answer). `sent` and `failed` are final.
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
     * Committed then paid, in stroops: the most the call may cost (its cap
     * plus the inclusion fee) from preparation, then the signed envelope's
     * fee, then the fee charged once the result is known.
     */
    feeStroops: v.string(),
    txHash: v.optional(v.string()),
    /** The signed transaction's upper time bound (Unix seconds). */
    maxTime: v.optional(v.number()),
    /** When the envelope was signed (Unix seconds): the earliest it can land. */
    signedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    /** The UTC day (`YYYY-MM-DD`) whose budget the request counts against. */
    day: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_request', ['requestId'])
    .index('by_user_created', ['userId', 'createdAt'])
    .index('by_day_status', ['day', 'status'])
    .index('by_status_updated', ['status', 'updatedAt']),

  /**
   * The last readiness check of a signing service (`sponsor`, `practice`):
   * which checks failed, when, and for which settings. Entries refuse unless
   * the latest check for the current settings passed recently. The causes
   * are for operations users only (`sponsorStore.getSignerReadiness`).
   */
  signerReadiness: defineTable({
    service: v.string(),
    /**
     * Written only by mutations: set by a passing check, and cleared by a
     * scheduled expiry at `readyUntil` unless a later check extended it. So a
     * subscribed client sees it turn false when checks stop.
     */
    ready: v.boolean(),
    readyUntil: v.number(),
    failed: v.array(v.string()),
    warnings: v.array(v.string()),
    /** A hash of the settings and the key (its public address), never of the secret. */
    fingerprint: v.string(),
    checkedAt: v.number(),
    /** A check in progress holds this lease, so concurrent callers run one check. */
    checkingUntil: v.optional(v.number()),
  }).index('by_service', ['service']),

  /** Fees the sponsor paid per UTC day, for the global budget. */
  sponsorDays: defineTable({
    day: v.string(),
    spentStroops: v.string(),
  }).index('by_day', ['day']),
}
