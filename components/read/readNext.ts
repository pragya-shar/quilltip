import { fetchQuery } from 'convex/nextjs'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import type { ReadNextItem } from './readModel'

/**
 * Read next, on the server, so the links are in the first response. A
 * failure leaves the list out; the article never waits on it to fail
 * loudly.
 */
export async function readNextFor(articleId: string): Promise<ReadNextItem[]> {
  try {
    const items = await fetchQuery(api.articles.getReadNextArticles, {
      articleId: articleId as Id<'articles'>,
    })
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
