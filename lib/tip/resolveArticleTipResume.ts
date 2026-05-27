import type { Id } from '@/convex/_generated/dataModel'
import {
  hasArticleTipResumeFlag,
  parseArticleTipResumeFromSearchParams,
} from '@/lib/tip/articleTipResumeUrl'
import {
  matchesArticlePendingIntent,
  readPendingTipIntent,
  type ArticlePendingTipIntent,
} from '@/lib/tip/pendingTipIntent'

export function resolveArticleTipResume(
  articleId: Id<'articles'>,
  searchParams: URLSearchParams
): ArticlePendingTipIntent | null {
  const fromStorage = readPendingTipIntent()
  if (matchesArticlePendingIntent(fromStorage, articleId)) {
    return fromStorage
  }

  return parseArticleTipResumeFromSearchParams(searchParams, articleId)
}

export function shouldKeepTryingArticleTipResume(
  articleId: Id<'articles'> | undefined,
  searchParams: URLSearchParams
): boolean {
  if (articleId === undefined) return false
  if (hasArticleTipResumeFlag(searchParams)) return true

  const pending = readPendingTipIntent()
  return matchesArticlePendingIntent(pending, articleId)
}
