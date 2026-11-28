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

/** Suffixed slugs tried after the plain one before a random suffix. */
const SLUG_ATTEMPTS = 16

/**
 * The title's slug, or the slug with a suffix when the author already has an
 * article with it. Every candidate, suffixed ones included, is checked for
 * that author, so creates in the same millisecond never share a slug.
 */
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

  const taken = async (candidate: string) =>
    (await ctx.db
      .query('articles')
      .withIndex('by_slug', (q) => q.eq('slug', candidate))
      .filter((q) => {
        const sameAuthor = q.eq(q.field('authorId'), args.authorId)
        if (args.excludeArticleId === undefined) {
          return sameAuthor
        }
        return q.and(sameAuthor, q.neq(q.field('_id'), args.excludeArticleId))
      })
      .first()) !== null

  if (!(await taken(slug))) return slug
  const stamp = Date.now()
  for (let n = 0; n < SLUG_ATTEMPTS; n++) {
    const candidate = n === 0 ? `${slug}-${stamp}` : `${slug}-${stamp}-${n + 1}`
    if (!(await taken(candidate))) return candidate
  }
  return `${slug}-${stamp}-${Math.random().toString(36).slice(2, 10)}`
}
