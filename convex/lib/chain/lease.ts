/**
 * Single-flight leases on `chainLeases` for the indexer, settler and recheck
 * crons (docs/architecture/v2/06-app-integration.md, section 6.3).
 *
 * Convex mutations are serializable, so a lease taken in one mutation cannot
 * be taken by a concurrent one. A holder renews by acquiring again; an expired
 * lease can be taken by anyone.
 */
import type { MutationCtx } from '../../_generated/server'

export const LEASE_NAMES = ['indexer', 'settler', 'recheck', 'config'] as const
export type LeaseName = (typeof LEASE_NAMES)[number]

export async function acquireLease(
  ctx: MutationCtx,
  args: {
    name: string
    holder: string
    ttlMs: number
    now: number
    network: 'TESTNET' | 'MAINNET'
    chainEpoch: string
  }
): Promise<boolean> {
  if (!args.holder) throw new Error('Lease holder is required')
  if (!(args.ttlMs > 0)) throw new Error('Lease TTL must be positive')
  const existing = await ctx.db
    .query('chainLeases')
    .withIndex('by_name', (q) => q.eq('name', args.name))
    .unique()
  const expiresAt = args.now + args.ttlMs
  if (!existing) {
    await ctx.db.insert('chainLeases', {
      network: args.network,
      chainEpoch: args.chainEpoch,
      name: args.name,
      holder: args.holder,
      expiresAt,
    })
    return true
  }
  if (existing.holder !== args.holder && existing.expiresAt > args.now) {
    return false
  }
  await ctx.db.patch(existing._id, {
    holder: args.holder,
    expiresAt,
    network: args.network,
    chainEpoch: args.chainEpoch,
  })
  return true
}

/** Releases the lease if `holder` still holds it. Returns whether it did. */
export async function releaseLease(
  ctx: MutationCtx,
  args: { name: string; holder: string }
): Promise<boolean> {
  const existing = await ctx.db
    .query('chainLeases')
    .withIndex('by_name', (q) => q.eq('name', args.name))
    .unique()
  if (!existing || existing.holder !== args.holder) return false
  await ctx.db.patch(existing._id, { expiresAt: 0 })
  return true
}
