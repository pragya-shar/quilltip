/**
 * Lines readers paid for, read from the running figures (`passageStats`,
 * kept by `convex/lib/counts/sync.ts`).
 *
 * Current text only: a line is shown only where its text is in the
 * published article now, word for word, exactly once. A line the writer
 * removed or changed, one that now occurs more than once, and every line of
 * an unpublished or deleted article are left out. The text a stats row keeps
 * to find its line is never returned; the returned text is the article's own.
 *
 * Copy: `label` says which figure public copy may name. `readers` only when
 * every counted tip there is from a known signed-in reader (then
 * `readerCount` is exact); otherwise `tips`, and copy says "N tips".
 *
 * Bounded: each read takes a fixed number of stats rows and reads at most
 * `MAX_ARTICLES_PER_READ` articles, each checked against the share size
 * limits before its sentences are split.
 */
import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { query, type QueryCtx } from './_generated/server'
import { readShareable } from './shares'
import {
  findPassage,
  rangeOfSentences,
  sentenceRangeText,
} from '../lib/passages/sentences'

/** Lines one `forArticle` call returns at most (the most tipped first). */
export const MAX_ARTICLE_LINES = 100
/** Stats rows one `paidLines` page reads. */
export const MAX_PAID_LINES_PAGE = 8
/** Lines one `byWriter` call returns at most, and its default. */
export const MAX_WRITER_LINES = 20
export const DEFAULT_WRITER_LINES = 10
/** Distinct articles one read loads. */
export const MAX_ARTICLES_PER_READ = 8

export type CountLabel = 'tips' | 'readers'

type Figures = Pick<
  Doc<'passageStats'>,
  'tipCount' | 'tipCents' | 'distinctTippers' | 'unidentifiedTipCount'
>

/** The figure public copy may name (see the header). */
export function labelOf(f: Figures): CountLabel {
  return f.unidentifiedTipCount === 0 && f.distinctTippers > 0
    ? 'readers'
    : 'tips'
}

function figuresOf(f: Figures) {
  return {
    tipCount: f.tipCount,
    tipCents: f.tipCents,
    readerCount: f.distinctTippers,
    unidentifiedTipCount: f.unidentifiedTipCount,
    label: labelOf(f),
  }
}

type Readable = NonNullable<ReturnType<typeof readShareable>>
type ArticleEntry = { article: Doc<'articles'>; text: Readable } | null

/** Published articles' text, read once per call and at most a fixed number. */
function articleReader(ctx: QueryCtx) {
  const cache = new Map<Id<'articles'>, ArticleEntry>()
  return {
    /** Undefined when the read budget is spent before this article. */
    async get(articleId: Id<'articles'>): Promise<ArticleEntry | undefined> {
      if (cache.has(articleId)) return cache.get(articleId)!
      if (cache.size >= MAX_ARTICLES_PER_READ) return undefined
      const article = await ctx.db.get(articleId)
      const text =
        article && article.published === true
          ? readShareable(article.content)
          : null
      const entry = article && text ? { article, text } : null
      cache.set(articleId, entry)
      return entry
    },
  }
}

/** Where a stats row's line is in the current text, or null (see header). */
function currentLine(stats: Doc<'passageStats'>, text: Readable) {
  if (stats.quote === null) return null
  const found = findPassage(text.index, stats.quote, 2)
  if (found.length !== 1) return null
  const [from, to] = found[0]!
  const range = rangeOfSentences(text.sentences, from, to)!
  return {
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    text: sentenceRangeText(text.sentences, from, to),
  }
}

async function writerOf(ctx: QueryCtx, article: Doc<'articles'>) {
  const author = await ctx.db.get(article.authorId)
  const username = author?.username ?? article.authorUsername
  return {
    name: author?.name ?? article.authorName ?? username,
    username,
  }
}

const figuresValidator = {
  tipCount: v.number(),
  tipCents: v.number(),
  readerCount: v.number(),
  unidentifiedTipCount: v.number(),
  label: v.union(v.literal('tips'), v.literal('readers')),
}

const paidLineValidator = v.object({
  passageId: v.string(),
  articleId: v.id('articles'),
  /** The line as the article has it now (normalized). */
  text: v.string(),
  startOffset: v.number(),
  endOffset: v.number(),
  article: v.object({ title: v.string(), slug: v.string(), href: v.string() }),
  writer: v.object({ name: v.string(), username: v.string() }),
  ...figuresValidator,
  lastTipAt: v.union(v.number(), v.null()),
})

