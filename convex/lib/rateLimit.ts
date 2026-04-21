import type { DatabaseReader } from '../_generated/server'
import { Id } from '../_generated/dataModel'
import { TIP_COOLDOWN_MS } from './constants'

type CtxWithReader = { db: DatabaseReader }

/**
 * Returns the createdAt timestamp of the tipper's most recent tip across both
 * the tips and highlightTips tables, or null if they have never tipped.
 */
async function getLatestTipAt(
  ctx: CtxWithReader,
  tipperId: Id<'users'>
): Promise<number | null> {
  const [latestTip, latestHighlightTip] = await Promise.all([
    ctx.db
      .query('tips')
      .withIndex('by_tipper', (q) => q.eq('tipperId', tipperId))
      .order('desc')
      .first(),
    ctx.db
      .query('highlightTips')
      .withIndex('by_tipper', (q) => q.eq('tipperId', tipperId))
      .order('desc')
      .first(),
  ])

  const candidates = [
    latestTip?.createdAt,
    latestHighlightTip?.createdAt,
  ].filter((t): t is number => typeof t === 'number')

  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

export type TipCooldownStatus =
  | { allowed: true }
  | { allowed: false; waitSec: number }

/**
 * Returns whether the caller is currently allowed to tip. If blocked, includes
 * the remaining wait time in whole seconds (always rounded up so the UI never
 * tells the user to retry a fraction of a second early).
 */
export async function checkTipCooldown(
  ctx: CtxWithReader,
  tipperId: Id<'users'>,
  now: number = Date.now()
): Promise<TipCooldownStatus> {
  const latest = await getLatestTipAt(ctx, tipperId)
  if (latest === null) return { allowed: true }

  const elapsed = now - latest
  if (elapsed >= TIP_COOLDOWN_MS) return { allowed: true }

  const waitSec = Math.max(1, Math.ceil((TIP_COOLDOWN_MS - elapsed) / 1000))
  return { allowed: false, waitSec }
}

/**
 * Throws if the caller's most recent tip (of any kind) was within
 * TIP_COOLDOWN_MS. The thrown message is user-facing and includes the
 * remaining wait time in seconds.
 */
export async function enforceTipCooldown(
  ctx: CtxWithReader,
  tipperId: Id<'users'>,
  now: number = Date.now()
): Promise<void> {
  const status = await checkTipCooldown(ctx, tipperId, now)
  if (!status.allowed) {
    throw new Error(`Please wait ${status.waitSec}s before tipping again.`)
  }
}
