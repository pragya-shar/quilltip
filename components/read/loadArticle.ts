import { READ_LIMIT_MS, withinReadLimit } from '@/shell/public/boundedRead'

/** What the article route answers with. */
export type ArticleLoad<A> =
  | { kind: 'found'; article: A }
  /** Unknown, draft or private: a real 404. */
  | { kind: 'missing' }
  /** A writer's earlier handle: redirect. */
  | { kind: 'moved'; to: string }
  /** The backend did not answer in time, or failed: never "not found". */
  | { kind: 'unreachable' }

export type ArticleReads<A> = {
  /** A published article, null when there is none, undefined on failure. */
  article(username: string, slug: string): Promise<A | null | undefined>
  /** The current path of a moved handle, or null. */
  moved(username: string, slug: string): Promise<string | null>
}

/**
 * Loads the article for the first response, with every read bounded,
 * so the page never waits without end. Worst-case time here: one limit for a found article, two for a
 * missing one (the moved-handle lookup runs after it).
 */
export async function loadArticle<A>(
  username: string,
  slug: string,
  reads: ArticleReads<A>,
  limitMs: number = READ_LIMIT_MS
): Promise<ArticleLoad<A>> {
  let article: A | null | undefined
  try {
    article = await withinReadLimit(reads.article(username, slug), limitMs)
  } catch {
    return { kind: 'unreachable' }
  }
  if (article === undefined) return { kind: 'unreachable' }
  if (article !== null) return { kind: 'found', article }
  try {
    const to = await withinReadLimit(reads.moved(username, slug), limitMs)
    return to ? { kind: 'moved', to } : { kind: 'missing' }
  } catch {
    return { kind: 'unreachable' }
  }
}
