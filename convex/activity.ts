/**
 * The signed-in user's tips, newest first.
 *
 * - `role: 'reader'`: the tips this reader sent from the balance.
 * - `role: 'writer'`: the tips this writer received, one entry per tip with
 *   its net and state. The tipper is never named (decision: a tip shows no
 *   reader identity); only the article and the passage are.
 *
 * One entry per `tabReceipts` row (invariant M1 in `lib/moneyViews.ts`).
 */
import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { query, type QueryCtx } from './_generated/server'
import { roundCents, tabShareCents } from './lib/authorEarnings'
import { unpaidCents } from './lib/chain/balanceFigures'
import {
  paidPartOf,
  receiptNet,
  tabAccountForReader,
  tabVoucher,
} from './lib/chain/tabLedger'
import {
  caller,
  moneyStateOf,
  passagePreview,
  receiptCents,
  receiptShareCents,
  settledTxHash,
  tipRowOf,
  type MoneyState,
  type NotPaidReason,
} from './lib/moneyViews'

export type ActivityEntry = {
  id: string
  requestId: string | null
  role: 'reader' | 'writer'
  counterparty: { name: string; username: string | null }
  article: {
    id: string
    title: string
    slug: string
    authorUsername: string | null
  }
  passage: string | null
  /** The tip as the reader chose it, in whole US cents (exact). */
  amountCents: number
  /**
   * The writer's exact share, on the 1/10,000-cent grid of the running
   * figures, never floored: rows show it in their detail, and the totals
   * are sums of these, floored once when shown.
   */
  netCents: number
  /**
   * The part of this tip already paid on chain, in the tip's own cents
   * (exact, same grid): all of it when settled, none when accepted, and for
   * a tip on hold or not paid, what a short payment of its pair covered.
   */
  paidCents: number
  /** The writer's exact share of `paidCents`. */
  paidNetCents: number
  /** The platform's 2.5%: `amountCents - netCents`, exact. */
  feeCents: number
  /** What of the tip is not paid on chain: `amountCents - paidCents`. */
  unpaidCents: number
  /** The writer's share of that: `netCents - paidNetCents`. */
  unpaidNetCents: number
  state: MoneyState
  notPaidReason: NotPaidReason | null
  at: number
  txHash: string | null
  /** The exact token amounts, for the detail view. */
  baseUnits: { token: 'XLM'; gross: string; net: string }
}

/** What of this receipt its pair has paid on chain, gross and net. */
async function paidOf(ctx: QueryCtx, receipt: Doc<'tabReceipts'>) {
  const pair = await tabVoucher(
    ctx,
    receipt.tabAccountId,
    receipt.keyId,
    receipt.writerAddress
  )
  return paidPartOf(receipt, BigInt(pair?.paidOnChain ?? '0'))
}

async function entryOf(
  ctx: QueryCtx,
  receipt: Doc<'tabReceipts'>,
  role: 'reader' | 'writer'
): Promise<ActivityEntry> {
  const row = await tipRowOf(ctx, receipt)
  const cents = await receiptCents(ctx, receipt)
  const author = await ctx.db.get(receipt.authorId)
  const { state, reason } = moneyStateOf(receipt.status)
  const net = receiptNet(receipt)
  const paid = await paidOf(ctx, receipt)
  const gross = BigInt(receipt.amount)
  const share = receiptShareCents(receipt, cents)
  // The paid part as the lifetime totals count it (#552): its net, priced
  // with the tip's own quote; the reader's side, the gross part's cents.
  const paidCents = roundCents(cents - unpaidCents(cents, gross, paid.gross))
  const paidNetCents = tabShareCents(cents, paid.net, gross)
  return {
    id: receipt._id,
    requestId: receipt.requestId ?? row?.requestId ?? null,
    role,
    counterparty:
      role === 'reader'
        ? {
            name: author?.name || author?.username || 'Writer',
            username: author?.username ?? null,
          }
        : { name: 'A reader', username: null },
    article: {
      id: receipt.articleId,
      title: row?.articleTitle ?? 'Article',
      slug: row?.articleSlug ?? '',
      authorUsername: author?.username ?? null,
    },
    passage: passagePreview(row),
    amountCents: cents,
    netCents: share,
    paidCents,
    paidNetCents,
    feeCents: roundCents(cents - share),
    unpaidCents: roundCents(cents - paidCents),
    unpaidNetCents: roundCents(share - paidNetCents),
    state,
    notPaidReason: reason,
    at: receipt.acceptedAt,
    txHash: await settledTxHash(ctx, receipt),
    baseUnits: { token: 'XLM', gross: receipt.amount, net: net.toString() },
  }
}

