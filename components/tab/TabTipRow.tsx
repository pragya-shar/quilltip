import {
  ExplorerLink,
  PaymentStatusLabel,
  XlmAmount,
} from '@/components/payments'
import { TAB_HISTORY } from '@/lib/copy/tab'
import { phaseFromTabTip } from '@/lib/payments/ui-state'
import type { TabTipRow as Row } from '@/lib/tab-ui/types'

const time = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

/** One tab tip: article, writer, when, amount and its receipt status. */
export function TabTipRow({ tip }: { tip: Row }) {
  const phase = phaseFromTabTip(tip.status)
  const href =
    tip.authorUsername && tip.articleSlug
      ? `/${tip.authorUsername}/${tip.articleSlug}`
      : null
  return (
    <div className="tab-tip-row">
      <div className="tab-tip-main">
        <p className="tab-tip-title">
          {tip.articleTitle ?? TAB_HISTORY.heading}
        </p>
        <p className="tab-tip-meta">
          {tip.authorName ? (
            <span>{TAB_HISTORY.to(tip.authorName)}</span>
          ) : null}
          {tip.highlight ? <span>{TAB_HISTORY.highlight}</span> : null}
          <time dateTime={new Date(tip.acceptedAt).toISOString()}>
            {time.format(tip.acceptedAt)}
          </time>
          {href ? (
            <a href={href} className="tab-inline-link">
              {TAB_HISTORY.readMore}
              <span className="sr-only">: {tip.articleTitle}</span>
            </a>
          ) : null}
        </p>
      </div>
      <div className="tab-tip-side">
        <span className="tab-tip-amount">
          <XlmAmount amount={tip.amount} />
        </span>
        <PaymentStatusLabel phase={phase} />
        {tip.status === 'ACCEPTED' ? (
          <span className="tab-subtle">{TAB_HISTORY.accepted}</span>
        ) : null}
        {tip.settledTxHash ? <ExplorerLink hash={tip.settledTxHash} /> : null}
      </div>
    </div>
  )
}
