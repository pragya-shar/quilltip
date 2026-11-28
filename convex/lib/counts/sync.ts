/**
 * Tip counts per article and per passage, kept as running figures.
 *
 * `syncTipCounts(ctx, source, rowId)` is the only writer of the count tables
 * (`convex/schema/counts.ts`). The money layer calls it in the same mutation
 * as every status change of a tip row (or `syncTipCountsForReceipt` for a
 * balance tip's receipt), so a status change and its counts commit together.
 *
 * Idempotent by its own key: each tip row has one entry, keyed by
 * (source, rowId), recording what the row adds now. A sync derives what the
 * row should add from its current state and applies only the difference; a
 * retry, a replayed chain event or a repeated status change finds nothing to
 * change and writes nothing. A failed or reversed tip therefore takes its
 * count back exactly once, however often it is synced.
 *
 * What counts:
 * - a balance tip (`channel: 'tab'`) while its receipt is `ACCEPTED`,
 *   `SHORTFALL` or `SETTLED`: from acceptance, and as long as it can still be
 *   paid; it leaves the counts when it becomes `UNPAID`, `REJECTED` or
 *   `VOID_RESET`;
 * - a wallet or v1 tip while `countsAsPaid` holds (the earnings rule), with
 *   an operator's `credit_decoded` resolution counted at the decoded amount.
 *
 * Readers: a tip whose tipper is a signed-in user adds a membership; one
 * whose tipper is not known adds to `unidentifiedTipCount` and never to the
 * reader figure. Every read and write here is a single indexed document.
 */
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { countsAsPaid, type TipRow } from '../tipReads'
import {
  canonicalText,
  legacyPassageOf,
  normalizePassageText,
  passageText,
} from '../../../lib/passages/sentences'

export type TipSource = 'tips' | 'highlightTips'

/** Receipt statuses in which a balance tip counts. */
export const COUNTED_TAB_STATUSES: ReadonlySet<string> = new Set([
  'ACCEPTED',
  'SHORTFALL',
  'SETTLED',
])

/** Longest passage text kept for finding the passage again. */
export const PASSAGE_QUOTE_MAX = 2_000

type CountedState = { counted: boolean; cents: number; state: string }

type Identity = {
  articleId: Id<'articles'>
  /** The writer the tip paid; null only for a row that no longer exists. */
  authorId: Id<'users'> | null
  passageId: string | null
  readerKey: string | null
  tipAt: number
  quote: string | null
}

export type SyncResult = {
  changed: boolean
  live: boolean
  cents: number
}

function decodedCents(row: TipRow): number {
  if (row.reviewResolution !== 'credit_decoded') return row.amountCents
  const expected = row.grossBaseUnits ? BigInt(row.grossBaseUnits) : BigInt(0)
  const decoded = row.onChainGrossBaseUnits
    ? BigInt(row.onChainGrossBaseUnits)
    : null
  if (decoded === null || expected <= BigInt(0)) return row.amountCents
  // The decoded amount at the row's own quote, rounded half up.
  const scaled = BigInt(row.amountCents) * decoded * BigInt(2) + expected
  return Number(scaled / (expected * BigInt(2)))
}

/** Whether a row counts now, for how many cents, and from which state. */
async function countedStateOf(
  ctx: MutationCtx,
  row: TipRow
): Promise<CountedState> {
  if (row.channel === 'tab') {
    const receiptId = row.tabReceiptId
      ? ctx.db.normalizeId('tabReceipts', row.tabReceiptId)
      : null
    const receipt = receiptId
      ? await ctx.db.get(receiptId)
      : row.clientRef
        ? await ctx.db
            .query('tabReceipts')
            .withIndex('by_client_ref', (q) =>
              q.eq('clientRef', row.clientRef!)
            )
            .first()
        : null
    const status = receipt?.status ?? null
    return {
      counted: status !== null && COUNTED_TAB_STATUSES.has(status),
      cents: receipt?.amountCents ?? row.amountCents,
      state: `tab:${status ?? row.status}`,
    }
  }
  return {
    counted: countsAsPaid(row),
    cents: decodedCents(row),
    state: `${row.contractVersion ?? 'v1'}:${row.status}${
      row.reviewResolution ? `:${row.reviewResolution}` : ''
    }${row.needsReview ? ':review' : ''}`,
  }
}

