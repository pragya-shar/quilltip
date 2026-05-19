'use client'

import { useMemo } from 'react'
import { generateHTML } from '@tiptap/html'
import type { JSONContent } from '@tiptap/core'
import { getReadOnlyExtensions } from '@/lib/tiptap/readExtensions'
import { EDITOR_PROSE_CLASS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useEnsureHeadingIds } from '@/components/articles/useEnsureHeadingIds'
import type { TocHeading } from '@/lib/tiptap/headings'

interface ArticleReadOnlyBodyProps {
  content: JSONContent
  tocHeadings?: TocHeading[]
  className?: string
}

export function ArticleReadOnlyBody({
  content,
  tocHeadings = [],
  className,
}: ArticleReadOnlyBodyProps) {
  const extensions = useMemo(() => getReadOnlyExtensions(), [])

  const html = useMemo(
    () => generateHTML(content, extensions),
    [content, extensions]
  )

  useEnsureHeadingIds(tocHeadings, { rootSelector: '.article-content' })

  return (
    <div
      className={cn(
        EDITOR_PROSE_CLASS,
        'prose-stone highlightable-article',
        className
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
