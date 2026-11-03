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

const SEARCH_LIMIT = 512

export async function searchReadingRoomIndex(
  ctx: QueryCtx,
  search: string,
  filters: {
    authorId?: Id<'users'>
    tag?: string
    category?: string
    bookmarkIds?: string[]
  }
) {
  const { authorId, tag, category, bookmarkIds } = filters
  const terms = search.toLowerCase().trim().split(/\s+/)
  // A single common prefix can hide a narrow query (e.g. “field 599”).
  // Probe up to three independent necessary fragments and keep the first
  // complete candidate set. A fragment can match in either title or writer.
  const ordered = [...terms].sort((a, b) => b.length - a.length)
  const probes = new Map<string, string>()
  for (const term of ordered) probes.set(token(term.slice(-3).split('')), term)
  for (const term of ordered)
    probes.set(token(term.slice(0, 3).split('')), term)
  const selected = [...probes].slice(0, 3)

  const byAuthor = (id: Id<'users'>) =>
    ctx.db
      .query('readingRoomArticles')
      .withIndex('by_author', (q) => q.eq('authorId', id))

  const authors = new Map<Id<'users'>, ReturnType<typeof enrichWithUser>>()
  const candidates = new Map<Id<'articles'>, ArticleRow>()
  if (bookmarkIds) {
    for (const value of new Set(bookmarkIds)) {
      const id = ctx.db.normalizeId('articles', value)
      const row = id && (await articleIndexRow(ctx, id))
      if (row) candidates.set(row.articleId, row)
    }
  } else {
    const scopedWriter = authorId ? await enrichWithUser(ctx, authorId) : null
    const oversizedWriters = authorId
      ? []
      : await ctx.db
          .query('readingRoomWriters')
          .withIndex('by_oversized', (q) => q.eq('oversized', true))
          .take(SEARCH_LIMIT)
    let found = false
    for (let i = 0; i < selected.length; i++) {
      const [needle, term] = selected[i]!
      const limit = i === selected.length - 1 ? SEARCH_LIMIT : 64
      const titleRows = await ctx.db
        .query('readingRoomArticles')
        .withSearchIndex('by_grams', (q) => {
          const matches = q.search('grams', needle)
          return authorId ? matches.eq('authorId', authorId) : matches
        })
        .take(limit)
      if (
        titleRows.length === limit ||
        oversizedWriters.length === SEARCH_LIMIT
      )
        continue
      const writers = authorId
        ? []
        : await ctx.db
            .query('readingRoomWriters')
            .withSearchIndex('by_grams', (q) => q.search('grams', needle))
            .take(limit)
      if (writers.length === limit) continue

      for (const row of titleRows) candidates.set(row.articleId, row)
      const oversizedArticles = ctx.db
        .query('readingRoomArticles')
        .withIndex('by_oversized', (q) => q.eq('oversized', true))
      for await (const row of oversizedArticles)
        candidates.set(row.articleId, row)

      const writerIds = authorId
        ? [authorId]
        : [
            ...new Set(
              [...writers, ...oversizedWriters].map((row) => row.authorId)
            ),
          ]
      for (const id of writerIds) {
        let lookup = authors.get(id)
        if (!lookup) {
          lookup =
            id === authorId
              ? Promise.resolve(scopedWriter)
              : enrichWithUser(ctx, id)
          authors.set(id, lookup)
        }
        const writer = await lookup
        if (
          ![writer?.name, writer?.username].some((field) =>
            field?.toLowerCase().includes(term)
          )
        )
          continue
        for await (const row of byAuthor(id)) candidates.set(row.articleId, row)
      }
      found = true
      break
    }

    // Native text search has a result ceiling. Scan compact metadata when all
    // probes are broad to preserve exact totals and sort order.
    if (!found) {
      const all = authorId
        ? byAuthor(authorId)
        : ctx.db.query('readingRoomArticles')
      for await (const row of all) candidates.set(row.articleId, row)
    }
  }

  const rows = []
  const tagOrder = new Map<
    Id<'articles'>,
    { date: number; created: number; id: string }
  >()
  for (const row of candidates.values()) {
    if (authorId && row.authorId !== authorId) continue
    if (tag && bookmarkIds && !row.tags?.includes(tag)) continue
    if (
      category &&
      !row.tags?.some((tag) => tag.trim().toLowerCase() === category)
    )
      continue
    let writer = authors.get(row.authorId)
    if (!writer) {
      writer = enrichWithUser(ctx, row.authorId)
      authors.set(row.authorId, writer)
    }
    const author = await writer
    const text = [
      row.title,
      author?.name ?? row.authorName,
      author?.username ?? row.authorUsername,
    ]
      .join(' ')
      .toLowerCase()
    if (!terms.every((term) => text.includes(term))) continue
    if (tag && !bookmarkIds) {
      // Legacy tag URLs are driven by the exact tag link and its index order.
      const link = await ctx.db
        .query('articleTagLinks')
        .withIndex('by_article_tag', (q) =>
          q.eq('articleId', row.articleId).eq('tag', tag)
        )
        .first()
      if (!link) continue
      tagOrder.set(row.articleId, {
        date: link.publishedAt,
        created: link._creationTime,
        id: link._id,
      })
    }
    rows.push(row)
  }
  // Preserve the existing base order for stable ties in browse sorting.
  const savedOrder = new Map(
    bookmarkIds?.map((id, index) => [id, index] as const).reverse()
  )
  rows.sort((a, b) => {
    if (bookmarkIds)
      return (
        (savedOrder.get(a.articleId) ?? 0) - (savedOrder.get(b.articleId) ?? 0)
      )
    const aTag = tagOrder.get(a.articleId)
    const bTag = tagOrder.get(b.articleId)
    if (aTag && bTag) {
      return (
        bTag.date - aTag.date ||
        bTag.created - aTag.created ||
        bTag.id.localeCompare(aTag.id)
      )
    }
    return (
      (authorId ? 0 : (b.publishedAt ?? 0) - (a.publishedAt ?? 0)) ||
      b.createdAt - a.createdAt ||
      b.articleId.localeCompare(a.articleId)
    )
  })
  return { rows, authors }
}
