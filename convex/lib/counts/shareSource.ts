/**
 * The return trip of a shared line: which personal share link a balance tip
 * was opened from. `tabs.submitTip` passes the code the reader arrived with,
 * and `recordShareSource` checks it on the server before the tip is
 * accepted, in the same mutation, so a refused tip records nothing.
 *
 * The code is never trusted: it records only when it names a personal share
 * (a signed-in sharer's link) of the tipped article, made by someone other
 * than the tipper, for a tip not yet accepted that names no source yet. A
 * forged, foreign, canonical (signed-out) or own code records nothing and
 * never fails the tip. Nothing here touches the amount, the receipt or the
 * writer's money.
 */
import type { Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import type { TipRow } from '../tipReads'

/** The longest code read, as `shares.resolve` reads it. */
const MAX_CODE_CHARACTERS = 64

export async function recordShareSource(
  ctx: MutationCtx,
  args: {
    prepareId: Id<'tips'> | Id<'highlightTips'>
    userId: Id<'users'>
    shareCode: string | undefined
  }
): Promise<boolean> {
  if (typeof args.shareCode !== 'string') return false
  const code = args.shareCode.slice(0, MAX_CODE_CHARACTERS).trim().toLowerCase()
  if (code.length === 0) return false
  const row = (await ctx.db.get(args.prepareId)) as TipRow | null
  if (
    !row ||
    row.tipperId !== args.userId ||
    row.channel !== 'tab' ||
    row.tabReceiptId !== undefined ||
    row.sourceShareId !== undefined
  )
    return false
  const share = await ctx.db
    .query('shares')
    .withIndex('by_code', (q) => q.eq('code', code))
    .first()
  if (
    !share ||
    share.kind !== 'personal' ||
    !share.createdBy ||
    share.createdBy === args.userId ||
    share.articleId !== row.articleId
  )
    return false
  await ctx.db.patch(args.prepareId, { sourceShareId: share._id } as never)
  return true
}
