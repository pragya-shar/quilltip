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
  /** The contract generation the row was recorded with. */
  contractVersion: 'v1' | 'v2'
  /** How a v2 tip was paid: a direct or batch wallet payment, or a tab. */
  channel?: 'direct' | 'batch' | 'tab'
  /** v2 `MISMATCH` only: `author` when paid to the registered address. */
  mismatchReason?: string
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

/**
 * A tab tip that was prepared but never accepted (#706): a refused or
 * abandoned submit leaves it `PREPARED`, and the expiry cron moves it to
 * `EXPIRED`. It moved no value, so it is not a sent tip.
 */
export function isUnacceptedTabTip(
  item: Pick<ActivityBase, 'channel' | 'status'>
): boolean {
  return (
    item.channel === 'tab' &&
    (item.status === 'PREPARED' || item.status === 'EXPIRED')
  )
}

/** The rows of the tip history, newest first, without unaccepted tab tips. */
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
        contractVersion: tip.contractVersion === 'v2' ? 'v2' : 'v1',
        channel: tip.channel,
        mismatchReason:
          'mismatchReason' in tip && typeof tip.mismatchReason === 'string'
            ? tip.mismatchReason
            : undefined,
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
  return rows
    .filter((row) => !isUnacceptedTabTip(row))
    .sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key))
}
