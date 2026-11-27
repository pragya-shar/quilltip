import type { ReactNode } from 'react'
import { cx } from '../cx'

type ProseProps = {
  /** read: an article body. line: a passage shown on its own (feed, share). */
  variant?: 'read' | 'line'
  /** Language of the text, when it differs from the page. */
  lang?: string
  /** Direction of the text; `auto` lets the browser pick per paragraph. */
  dir?: 'ltr' | 'rtl' | 'auto'
  /** The first line of the first paragraph in small caps (an article's
   * opening; not in the editor). */
  leadIn?: boolean
  className?: string
  children: ReactNode
}

/**
 * Reading typography: the serif, the measure, paragraph rhythm, quotes,
 * lists, links, emphasis, figures and footnotes inside an article body
 *. Children are plain elements (p, h2, blockquote, ul, a, em,
 * figure with figcaption, `a.qt-fn-ref` for a footnote reference,
 * `.qt-footnotes` for the notes); Prose styles them.
 */
export function Prose({
  variant = 'read',
  lang,
  dir,
  leadIn,
  className,
  children,
}: ProseProps) {
  return (
    <div
      className={cx('qt-prose', className)}
      data-variant={variant}
      data-lead-in={leadIn || undefined}
      lang={lang}
      dir={dir}
    >
      {children}
    </div>
  )
}
