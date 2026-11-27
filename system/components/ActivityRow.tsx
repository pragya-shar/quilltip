import Link from 'next/link'
import type { ReactNode } from 'react'
import { cx } from '../cx'
import { FailIcon, PendingIcon } from '../icons'
import type { MoneyValue } from '../money/figure'
import { Icon } from './Icon'
import { MoneyFigure } from './MoneyFigure'

export type ActivityStatus = 'sending' | 'pending' | 'done' | 'failed'

type ActivityRowProps = {
  /** An Avatar, or a round glyph for money added or withdrawn. */
  lead: ReactNode
  /** Who: "Tomás Reyes", "A reader", "AI reader", "Added money". */
  name: string
  /** What: the passage or the article title, quoted in the serif. */
  about?: string
  amount: MoneyValue
  /** in: money received (marker-ink, "+"). out: money sent ("−"). */
  direction: 'in' | 'out'
  status: ActivityStatus
  /** "Just now", "9:38", "Yesterday". Formatted by the surface. */
  time: string
  /** Overrides the status words. Defaults follow the copy deck. */
  statusText?: string
  /** Marks a row that arrived this session. */
  isNew?: boolean
  /** Opens the receipt. */
  href?: string
  /** One action beside the amount, such as Thank. Never inside the link. */
  action?: ReactNode
  className?: string
}

const STATUS_TEXT: Record<ActivityStatus, string> = {
  sending: 'Sending',
  pending: 'On its way',
  done: '',
  failed: 'Did not go through. You were not charged.',
}

/**
 * A money movement in a list. The amount is the money layer's figure; a
 * failed one is grey with no sign and counts in no total. Pending says "On
 * its way" with a clock, never in lime and never in red.
 */
export function ActivityRow({
  lead,
  name,
  about,
  amount,
  direction,
  status,
  time,
  statusText,
  isNew,
  href,
  action,
  className,
}: ActivityRowProps) {
  const failed = status === 'failed'
  const words = statusText ?? STATUS_TEXT[status]
  const title = href ? (
    <Link className="qt-activity__link" href={href}>
      {name}
    </Link>
  ) : (
    name
  )
  return (
    <div className={cx('qt-activity', className)} data-status={status}>
      <span className="qt-activity__lead">{lead}</span>
      <span className="qt-activity__main">
        <span className="qt-activity__name">
          {title}
          {isNew ? <span className="qt-activity__new">New</span> : null}
        </span>
        {about ? <span className="qt-activity__about">{about}</span> : null}
        {words ? (
          <span className="qt-activity__status">
            {status === 'pending' || status === 'sending' ? (
              <Icon icon={PendingIcon} size={16} />
            ) : failed ? (
              <Icon icon={FailIcon} size={16} />
            ) : null}
            {words}
          </span>
        ) : null}
      </span>
      <span className="qt-activity__end">
        <MoneyFigure
          value={amount}
          size="s"
          tone={failed ? 'muted' : direction === 'in' ? 'in' : 'default'}
          sign={failed ? undefined : direction === 'in' ? '+' : '−'}
        />
        <span className="qt-activity__time">{time}</span>
        {action ? <span className="qt-activity__action">{action}</span> : null}
      </span>
    </div>
  )
}
