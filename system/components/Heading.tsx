import type { ReactNode } from 'react'
import { cx } from '../cx'

type HeadingProps = {
  /** The document level. The look is chosen apart from it. */
  level: 1 | 2 | 3
  /** display: an article title. title: a screen or sheet title. section: a
   * group heading in the platform face. */
  variant?: 'display' | 'title' | 'section'
  id?: string
  className?: string
  children: ReactNode
}

export function Heading({
  level,
  variant = level === 1 ? 'title' : 'section',
  id,
  className,
  children,
}: HeadingProps) {
  const Tag = `h${level}` as const
  return (
    <Tag id={id} className={cx('qt-heading', className)} data-variant={variant}>
      {children}
    </Tag>
  )
}
