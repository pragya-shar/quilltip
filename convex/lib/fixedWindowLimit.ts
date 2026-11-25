import type { MutationCtx } from '../_generated/server'

export type LimitResult = { ok: true } | { ok: false; retryAfterMs: number }

/**
 * Counts one action against `key` in a fixed time window. Returns ok: false
 * once `limit` actions have been counted in the current window. The counter
 * row is shared, so concurrent calls serialize through Convex OCC.
 */
export async function consumeFixedWindow(
  ctx: MutationCtx,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): Promise<LimitResult> {
  const row = await ctx.db
    .query('rateLimits')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique()
  if (!row || now - row.windowStart >= windowMs) {
    if (row) {
      await ctx.db.patch(row._id, { windowStart: now, count: 1 })
    } else {
      await ctx.db.insert('rateLimits', { key, windowStart: now, count: 1 })
    }
    return { ok: true }
  }
  if (row.count >= limit) {
    return { ok: false, retryAfterMs: row.windowStart + windowMs - now }
  }
  await ctx.db.patch(row._id, { count: row.count + 1 })
  return { ok: true }
}
