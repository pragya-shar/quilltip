'use client'

import { useEffect, useMemo } from 'react'
import {
  formatMoney,
  tipTargetOf,
  useBalance,
  useTip,
  type BalanceView,
  type Money,
  type TipController,
  type TipMeta,
  type TipTarget,
} from '@/hooks/read/payments'
import type { ChosenLine } from './LineEngine'
import type { ReadArticle } from './readModel'

/** What the money layer says for the tip bar, once its code has loaded. */
export type LiveTipValue = {
  tip: TipController
  balance: BalanceView
  /** A button's amount in the layer's short form: "$1", "$0.50". */
  short: (amount: Money) => Money
}

export type LiveTipProps = {
  article: ReadArticle
  passage: ChosenLine | null
  /** Each new reading, and null when this unmounts. */
  onLive: (live: LiveTipValue | null) => void
}

const short = (amount: Money): Money => ({
  ...amount,
  display: formatMoney(amount.cents, { short: true }),
})

/**
 * The tip bar's money layer: `useTip` and `useBalance` for the article or
 * the chosen line, reported to the bar, which draws everything. This is the
 * only part of the bar that imports the layer's runtime, so it loads after
 * the page (`liveTipLoader.ts`), never in the first load; the bar draws
 * from the server's first paint until it reports.
 */
export function LiveTip({ article, passage, onLive }: LiveTipProps) {
  const balance = useBalance()
  const target = useMemo<TipTarget>(
    () =>
      // The island loads this only for a valid article id.
      tipTargetOf(
        article.id,
        passage
          ? {
              text: passage.text,
              startOffset: passage.startOffset,
              endOffset: passage.endOffset,
              startContainerPath: passage.startContainerPath,
              endContainerPath: passage.endContainerPath,
            }
          : undefined
      ) as TipTarget,
    [article.id, passage]
  )
  const meta = useMemo<TipMeta>(
    () => ({
      articleTitle: article.title,
      writerName: article.writer.name,
      href: article.href,
    }),
    [article.title, article.writer.name, article.href]
  )
  const tip = useTip(target, meta)
  useEffect(() => onLive({ tip, balance, short }), [tip, balance, onLive])
  useEffect(() => () => onLive(null), [onLive])
  return null
}
