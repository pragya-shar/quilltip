'use client'

import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'

/** The fields that change when a writer edits a published article. */
export type ArticleVersion = {
  _id: string
  updatedAt?: number
  contentVersion?: number
}

/**
 * The page against the live article (from the legacy reader's live-or-server
 * choice). The server copy is what the reader sees; the live query only
 * says whether that copy is still the article:
 * - `server`: the live answer has not arrived (or there is no backend).
 * - `current`: the live article is the one on the page.
 * - `changed`: the writer edited it since this page was rendered.
 * - `gone`: it was unpublished or deleted. The text stays on the page.
 */
export type ArticleViewStatus = 'server' | 'current' | 'changed' | 'gone'

export function articleViewStatus(
  server: ArticleVersion,
  live: ArticleVersion | null | undefined
): ArticleViewStatus {
  if (live === undefined) return 'server'
  if (live === null || live._id !== server._id) return 'gone'
  const edited =
    (live.contentVersion ?? 0) !== (server.contentVersion ?? 0) ||
    (live.updatedAt ?? 0) > (server.updatedAt ?? 0)
  return edited ? 'changed' : 'current'
}

type HighlightTipStats = {
  topHighlights?: {
    highlightId: string
    tipCount: number
    totalAmountCents: number
  }[]
} | null

/**
 * Tips per highlight, from the article's highlight tip stats (from the
 * legacy reader). For the writer's own-article mode, which reads line
 * totals from the counts package when it lands.
 */
export function tipsByHighlight(
  stats: HighlightTipStats | undefined
): Record<string, { count: number; totalUsd: number }> {
  if (!stats?.topHighlights) return {}
  return Object.fromEntries(
    stats.topHighlights.map((h) => [
      h.highlightId,
      { count: h.tipCount, totalUsd: h.totalAmountCents / 100 },
    ])
  )
}

/**
 * Whether the server copy on the page is still the published article. The
 * text never waits for this: it is a quiet enhancement after the page is
 * readable.
 */
export function useArticleView(
  username: string,
  slug: string,
  server: ArticleVersion
): ArticleViewStatus {
  const live = useQuery(api.articles.getArticleBySlug, { username, slug })
  return articleViewStatus(server, live as ArticleVersion | null | undefined)
}