/** The row's article, passage and reader, computed once. */
async function identityOf(
  ctx: MutationCtx,
  source: TipSource,
  row: TipRow
): Promise<Identity> {
  const tipper = await ctx.db.get(row.tipperId)
  const base = {
    articleId: row.articleId,
    authorId: row.authorId,
    readerKey: tipper ? `u:${row.tipperId}` : null,
    tipAt: row.createdAt,
  }
  if (source !== 'highlightTips' || !('highlightId' in row)) {
    return { ...base, passageId: null, quote: null }
  }
  const article = await ctx.db.get(row.articleId)
  const { passageId, range } = await legacyPassageOf(
    {
      highlightId: row.highlightId,
      text: row.highlightText,
      startOffset: row.startOffset,
      endOffset: row.endOffset,
    },
    { _id: String(row.articleId), content: article?.content ?? null }
  )
  const text =
    range && article
      ? passageText(
          canonicalText(article.content),
          range.startOffset,
          range.endOffset
        )
      : row.highlightText
  const quote = normalizePassageText(text)
  return {
    ...base,
    passageId,
    quote: quote.length > 0 && quote.length <= PASSAGE_QUOTE_MAX ? quote : null,
  }
}

function clampAdd(value: number, delta: number, label: string): number {
  const next = value + delta
  if (next < 0) {
    console.error(`counts: ${label} would go below zero; kept at 0`)
    return 0
  }
  return next
}

/** +1 or -1 on a reader's membership; returns the change of distinct readers. */
async function moveMembership(
  ctx: MutationCtx,
  scope: 'article' | 'passage',
  articleId: Id<'articles'>,
  passageId: string | null,
  readerKey: string,
  sign: 1 | -1
): Promise<number> {
  const row = await ctx.db
    .query('tipperMemberships')
    .withIndex('by_scope_key', (q) =>
      q
        .eq('scope', scope)
        .eq('articleId', articleId)
        .eq('passageId', passageId)
        .eq('readerKey', readerKey)
    )
    .unique()
  const before = row?.liveTips ?? 0
  const after = clampAdd(before, sign, `${scope} membership`)
  if (row) {
    if (after !== before) await ctx.db.patch(row._id, { liveTips: after })
  } else if (after > 0) {
    await ctx.db.insert('tipperMemberships', {
      scope,
      articleId,
      passageId,
      readerKey,
      liveTips: after,
    })
  }
  if (before === 0 && after > 0) return 1
  if (before > 0 && after === 0) return -1
  return 0
}

type Figures = Pick<
  Doc<'articleTipStats'>,
  | 'tipCount'
  | 'tipCents'
  | 'distinctTippers'
  | 'unidentifiedTipCount'
  | 'firstTipAt'
  | 'lastTipAt'
>

const ZERO: Figures = {
  tipCount: 0,
  tipCents: 0,
  distinctTippers: 0,
  unidentifiedTipCount: 0,
}

function moved(
  current: Figures,
  c: { cents: number; readerKey: string | null; tipAt: number },
  sign: 1 | -1,
  readerDelta: number,
  label: string
): Figures {
  return {
    tipCount: clampAdd(current.tipCount, sign, `${label} tipCount`),
    tipCents: clampAdd(current.tipCents, sign * c.cents, `${label} tipCents`),
    distinctTippers: clampAdd(
      current.distinctTippers,
      readerDelta,
      `${label} distinctTippers`
    ),
    unidentifiedTipCount: clampAdd(
      current.unidentifiedTipCount,
      c.readerKey === null ? sign : 0,
      `${label} unidentifiedTipCount`
    ),
    firstTipAt:
      sign > 0
        ? Math.min(current.firstTipAt ?? c.tipAt, c.tipAt)
        : current.firstTipAt,
    lastTipAt:
      sign > 0
        ? Math.max(current.lastTipAt ?? c.tipAt, c.tipAt)
        : current.lastTipAt,
  }
}

