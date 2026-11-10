'use client'
import TextAlign from '@tiptap/extension-text-align'
import { useMemo } from 'react'
import { generateHTML } from '@tiptap/html'
import { type JSONContent } from '@tiptap/core'
import { PUBLISHED_PROSE_CLASS } from '@/lib/constants'
import { getReadOnlyExtensions } from '@/lib/tiptap/readExtensions'
export function WritingPreview({ content }: { content: JSONContent }) {
  const html = useMemo(
    () =>
      generateHTML(content, [
        ...getReadOnlyExtensions(),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
      ]),
    [content]
  )
  return (
    <div className="article-content">
      <div
        className={`${PUBLISHED_PROSE_CLASS} prose-stone`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
