import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Testnet practice money (`convex/practice.ts`): each grant from the practice
 * treasury, and what the treasury gave per UTC day. Spread into
 * `convex/schema.ts`.
 */
export const practiceTables = {
  practiceGrants: defineTable({
    userId: v.id('users'),
    /** The reader's passkey account (contract address). */
    reader: v.string(),
    /**
     * `session`: the first gift with a device key capped at the gift;
     * `gift`: practice money again (raising that key's cap when it is live).
     */
    kind: v.union(v.literal('session'), v.literal('gift')),
    /** Base units of XLM. */
    amount: v.string(),
    /** The device key the reader's browser made (session grants). */
    devicePublicKey: v.optional(v.string()),
    /** The granted key: made by a session grant, raised by a gift. */
    keyId: v.optional(v.number()),
    /** The granted key's last ledger (session grants). */
    validUntil: v.optional(v.number()),
    /** `YYYY-MM-DD`, UTC: the day whose budget the grant counts against. */
    day: v.string(),
    /**
     * `pending`: limits passed; once signed, `txHash` and `maxTime` are
     * stored before the send and the reconciler closes it from the network's
     * answer. `sent` and `failed` are final.
     */
    status: v.union(
      v.literal('pending'),
      v.literal('sent'),
      v.literal('failed')
    ),
    txHash: v.optional(v.string()),
    /** The signed transaction's upper time bound (Unix seconds). */
    maxTime: v.optional(v.number()),
    /** When it was signed (Unix seconds): the earliest it can land. */
    signedAt: v.optional(v.number()),
    /** The ledger it landed in, once sent. */
    ledger: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId', 'createdAt'])
    .index('by_day_status', ['day', 'status'])
    .index('by_status_updated', ['status', 'updatedAt']),

  /** Practice money the treasury committed per UTC day (base units). */
  practiceDays: defineTable({
    day: v.string(),
    givenStroops: v.string(),
  }).index('by_day', ['day']),
}
