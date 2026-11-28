import type { ReactNode } from 'react'
import { cx } from '../cx'
import {
  DoneIcon,
  FailIcon,
  InfoIcon,
  OfflineIcon,
  PendingIcon,
} from '../icons'
import { Icon } from './Icon'

export type NoticeTone = 'info' | 'pending' | 'offline' | 'failure' | 'done'

const GLYPH = {
  info: InfoIcon,
  pending: PendingIcon,
  offline: OfflineIcon,
  failure: FailIcon,
  done: DoneIcon,
}

type NoticeProps = {
  /** pending: slow but fine (never lime, never red). failure: it did not work. */
  tone?: NoticeTone
  title?: ReactNode
  children: ReactNode
  /** One action, a Button or TextLink. */
  action?: ReactNode
  /** Announce when it appears (a new failure). Static notices stay quiet. */
  live?: boolean
  className?: string
}

/** A message in the page, next to what it is about. It does not float. */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  live,
  className,
}: NoticeProps) {
  return (
    <div
      className={cx('qt-notice', className)}
      data-tone={tone}
      role={live ? (tone === 'failure' ? 'alert' : 'status') : undefined}
    >
      <span className="qt-notice__glyph" aria-hidden="true">
        <Icon icon={GLYPH[tone]} size={20} />
      </span>
      <div className="qt-notice__text">
        {title ? <p className="qt-notice__title">{title}</p> : null}
        <div className="qt-notice__body">{children}</div>
        {action ? <div className="qt-notice__action">{action}</div> : null}
      </div>
    </div>
  )
}
