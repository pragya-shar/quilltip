'use client'
import TextAlign from '@tiptap/extension-text-align'
import { useMemo } from 'react'
import { generateHTML } from '@tiptap/html'
import { type JSONContent } from '@tiptap/core'
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
    <div className="preview-body" dangerouslySetInnerHTML={{ __html: html }} />
  )
}