async function applyContribution(
  ctx: MutationCtx,
  c: Identity & { cents: number },
  sign: 1 | -1,
  now: number
): Promise<void> {
  // Article.
  const articleReaders = c.readerKey
    ? await moveMembership(ctx, 'article', c.articleId, null, c.readerKey, sign)
    : 0
  const article = await ctx.db
    .query('articleTipStats')
    .withIndex('by_article', (q) => q.eq('articleId', c.articleId))
    .unique()
  const nextArticle = moved(article ?? ZERO, c, sign, articleReaders, 'article')
  if (article)
    await ctx.db.patch(article._id, { ...nextArticle, updatedAt: now })
  else
    await ctx.db.insert('articleTipStats', {
      articleId: c.articleId,
      ...nextArticle,
      updatedAt: now,
    })

  // Passage.
  if (c.passageId === null) return
  const passageId = c.passageId
  const passageReaders = c.readerKey
    ? await moveMembership(
        ctx,
        'passage',
        c.articleId,
        passageId,
        c.readerKey,
        sign
      )
    : 0
  const passage = await ctx.db
    .query('passageStats')
    .withIndex('by_article_passage', (q) =>
      q.eq('articleId', c.articleId).eq('passageId', passageId)
    )
    .unique()
  const nextPassage = moved(passage ?? ZERO, c, sign, passageReaders, 'passage')
  if (passage) {
    await ctx.db.patch(passage._id, { ...nextPassage, updatedAt: now })
    return
  }
  const authorId =
    c.authorId ?? (await ctx.db.get(c.articleId))?.authorId ?? null
  if (authorId === null) {
    console.error('counts: no writer for a new passage row; not counted')
    return
  }
  await ctx.db.insert('passageStats', {
    articleId: c.articleId,
    passageId,
    authorId,
    ...nextPassage,
    quote: c.quote,
    updatedAt: now,
  })
}

/**
 * Brings the counts in step with one tip row's current state. Call it in the
 * same mutation as every status change of the row (and of its receipt, for a
 * balance tip). Safe to call any number of times.
 */
export async function syncTipCounts(
  ctx: MutationCtx,
  source: TipSource,
  rowId: Id<'tips'> | Id<'highlightTips'>,
  now = Date.now()
): Promise<SyncResult> {
  const row = (await ctx.db.get(rowId)) as TipRow | null
  const entry = await ctx.db
    .query('tipCountEntries')
    .withIndex('by_source_row', (q) =>
      q.eq('source', source).eq('rowId', String(rowId))
    )
    .unique()
  const want = row
    ? await countedStateOf(ctx, row)
    : { counted: false, cents: 0, state: 'missing' }
  const haveLive = entry?.live === true
  const unchanged =
    (!want.counted && !haveLive) ||
    (want.counted && haveLive && entry.cents === want.cents)
  if (unchanged) {
    return { changed: false, live: haveLive, cents: entry?.cents ?? 0 }
  }

  const identity: Identity = entry
    ? {
        articleId: entry.articleId,
        authorId: row?.authorId ?? null,
        passageId: entry.passageId,
        readerKey: entry.readerKey,
        tipAt: entry.tipAt,
        quote: null,
      }
    : await identityOf(ctx, source, row!)
  if (haveLive) {
    await applyContribution(ctx, { ...identity, cents: entry.cents }, -1, now)
  }
  if (want.counted) {
    await applyContribution(ctx, { ...identity, cents: want.cents }, 1, now)
  }
  const fields = {
    live: want.counted,
    cents: want.counted ? want.cents : 0,
    syncedState: want.state,
    updatedAt: now,
  }
  if (entry) {
    await ctx.db.patch(entry._id, fields)
  } else {
    await ctx.db.insert('tipCountEntries', {
      source,
      rowId: String(rowId),
      articleId: identity.articleId,
      passageId: identity.passageId,
      readerKey: identity.readerKey,
      tipAt: identity.tipAt,
      ...fields,
    })
  }
  return { changed: true, live: fields.live, cents: fields.cents }
}

/** `syncTipCounts` for the tip row of a balance tip's receipt. */
export async function syncTipCountsForReceipt(
  ctx: MutationCtx,
  receiptId: Id<'tabReceipts'>,
  now = Date.now()
): Promise<SyncResult | null> {
  const receipt = await ctx.db.get(receiptId)
  if (!receipt) return null
  const source: TipSource = ctx.db.normalizeId(
    'highlightTips',
    receipt.tipRowId
  )
    ? 'highlightTips'
    : 'tips'
  return syncTipCounts(ctx, source, receipt.tipRowId, now)
}
