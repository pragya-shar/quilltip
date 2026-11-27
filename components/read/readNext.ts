import { fetchQuery } from 'convex/nextjs'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { withinReadLimit } from '@/shell/public/boundedRead'
import type { ReadNextItem } from './readModel'

/** Read next is below the article: it never holds the page for long. */
export const READ_NEXT_LIMIT_MS = 400

/**
 * Read next, on the server, so the links are in the first response. It has
 * a short limit of its own; a late or failed read leaves the list
 * out, and the article is never held for it.
 */
export async function readNextFor(articleId: string): Promise<ReadNextItem[]> {
  try {
    const items = await withinReadLimit(
      fetchQuery(api.articles.getReadNextArticles, {
        articleId: articleId as Id<'articles'>,
      }),
      READ_NEXT_LIMIT_MS
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
