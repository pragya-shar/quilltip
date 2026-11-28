import type { ElementType, ReactNode } from 'react'
import { cx } from '../cx'

export type TextSize = 'ui-l' | 'ui' | 'ui-s' | 'ui-xs'
export type TextTone = 'ink' | 'ink-2' | 'ink-3' | 'money-in' | 'danger'

type TextProps = {
  as?: ElementType
  size?: TextSize
  tone?: TextTone
  weight?: 'regular' | 'medium' | 'strong'
  /** One line with an ellipsis; the full text stays in the accessibility tree. */
  truncate?: boolean
  /** Tabular figures, for numbers that change in place. */
  numeric?: boolean
  id?: string
  className?: string
  children: ReactNode
}

/** Interface text in the platform face. */
export function Text({
  as: Tag = 'span',
  size = 'ui',
  tone = 'ink',
  weight = 'regular',
  truncate,
  numeric,
  id,
  className,
  children,
}: TextProps) {
  return (
    <Tag
      id={id}
      className={cx('qt-text', className)}
      data-size={size}
      data-tone={tone}
      data-weight={weight}
      data-truncate={truncate || undefined}
      data-numeric={numeric || undefined}
    >
      {children}
    </Tag>
  )
}
