import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'

/**
 * Deletes the editor's device-id records of a draft (`draftClientIds`), for
 * the paths that delete the draft. A later create with that id then makes a
 * new draft: the writer's words are kept rather than refused.
 */
export async function forgetDraftClientIds(
  ctx: MutationCtx,
  articleId: Id<'articles'>
): Promise<void> {
  const rows = await ctx.db
    .query('draftClientIds')
    .withIndex('by_article', (q) => q.eq('articleId', articleId))
    .take(16)
  for (const row of rows) await ctx.db.delete(row._id)
}
