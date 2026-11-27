import type { ReactNode } from 'react'
import { cx } from '../cx'

type ProseProps = {
  /** read: an article body. line: a passage shown on its own (feed, share). */
  variant?: 'read' | 'line'
  /** Language of the text, when it differs from the page. */
  lang?: string
  /** Direction of the text; `auto` lets the browser pick per paragraph. */
  dir?: 'ltr' | 'rtl' | 'auto'
  className?: string
  children: ReactNode
}

/**
 * Reading typography: the serif, the measure, paragraph rhythm, quotes,
 * lists, links and emphasis inside an article body. Children are plain
 * elements (p, h2, blockquote, ul, a, em); Prose styles them.
 */
export function Prose({
  variant = 'read',
  lang,
  dir,
  className,
  children,
}: ProseProps) {
  return (
    <div
      className={cx('qt-prose', className)}
      data-variant={variant}
      lang={lang}
      dir={dir}
    >
      {children}
    </div>
  )
}
