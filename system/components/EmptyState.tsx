import type { ReactNode } from 'react'
import { cx } from '../cx'
import { Icon, type IconGlyph } from './Icon'

type EmptyStateProps = {
  icon?: IconGlyph
  /** What is empty, said plainly: "Your tips show up here." */
  title: ReactNode
  /** One sentence on what fills it, when that helps. */
  body?: ReactNode
  /** One action that fills it. */
  action?: ReactNode
  className?: string
}

/** A place with nothing in it yet, and the one way to fill it. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cx('qt-empty', className)}>
      {icon ? (
        <span className="qt-empty__icon" aria-hidden="true">
          <Icon icon={icon} size={28} />
        </span>
      ) : null}
      <p className="qt-empty__title">{title}</p>
      {body ? <p className="qt-empty__body">{body}</p> : null}
      {action ? <div className="qt-empty__action">{action}</div> : null}
    </div>
  )
}
