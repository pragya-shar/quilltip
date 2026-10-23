import type { QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/** Only build destinations that the public username/slug article route can read. */
export async function getTipArticleSummary(
  ctx: QueryCtx,
  articleId: Id<'articles'>
) {
  const article = await ctx.db.get(articleId)
  if (!article?.published) return null
  const author = await ctx.db.get(article.authorId)
  if (!author?.username || !article.slug) return null
  return {
    title: article.title,
    slug: article.slug,
    authorUsername: author.username,
  }
}
