import type { Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { handleKey } from '../../lib/profile/handleRules'

export type HandleOwner = {
  userId: Id<'users'>
  /** False when the handle is one the writer used before (a redirect). */
  current: boolean
}

/** Who holds a handle, ignoring letter case, including retired handles. */
export async function findHandleOwner(
  ctx: QueryCtx,
  handle: string
): Promise<HandleOwner | null> {
  const key = handleKey(handle)
  const byKey = await ctx.db
    .query('users')
    .withIndex('by_username_lower', (q) => q.eq('usernameLower', key))
    .first()
  if (byKey) return { userId: byKey._id, current: true }

  // Accounts created before usernameLower existed are matched exactly.
  const exact = await ctx.db
    .query('users')
    .withIndex('by_username', (q) => q.eq('username', handle))
    .first()
  if (exact) return { userId: exact._id, current: true }

  const retired = await ctx.db
    .query('usernameHistory')
    .withIndex('by_username_lower', (q) => q.eq('usernameLower', key))
    .first()
  return retired ? { userId: retired.userId, current: false } : null
}
