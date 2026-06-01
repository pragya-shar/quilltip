import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { buildSearchContent } from './articleListing'
import { isArticleListingReady } from './articleListingReady'

export function dedupeArticlesById(
  articles: Doc<'articles'>[]
): Doc<'articles'>[] {
  const seen = new Set<Id<'articles'>>()
  const result: Doc<'articles'>[] = []
  for (const article of articles) {
    if (seen.has(article._id)) continue
    seen.add(article._id)
    result.push(article)
  }
  return result
}

export function isSingleTokenSearch(search: string): boolean {
  const trimmed = search.trim()
  return trimmed.length > 0 && !/\s/.test(trimmed)
}

export function articleMatchesSearchTerms(
  article: Doc<'articles'>,
  search: string
): boolean {
  const terms = search.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return false

  const content = buildSearchContent(article.title, article.excerpt, {
    tags: article.tags,
    content: article.content,
  }).toLowerCase()

  return terms.every((term) => content.includes(term.toLowerCase()))
}

export async function fetchArticlesByTagSearch(
  ctx: QueryCtx,
  tag: string,
  authorId?: Id<'users'>
): Promise<Doc<'articles'>[]> {
  const linkRows = authorId
    ? await ctx.db
        .query('articleTagLinks')
        .withIndex('by_author_tag_publishedAt', (q) =>
          q.eq('authorId', authorId).eq('tag', tag)
        )
        .order('desc')
        .collect()
    : await ctx.db
        .query('articleTagLinks')
        .withIndex('by_tag_publishedAt', (q) => q.eq('tag', tag))
        .order('desc')
        .collect()

  const fetched = await Promise.all(
    linkRows.map((row) => ctx.db.get(row.articleId))
  )
  return fetched.filter(
    (a): a is Doc<'articles'> => a !== null && a.published === true
  )
}

export async function fetchListingSearchFallback(
  ctx: QueryCtx,
  search: string,
  authorId?: Id<'users'>
): Promise<Doc<'articles'>[]> {
  let rowsQuery = ctx.db
    .query('articles')
    .withIndex('by_published_date', (q) => q.eq('published', true))
    .order('desc')

  if (authorId) {
    rowsQuery = rowsQuery.filter((q) => q.eq(q.field('authorId'), authorId))
  }

  const rows = await rowsQuery.collect()
  return rows.filter(
    (a) => isArticleListingReady(a) && articleMatchesSearchTerms(a, search)
  )
}

export async function searchListingArticles(
  ctx: QueryCtx,
  options: {
    search: string
    authorUsername?: string
    authorId?: Id<'users'>
    filterTag?: string
  }
): Promise<Doc<'articles'>[]> {
  const { search, authorUsername, authorId, filterTag } = options

  let ftsMatches: Doc<'articles'>[] = []
  try {
    ftsMatches = await ctx.db
      .query('articles')
      .withSearchIndex('search_listing', (q) => {
        let s = q.search('searchContent', search).eq('published', true)
        if (authorUsername) {
          s = s.eq('authorUsername', authorUsername)
        }
        return s
      })
      .collect()
  } catch {
    ftsMatches = []
  }

  let rows = ftsMatches

  if (!filterTag && isSingleTokenSearch(search)) {
    const tagMatches = await fetchArticlesByTagSearch(
      ctx,
      search.trim(),
      authorId
    )
    rows = dedupeArticlesById([...rows, ...tagMatches])
  } else {
    rows = dedupeArticlesById(rows)
  }

  if (rows.length === 0) {
    rows = await fetchListingSearchFallback(ctx, search, authorId)
  }

  if (filterTag) {
    rows = rows.filter((a) => a.tags?.includes(filterTag))
  }

  rows = rows.filter(isArticleListingReady)
  rows.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  return rows
}
