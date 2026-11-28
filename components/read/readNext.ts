import { fetchQuery } from 'convex/nextjs'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { READ_LIMIT_MS, withinReadLimit } from '@/shell/public/boundedRead'
import type { ReadNextItem } from './readModel'

/** Read next is below the article: it never holds the page for long. */
export const READ_NEXT_LIMIT_MS = 400

/**
 * Read next's time, out of the page's one limit: at most its own short
 * limit, and never past what the article read left (none: no read).
 */
export function readNextBudget(elapsedMs: number): number {
  return Math.max(0, Math.min(READ_NEXT_LIMIT_MS, READ_LIMIT_MS - elapsedMs))
}

/**
 * Read next, on the server, so the links are in the first response. It has
 * a short limit of its own; a late or failed read leaves the list
 * out, and the article is never held for it.
 */
export async function readNextFor(
  articleId: string,
  limitMs: number = READ_NEXT_LIMIT_MS
): Promise<ReadNextItem[]> {
  if (limitMs <= 0) return []
  try {
    const items = await withinReadLimit(
      fetchQuery(api.articles.getReadNextArticles, {
        articleId: articleId as Id<'articles'>,
      }),
      limitMs
    )
    return items.map((item) => ({
      id: item.id,
      title: item.title,
      href: `/${item.username}/${item.slug}`,
      opening: item.opening,
    }))
  } catch {
    return []
  }
}
