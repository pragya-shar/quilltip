import Link from 'next/link'
import type { ReactNode } from 'react'
import { cx } from '../cx'
import { ForwardIcon } from '../icons'
import { Icon } from './Icon'

type ListRowProps = {
  /** An Avatar or a round icon, 42 px. */
  lead?: ReactNode
  title: ReactNode
  /** One line under the title; cut with an ellipsis. */
  subtitle?: ReactNode
  /** serif: the subtitle is quoted writing (a passage, a title). */
  subtitleFace?: 'ui' | 'serif'
  /** Right side: a figure, a Switch, a short value. */
  trailing?: ReactNode
  /** Under the trailing value: a time, a status. */
  trailingMeta?: ReactNode
  /** The whole row opens this page. Adds a chevron unless `trailing` is set. */
  href?: string
  /** The whole row is one action. */
  onPress?: () => void
  className?: string
}

/**
 * One line in a list. Static, a link, or a button; never a link with
 * buttons inside it. At least 56 px tall, with a hairline below.
 */
export function ListRow({
  lead,
  title,
  subtitle,
  subtitleFace = 'ui',
  trailing,
  trailingMeta,
  href,
  onPress,
  className,
}: ListRowProps) {
  const content = (
    <>
      {lead ? <span className="qt-row__lead">{lead}</span> : null}
      <span className="qt-row__main">
        <span className="qt-row__title">{title}</span>
        {subtitle ? (
          <span className="qt-row__subtitle" data-face={subtitleFace}>
            {subtitle}
          </span>
        ) : null}
      </span>
      {trailing || trailingMeta ? (
        <span className="qt-row__trailing">
          {trailing}
          {trailingMeta ? (
            <span className="qt-row__meta">{trailingMeta}</span>
          ) : null}
        </span>
      ) : href ? (
        <span className="qt-row__chevron" aria-hidden="true">
          <Icon icon={ForwardIcon} size={20} />
        </span>
      ) : null}
    </>
  )
  const props = { className: cx('qt-row', className) }
  if (href)
    return (
      <Link {...props} href={href} data-interactive="">
        {content}
      </Link>
    )
  if (onPress)
    return (
      <button {...props} type="button" onClick={onPress} data-interactive="">
        {content}
      </button>
    )
  return <div {...props}>{content}</div>
}
