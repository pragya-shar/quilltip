/**
 * Payments v2 backfill (docs/architecture/v2/06-app-integration.md, section
 * 6.2): sets `contractVersion: 'v1'` on existing tip, highlight-tip and NFT
 * rows. Internal, dry run by default, idempotent and paged. Run it on the
 * non-production deployment first; it is never run automatically.
 *
 *   bunx convex run chain/backfill:setContractVersionV1 '{"table":"tips"}'
 *   bunx convex run chain/backfill:setContractVersionV1 '{"table":"tips","apply":true}'
 *
 * Repeat with the returned `continueCursor` until `isDone`.
 */
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

const DEFAULT_PAGE_SIZE = 200
const MAX_PAGE_SIZE = 500

export const setContractVersionV1 = internalMutation({
  args: {
    table: v.union(
      v.literal('tips'),
      v.literal('highlightTips'),
      v.literal('articleNFTs')
    ),
    apply: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apply = args.apply === true
    const requested = Math.floor(args.pageSize ?? DEFAULT_PAGE_SIZE)
    const numItems = Number.isFinite(requested)
      ? Math.min(Math.max(1, requested), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE
    const page = await ctx.db
      .query(args.table)
      .paginate({ cursor: args.cursor ?? null, numItems })

    let scanned = 0
    let toUpdate = 0
    for (const row of page.page) {
      scanned++
      // v2 rows and rows already labelled are left unchanged.
      if (row.contractVersion !== undefined) continue
      toUpdate++
      if (apply) await ctx.db.patch(row._id, { contractVersion: 'v1' })
    }

    return {
      table: args.table,
      apply,
      scanned,
      toUpdate,
      updated: apply ? toUpdate : 0,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})
