import { PUBLISHED_PROSE_CLASS } from '@/lib/constants'
import { cn } from '@/lib/utils'

/**
 * Server-rendered article HTML, shown until the highlight editor is ready.
 * `article-static-body` matches the editor's text layout, so the swap does
 * not move or resize anything.
 */
export function ArticleStaticBody({
  html,
  className,
}: {
  html: string
  className?: string
}) {
  return (
    <div
      className={cn(
        PUBLISHED_PROSE_CLASS,
        'prose-stone highlightable-article article-static-body',
        className
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
