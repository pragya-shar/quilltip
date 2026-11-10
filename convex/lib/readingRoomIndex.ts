import { v, type Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { isArticleListingReady } from './articleListingReady'
import { enrichWithUser } from './enrich'

type ArticleRow = Doc<'readingRoomArticles'>

// Encode substrings as plain alphanumeric tokens, so punctuation, case and
// scripts without word breaks keep the same matching rules as String.includes.
function token(chars: string[]) {
  return (
    chars
      .map((char) => char.charCodeAt(0).toString(16).padStart(4, '0'))
      .join('') + 'z'
  )
}

function indexText(text: string) {
  const normalized = text.toLowerCase()
  // Existing profile fields aren't size-limited. Keep index writes bounded;
  // exceptional rows remain searchable via the oversized index.
  if (normalized.length > 1024) return { grams: '', oversized: true }
  const chars = normalized.split('')
  const tokens = new Set<string>()
  for (let start = 0; start < chars.length; start++) {
    for (
      let length = 1;
      length <= 3 && start + length <= chars.length;
      length++
    ) {
      tokens.add(token(chars.slice(start, start + length)))
    }
  }
  return { grams: [...tokens].join(' '), oversized: undefined }
}

export async function getReadingRoomIndexState(ctx: QueryCtx) {
  return ctx.db
    .query('readingRoomIndexState')
    .withIndex('by_version', (q) => q.eq('version', 1))
    .unique()
}

export async function syncReadingRoomWriter(
  ctx: MutationCtx,
  user: Doc<'users'>,
  ensureExists = false
) {
  const row = await ctx.db
    .query('readingRoomWriters')
    .withIndex('by_author', (q) => q.eq('authorId', user._id))
    .unique()
  if (!row && !ensureExists) return
  const next = indexText([user.name, user.username].join(' '))
  if (!row)
    await ctx.db.insert('readingRoomWriters', {
      authorId: user._id,
      ...next,
    })
  else if (row.grams !== next.grams || row.oversized !== next.oversized)
    await ctx.db.patch(row._id, next)
}

async function articleIndexRow(ctx: QueryCtx, articleId: Id<'articles'>) {
  return ctx.db
    .query('readingRoomArticles')
    .withIndex('by_article', (q) => q.eq('articleId', articleId))
    .unique()
}

export async function syncReadingRoomArticle(
  ctx: MutationCtx,
  articleId: Id<'articles'>,
  article: Doc<'articles'> | null
) {
  const row = await articleIndexRow(ctx, articleId)
  if (!article?.published || !isArticleListingReady(article)) {
    if (row) {
      await ctx.db.delete(row._id)
      const remaining = await ctx.db
        .query('readingRoomArticles')
        .withIndex('by_author', (q) => q.eq('authorId', row.authorId))
        .first()
      if (!remaining) {
        const writer = await ctx.db
          .query('readingRoomWriters')
          .withIndex('by_author', (q) => q.eq('authorId', row.authorId))
          .unique()
        if (writer) await ctx.db.delete(writer._id)
      }
    }
    return
  }

  const user = await ctx.db.get(article.authorId)
  if (user) await syncReadingRoomWriter(ctx, user, true)
  const next = {
    articleId,
    authorId: article.authorId,
    authorName: article.authorName,
    authorUsername: article.authorUsername,
    title: article.title,
    ...indexText(
      [article.title, article.authorName, article.authorUsername].join(' ')
    ),
    tags: article.tags,
    publishedAt: article.publishedAt,
    createdAt: article._creationTime,
    tipCount: article.tipCount,
    highlightCount: article.highlightCount,
  }
  if (row) await ctx.db.patch(row._id, next)
  else await ctx.db.insert('readingRoomArticles', next)
}

export async function syncReadingRoomEngagement(
  ctx: MutationCtx,
  articleId: Id<'articles'>,
  counts: { tipCount?: number; highlightCount?: number }
) {
  const row = await articleIndexRow(ctx, articleId)
  if (row) await ctx.db.patch(row._id, counts)
}

const PROBE_LIMIT = 64
const FINAL_PROBE_LIMIT = 512
const CANDIDATE_LIMIT = 512

export const readingRoomRankValidator = v.object({
  articleId: v.id('articles'),
  writerId: v.optional(v.id('users')),
  title: v.optional(v.string()),
  publishedAt: v.optional(v.number()),
  createdAt: v.number(),
  tipCount: v.optional(v.number()),
  highlightCount: v.optional(v.number()),
  tagOrder: v.optional(
    v.object({
      date: v.number(),
      created: v.number(),
      id: v.id('articleTagLinks'),
    })
  ),
})
export type ReadingRoomRank = Infer<typeof readingRoomRankValidator>
export type ReadingRoomFilters = {
  authorId?: Id<'users'>
  tag?: string
  category?: string
  bookmarkIds?: string[]
}

export function readingRoomTerms(search: string) {
  return search.trim().slice(0, 200).toLowerCase().trim().split(/\s+/)
}

export async function hasReadingRoomReadBudget(ctx: QueryCtx) {
  const { bytesRead, documentsRead, databaseQueries } =
    await ctx.meta.getTransactionMetrics()
  // Leave room for multiple reads of large legacy documents before checking again.
  return (
    bytesRead.remaining > 4 * 1024 * 1024 &&
    documentsRead.remaining > 16 &&
    databaseQueries.remaining > 16
  )
}

async function readProbe<T>(
  ctx: QueryCtx,
  source: AsyncIterable<T>,
  limit: number,
  bounded: boolean
) {
  const rows: T[] = []
  if (bounded && !(await hasReadingRoomReadBudget(ctx))) return null
  for await (const row of source) {
    rows.push(row)
    if (rows.length >= limit) return null
    if (
      bounded &&
      rows.length % 4 === 0 &&
      !(await hasReadingRoomReadBudget(ctx))
    )
      return null
  }
  return rows
}

export async function probeReadingRoomIndex(
  ctx: QueryCtx,
  terms: string[],
  filters: ReadingRoomFilters,
  bounded: boolean
) {
  const { authorId, bookmarkIds } = filters
  if (bookmarkIds) {
    const ids = [...new Set(bookmarkIds)]
    if (bounded && ids.length >= PROBE_LIMIT) return null
    const rows = []
    for (const value of ids) {
      if (bounded && !(await hasReadingRoomReadBudget(ctx))) return null
      const id = ctx.db.normalizeId('articles', value)
      const row = id && (await articleIndexRow(ctx, id))
      if (row) rows.push(row)
    }
    return { rows }
  }

  // A common fragment can hide a narrow query such as “field 599”.
  // Try up to three necessary fragments from either end of the terms.
  const ordered = [...terms].sort((a, b) => b.length - a.length)
  const probes = new Map<string, string>()
  for (const term of ordered) probes.set(token(term.slice(-3).split('')), term)
  for (const term of ordered)
    probes.set(token(term.slice(0, 3).split('')), term)

  const oversizedWriters = authorId
    ? []
    : await readProbe(
        ctx,
        ctx.db
          .query('readingRoomWriters')
          .withIndex('by_oversized', (q) => q.eq('oversized', true)),
        FINAL_PROBE_LIMIT,
        bounded
      )
  const selected = oversizedWriters ? [...probes].slice(0, 3) : []
  for (const [i, [needle, term]] of selected.entries()) {
    const limit = i === selected.length - 1 ? FINAL_PROBE_LIMIT : PROBE_LIMIT
    const articles = await readProbe(
      ctx,
      ctx.db.query('readingRoomArticles').withSearchIndex('by_grams', (q) => {
        const matches = q.search('grams', needle)
        return authorId ? matches.eq('authorId', authorId) : matches
      }),
      limit,
      bounded
    )
    if (!articles) continue

    const writers = authorId
      ? []
      : await readProbe(
          ctx,
          ctx.db
            .query('readingRoomWriters')
            .withSearchIndex('by_grams', (q) => q.search('grams', needle)),
          limit,
          bounded
        )
    if (!writers) continue

    const oversizedArticles = await readProbe(
      ctx,
      ctx.db
        .query('readingRoomArticles')
        .withIndex('by_oversized', (q) => q.eq('oversized', true)),
      bounded ? PROBE_LIMIT : Infinity,
      bounded
    )
    if (!oversizedArticles) return null

    const candidates = new Map(
      [...articles, ...oversizedArticles].map((row) => [row.articleId, row])
    )
    const writerIds = authorId
      ? [authorId]
      : new Set(
          [...writers, ...(oversizedWriters ?? [])].map((row) => row.authorId)
        )
    const authors = new Map<
      Id<'users'>,
      Awaited<ReturnType<typeof enrichWithUser>>
    >()
    for (const id of writerIds) {
      if (bounded && !(await hasReadingRoomReadBudget(ctx))) return null
      const writer = await enrichWithUser(ctx, id)
      authors.set(id, writer)
      if (
        ![writer?.name, writer?.username].some((field) =>
          field?.toLowerCase().includes(term)
        )
      )
        continue

      const catalog = await readProbe(
        ctx,
        ctx.db
          .query('readingRoomArticles')
          .withIndex('by_author', (q) => q.eq('authorId', id)),
        bounded ? CANDIDATE_LIMIT - candidates.size : Infinity,
        bounded
      )
      if (!catalog) return null
      for (const row of catalog) candidates.set(row.articleId, row)
    }
    return { rows: [...candidates.values()], authors }
  }

  // Keep the original result contract for frontend builds without the scan protocol.
  if (!bounded) {
    const source = authorId
      ? ctx.db
          .query('readingRoomArticles')
          .withIndex('by_author', (q) => q.eq('authorId', authorId))
      : ctx.db.query('readingRoomArticles')
    const rows = []
    for await (const row of source) rows.push(row)
    return { rows }
  }
  return null
}

type MatchSource = Pick<
  ArticleRow,
  | 'articleId'
  | 'authorId'
  | 'authorName'
  | 'authorUsername'
  | 'title'
  | 'tags'
  | 'publishedAt'
  | 'createdAt'
  | 'tipCount'
  | 'highlightCount'
>

export async function matchReadingRoomRows(
  ctx: QueryCtx,
  candidates: MatchSource[],
  terms: string[],
  { authorId, tag, category, bookmarkIds }: ReadingRoomFilters,
  authors = new Map<Id<'users'>, Awaited<ReturnType<typeof enrichWithUser>>>(),
  bounded = true
) {
  const rows: ReadingRoomRank[] = []
  const bookmarks = bookmarkIds && new Set(bookmarkIds)
  const writerTerms = new Map<Id<'users'>, string[]>()
  for (const row of candidates) {
    if (authorId && row.authorId !== authorId) continue
    if (bookmarks && !bookmarks.has(row.articleId)) continue
    if (tag && bookmarks && !row.tags?.includes(tag)) continue
    if (
      category &&
      !row.tags?.some((tag) => tag.trim().toLowerCase() === category)
    )
      continue

    if (!authors.has(row.authorId)) {
      if (bounded && !(await hasReadingRoomReadBudget(ctx))) return null
      authors.set(row.authorId, await enrichWithUser(ctx, row.authorId))
    }
    const author = authors.get(row.authorId)
    let remaining = writerTerms.get(row.authorId)
    if (!remaining) {
      const name = author?.name?.toLowerCase()
      const username = author?.username?.toLowerCase()
      remaining = terms.filter(
        (term) => !name?.includes(term) && !username?.includes(term)
      )
      writerTerms.set(row.authorId, remaining)
    }
    const text = [
      row.title,
      author?.name == null ? row.authorName : undefined,
      author?.username == null ? row.authorUsername : undefined,
    ]
      .join(' ')
      .toLowerCase()
    if (!remaining.every((term) => text.includes(term))) continue

    let tagOrder: ReadingRoomRank['tagOrder']
    if (tag && !bookmarks) {
      if (bounded && !(await hasReadingRoomReadBudget(ctx))) return null
      const link = await ctx.db
        .query('articleTagLinks')
        .withIndex('by_article_tag', (q) =>
          q.eq('articleId', row.articleId).eq('tag', tag)
        )
        .first()
      if (!link) continue
      tagOrder = {
        date: link.publishedAt,
        created: link._creationTime,
        id: link._id,
      }
    }
    rows.push({
      articleId: row.articleId,
      title: row.title,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      tipCount: row.tipCount,
      highlightCount: row.highlightCount,
      tagOrder,
    })
  }
  return { rows, authors }
}