export const mine = query({
  args: {
    role: v.union(v.literal('reader'), v.literal('writer')),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const empty = { page: [], isDone: true, continueCursor: '' }
    const me = await caller(ctx)
    if (!me) return empty
    const opts = {
      ...args.paginationOpts,
      numItems: Math.min(Math.max(1, args.paginationOpts.numItems), 50),
    }
    if (args.role === 'reader') {
      if (!me.address || !me.chain.tabContractId) return empty
      const account = await tabAccountForReader(
        ctx,
        me.address,
        me.chain.chainEpoch
      )
      if (!account || account.userId !== me.userId) return empty
      const result = await ctx.db
        .query('tabReceipts')
        .withIndex('by_account_accepted', (q) =>
          q.eq('tabAccountId', account._id)
        )
        .order('desc')
        .paginate(opts)
      const page = []
      for (const receipt of result.page)
        page.push(await entryOf(ctx, receipt, 'reader'))
      return { ...result, page }
    }
    const epoch = me.chain.chainEpoch
    const result = await ctx.db
      .query('tabReceipts')
      .withIndex('by_author_accepted', (q) => q.eq('authorId', me.userId))
      .order('desc')
      .filter((q) => q.eq(q.field('chainEpoch'), epoch))
      .paginate(opts)
    const page = []
    for (const receipt of result.page)
      page.push(await entryOf(ctx, receipt, 'writer'))
    return { ...result, page }
  },
})

/** At most this many of a reader's own tips on one article are returned. */
export const OWN_TIPS_ON_ARTICLE_LIMIT = 100

const ownTipValidator = v.object({
  requestId: v.union(v.string(), v.null()),
  passage: v.union(
    v.null(),
    v.object({
      text: v.string(),
      startOffset: v.number(),
      endOffset: v.number(),
    })
  ),
  amountCents: v.number(),
  state: v.union(v.literal('accepted'), v.literal('on-chain')),
  at: v.number(),
})

/**
 * The signed-in reader's own tips on one article that the server accepted
 * or that are settled, newest first, with each tipped passage's stored text
 * and offsets, so the article can mark the lines this reader tipped after a
 * reload. At most `OWN_TIPS_ON_ARTICLE_LIMIT`; `complete` is false when
 * there are more. Only the caller's own receipts, through their own tab
 * account: no one else's tips and nothing of the writer's.
 */
export const mineOnArticle = query({
  args: { articleId: v.id('articles') },
  returns: v.object({
    tips: v.array(ownTipValidator),
    complete: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const none = { tips: [], complete: true }
    const me = await caller(ctx)
    if (!me || !me.address || !me.chain.tabContractId) return none
    const account = await tabAccountForReader(
      ctx,
      me.address,
      me.chain.chainEpoch
    )
    if (!account || account.userId !== me.userId) return none
    const receipts = await ctx.db
      .query('tabReceipts')
      .withIndex('by_account_article', (q) =>
        q.eq('tabAccountId', account._id).eq('articleId', args.articleId)
      )
      .order('desc')
      .take(OWN_TIPS_ON_ARTICLE_LIMIT + 1)
    const tips = []
    for (const receipt of receipts.slice(0, OWN_TIPS_ON_ARTICLE_LIMIT)) {
      if (receipt.status !== 'ACCEPTED' && receipt.status !== 'SETTLED')
        continue
      const row = await tipRowOf(ctx, receipt)
      const passage =
        row && 'highlightText' in row && row.highlightText
          ? {
              text: row.highlightText,
              startOffset: row.startOffset,
              endOffset: row.endOffset,
            }
          : null
      tips.push({
        requestId: receipt.requestId ?? row?.requestId ?? null,
        passage,
        amountCents: await receiptCents(ctx, receipt),
        state:
          receipt.status === 'SETTLED'
            ? ('on-chain' as const)
            : ('accepted' as const),
        at: receipt.acceptedAt,
      })
    }
    return {
      tips,
      complete: receipts.length <= OWN_TIPS_ON_ARTICLE_LIMIT,
    }
  },
})
