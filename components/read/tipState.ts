import { fetchQuery } from 'convex/nextjs'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { withinReadLimit } from '@/shell/public/boundedRead'

/**
 * Whether the article can take a tip at all, on the server, from the
 * public facts of the money layer's tip context (`balance.tipContext`, read
 * with no account): registered for tips on this chain, one recipient, the
 * writer's verified address. True, false, or null when it is not known in
 * time. It decides only for everyone at once; the reader's own facts (their
 * balance, their own article) stay the money layer's, in the browser.
 */
export async function articleTippable(
  articleId: string,
  limitMs: number
): Promise<boolean | null> {
  if (limitMs <= 0) return null
  try {
    const context = await withinReadLimit(
      fetchQuery(api.balance.tipContext, {
        articleId: articleId as Id<'articles'>,
      }),
      limitMs
    )
    return context.tippable
  } catch {
    return null
  }
}
