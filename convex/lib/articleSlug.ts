import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

export function slugifyArticleTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100)
}

export function isPlaceholderArticleSlug(slug: string): boolean {
  if (slug === 'untitled') return true
  if (/^untitled-\d+$/.test(slug)) return true
  if (/^article-\d{10,}$/.test(slug)) return true
  return false
}

export async function generateUniqueArticleSlugForAuthor(
  ctx: MutationCtx,
  args: {
    title: string
    authorId: Id<'users'>
    excludeArticleId?: Id<'articles'>
  }
): Promise<string> {
  let slug = slugifyArticleTitle(args.title)
  if (!slug) {
    slug = `article-${Date.now()}`
  }

  const existing = await ctx.db
    .query('articles')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .filter((q) => {
      const sameAuthor = q.eq(q.field('authorId'), args.authorId)
      if (args.excludeArticleId === undefined) {
        return sameAuthor
      }
      return q.and(
        sameAuthor,
        q.neq(q.field('_id'), args.excludeArticleId)
      )
    })
    .first()

  return existing ? `${slug}-${Date.now()}` : slug
}