/**
 * The tipped lines of one published article, in reading order, for the marks
 * and line counts on the article. Empty for an unpublished or missing article.
 */
export const forArticle = query({
  args: { articleId: v.id('articles') },
  returns: v.object({
    lines: v.array(
      v.object({
        passageId: v.string(),
        startOffset: v.number(),
        endOffset: v.number(),
        ...figuresValidator,
      })
    ),
  }),
  handler: async (ctx, args) => {
    const entry = await articleReader(ctx).get(args.articleId)
    if (!entry) return { lines: [] }
    const rows = await ctx.db
      .query('passageStats')
      .withIndex('by_article_tipCount', (q) =>
        q.eq('articleId', args.articleId).gt('tipCount', 0)
      )
      .order('desc')
      .take(MAX_ARTICLE_LINES)
    const lines = []
    for (const stats of rows) {
      const line = currentLine(stats, entry.text)
      if (!line) continue
      lines.push({
        passageId: stats.passageId,
        startOffset: line.startOffset,
        endOffset: line.endOffset,
        ...figuresOf(stats),
      })
    }
    lines.sort((a, b) => a.startOffset - b.startOffset)
    return { lines }
  },
})

/**
 * Paid lines across Quilltip, for Top lines and the mix: the most tipped
 * first (`order: 'top'`, the default; ties by the latest tip), or the most
 * recently tipped (`order: 'recent'`). A page reads at most
 * `MAX_PAID_LINES_PAGE` rows and can hold fewer items than it read, because
 * lines not in their article's current text are left out.
 */
export const paidLines = query({
  args: {
    paginationOpts: paginationOptsValidator,
    order: v.optional(v.union(v.literal('top'), v.literal('recent'))),
  },
  handler: async (ctx, args) => {
    const opts = {
      ...args.paginationOpts,
      numItems: Math.max(
        1,
        Math.min(MAX_PAID_LINES_PAGE, Math.floor(args.paginationOpts.numItems))
      ),
    }
    const page =
      args.order === 'recent'
        ? await ctx.db
            .query('passageStats')
            .withIndex('by_lastTipAt')
            .order('desc')
            .paginate(opts)
        : await ctx.db
            .query('passageStats')
            .withIndex('by_tipCount', (q) => q.gt('tipCount', 0))
            .order('desc')
            .paginate(opts)
    const articles = articleReader(ctx)
    const items = []
    for (const stats of page.page) {
      if (stats.tipCount <= 0) continue
      const entry = await articles.get(stats.articleId)
      if (!entry) continue
      const line = currentLine(stats, entry.text)
      if (!line) continue
      const writer = await writerOf(ctx, entry.article)
      items.push({
        passageId: stats.passageId,
        articleId: stats.articleId,
        ...line,
        article: {
          title: entry.article.title,
          slug: entry.article.slug,
          href: `/${writer.username}/${entry.article.slug}`,
        },
        writer,
        ...figuresOf(stats),
        lastTipAt: stats.lastTipAt ?? null,
      })
    }
    return { ...page, page: items }
  },
})

/**
 * A writer's most tipped lines, for the writer page: at most `limit`
 * (default 10, at most 20), from the writer's published articles, read from
 * at most `MAX_ARTICLES_PER_READ` articles.
 */
export const byWriter = query({
  args: { userId: v.id('users'), limit: v.optional(v.number()) },
  returns: v.array(paidLineValidator),
  handler: async (ctx, args) => {
    const limit = Math.max(
      1,
      Math.min(MAX_WRITER_LINES, Math.floor(args.limit ?? DEFAULT_WRITER_LINES))
    )
    const rows = await ctx.db
      .query('passageStats')
      .withIndex('by_author_tipCount', (q) =>
        q.eq('authorId', args.userId).gt('tipCount', 0)
      )
      .order('desc')
      .take(limit * 2)
    const articles = articleReader(ctx)
    const items = []
    for (const stats of rows) {
      if (items.length >= limit) break
      const entry = await articles.get(stats.articleId)
      if (!entry || entry.article.authorId !== args.userId) continue
      const line = currentLine(stats, entry.text)
      if (!line) continue
      const writer = await writerOf(ctx, entry.article)
      items.push({
        passageId: stats.passageId,
        articleId: stats.articleId,
        ...line,
        article: {
          title: entry.article.title,
          slug: entry.article.slug,
          href: `/${writer.username}/${entry.article.slug}`,
        },
        writer,
        ...figuresOf(stats),
        lastTipAt: stats.lastTipAt ?? null,
      })
    }
    return items
  },
})
