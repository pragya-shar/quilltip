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
  /** The title as a heading of this level, when the empty place is a
   * section of the page (an empty Shelf: 1 or 2). Without it the title is
   * a paragraph. */
  headingLevel?: 1 | 2 | 3
  className?: string
}

/** A place with nothing in it yet, and the one way to fill it. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  headingLevel,
  className,
}: EmptyStateProps) {
  const Title = headingLevel ? (`h${headingLevel}` as const) : 'p'
  return (
    <div className={cx('qt-empty', className)}>
      {icon ? (
        <span className="qt-empty__icon" aria-hidden="true">
          <Icon icon={icon} size={28} />
        </span>
      ) : null}
      <Title className="qt-empty__title">{title}</Title>
      {body ? <p className="qt-empty__body">{body}</p> : null}
      {action ? <div className="qt-empty__action">{action}</div> : null}
    </div>
  )
}
