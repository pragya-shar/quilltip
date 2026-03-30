// listArticles search uses Convex FTS on articles.searchContent. That is tokenized per Convex
// text search (Tantivy), not JavaScript substring matching. Multi-word queries require all
// terms to match somewhere in the indexed string (AND semantics).
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

const MAX_BODY_CHARS_FOR_SEARCH = 8000

export function extractTextFromContent(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Record<string, unknown>
  if (n.type === 'text' && typeof n.text === 'string') return n.text
  if (Array.isArray(n.content)) {
    return n.content.map(extractTextFromContent).join(' ')
  }
  return ''
}

export function buildSearchContent(
  title: string,
  excerpt: string | undefined,
  options?: { tags?: string[]; content?: unknown }
): string {
  const t = title.trim()
  const e = excerpt?.trim() ?? ''
  const tagPart = [...new Set((options?.tags ?? []).map((x) => x.trim()).filter(Boolean))].join(
    ' '
  )
  const bodySnippet = options?.content
    ? extractTextFromContent(options.content).slice(0, MAX_BODY_CHARS_FOR_SEARCH).trim()
    : ''
  return [t, e, bodySnippet, tagPart].filter(Boolean).join(' ').trim()
}

export async function removeTagLinksForArticle(
  ctx: MutationCtx,
  articleId: Id<'articles'>
) {
  const rows = await ctx.db
    .query('articleTagLinks')
    .withIndex('by_article', (q) => q.eq('articleId', articleId))
    .collect()
  for (const row of rows) {
    await ctx.db.delete(row._id)
  }
}

export async function replaceTagLinksForArticle(
  ctx: MutationCtx,
  article: Doc<'articles'>
) {
  await removeTagLinksForArticle(ctx, article._id)
  if (!article.published || article.publishedAt === undefined) return
  const tags = [...new Set(article.tags ?? [])]
  for (const tag of tags) {
    await ctx.db.insert('articleTagLinks', {
      articleId: article._id,
      tag,
      authorId: article.authorId,
      publishedAt: article.publishedAt,
    })
  }
}
