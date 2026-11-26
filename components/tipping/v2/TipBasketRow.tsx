'use client'

import { useEffect } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import type { BasketItem } from '@/lib/tip/v2/basket'
import { formatCents } from '@/lib/tip/v2/amount'
import { BASKET_COPY } from '@/lib/copy/tip-flow'

interface TipBasketRowProps {
  item: BasketItem
  /** The server refused this item when the basket was prepared. */
  refused: boolean
  disabled: boolean
  onRemove: (item: BasketItem) => void
  /** Reports whether the article can take tips now. */
  onAvailability: (id: string, available: boolean) => void
}

const UNAVAILABLE = new Set([
  'ARTICLE_NOT_REGISTERED',
  'ARTICLE_NOT_FOUND',
  'PAYOUT_ADDRESS_CHANGED',
  'SELF_TIP',
])

/** One tip in the basket, with its own availability check and Remove. */
export function TipBasketRow({
  item,
  refused,
  disabled,
  onRemove,
  onAvailability,
}: TipBasketRowProps) {
  const eligibility = useQuery(api.tipsV2.getTipEligibility, {
    articleId: item.articleId as Id<'articles'>,
  })
  const unavailable =
    refused || (!!eligibility?.reason && UNAVAILABLE.has(eligibility.reason))
  useEffect(() => {
    onAvailability(item.id, !unavailable)
  }, [item.id, unavailable, onAvailability])

  const title = item.articleTitle || item.authorName
  return (
    <li className="tip-basket-row" data-unavailable={unavailable || undefined}>
      <div>
        <p className="tip-basket-row-title">{title}</p>
        <p className="tip-basket-row-kind">
          {item.highlight ? BASKET_COPY.itemPassage : BASKET_COPY.itemArticle}{' '}
          · {item.authorName}
        </p>
        {item.highlight ? (
          <p className="tip-basket-row-passage">“{item.highlight.text}”</p>
        ) : null}
      </div>
      <div className="tip-basket-row-side">
        <span className="tip-basket-row-amount">
          {formatCents(item.amountCents)}
        </span>
        <button
          type="button"
          className="tip-basket-remove"
          onClick={() => onRemove(item)}
          disabled={disabled}
          aria-label={BASKET_COPY.removeLabel(
            item.highlight ? `the passage in ${title}` : title
          )}
        >
          {BASKET_COPY.remove}
        </button>
      </div>
      {unavailable ? (
        <p className="tip-basket-row-note">{BASKET_COPY.itemUnavailableNote}</p>
      ) : null}
    </li>
  )
}
