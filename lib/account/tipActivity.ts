import type { FunctionReturnType } from 'convex/server'
import type { api } from '@/convex/_generated/api'
import type { Id } from '@/types/convex'
import { articleHref } from '@/lib/library/bookmarks'

export type TipActivitySources = {
  sentArticles: FunctionReturnType<typeof api.tips.getUserSentTips>
  receivedArticles: FunctionReturnType<typeof api.tips.getUserReceivedTips>
  sentPassages: FunctionReturnType<typeof api.highlightTips.getByTipper>
  receivedPassages: FunctionReturnType<typeof api.highlightTips.getByAuthor>
}
type ActivityBase = {
  key: string
  direction: 'sent' | 'received'
  status: string
  createdAt: number
  amountCents: number
  counterpart: string
  articleTitle: string
  articleHref: string | null
  message?: string
  failureReason?: string
  stellarTxId?: string
  stellarNetwork?: string
  stellarAmountXlm?: string
  amountUsdSuspicious?: boolean
}
export type TipActivityItem = ActivityBase &
  (
    | { kind: 'article'; id: Id<'tips'> }
    | {
        kind: 'passage'
        id: Id<'highlightTips'>
        highlightText: string
        highlightId: string
      }
  )

export function normalizeTipActivity(
  input: TipActivitySources
): TipActivityItem[] {
  const rows: TipActivityItem[] = []
  for (const [direction, articles, passages] of [
    ['sent', input.sentArticles, input.sentPassages],
    ['received', input.receivedArticles, input.receivedPassages],
  ] as const) {
    for (const tip of [...articles, ...passages]) {
      const source = tip.sourceArticle
      const base: ActivityBase = {
        key: `${'highlightText' in tip ? 'highlightTips' : 'tips'}:${tip._id}:${direction}`,
        direction,
        status: tip.status,
        createdAt: tip.createdAt,
        amountCents: tip.amountCents,
        counterpart:
          tip.tipperId === tip.authorId
            ? 'yourself'
            : (direction === 'sent' ? tip.authorName : tip.tipperName) ||
              (direction === 'received' && 'tipper' in tip
                ? tip.tipper?.name || tip.tipper?.username
                : undefined) ||
              (direction === 'sent' ? 'Unknown writer' : 'Unknown reader'),
        articleTitle: source?.title || tip.articleTitle,
        articleHref: source
          ? articleHref({ username: source.authorUsername, slug: source.slug })
          : null,
        message: tip.message,
        failureReason: tip.failureReason,
        stellarTxId: tip.stellarTxId,
        stellarNetwork: tip.stellarNetwork,
        stellarAmountXlm: tip.stellarAmountXlm,
        amountUsdSuspicious:
          'amountUsdSuspicious' in tip ? tip.amountUsdSuspicious : undefined,
      }
      rows.push(
        'highlightText' in tip
          ? {
              ...base,
              kind: 'passage',
              id: tip._id,
              highlightText: tip.highlightText,
              highlightId: tip.highlightId,
            }
          : { ...base, kind: 'article', id: tip._id }
      )
    }
  }
  return rows.sort(
    (a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key)
  )
}
