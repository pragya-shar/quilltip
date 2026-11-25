import type { Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

/** Ids of accounts flagged as test accounts, read through the flag index. */
export async function loadTestAccountIds(
  ctx: QueryCtx
): Promise<Set<Id<'users'>>> {
  const rows = await ctx.db
    .query('users')
    .withIndex('by_test_account', (q) => q.eq('isTestAccount', true))
    .collect()
  return new Set(rows.map((row) => row._id))
}
