// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { generateHTML, generateJSON } from '@tiptap/html/server'
import { expect, it } from 'vitest'
import { ArticleReadOnlyBody } from '../../../components/articles/ArticleReadOnlyBody'
import { WritingPreview } from '../../../components/editor/WritingPreview'
import { getReadOnlyExtensions } from '../../../lib/tiptap/readExtensions'
import type { JSONContent } from '@tiptap/core'

const content: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'A heading' }],
    },
    {
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [
        { type: 'text', text: 'An exact passage & <literal text>. ' },
        { type: 'text', text: 'Strong', marks: [{ type: 'bold' }] },
        {
          type: 'text',
          text: 'Link',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
      ],
    },
    {
      type: 'resizableImage',
      attrs: {
        src: 'https://example.com/image.png',
        alt: 'Accessible image',
        title: 'A caption & <text>',
        width: 640,
      },
    },
    {
      type: 'codeBlock',
      attrs: { language: 'javascript' },
      content: [{ type: 'text', text: 'const answer = 42' }],
    },
    {
      type: 'youtube',
      attrs: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    },
  ],
}

function checkHtml(html: string) {
  const root = document.createElement('div')
  root.innerHTML = html
  expect(root.querySelector('h2')?.textContent).toBe('A heading')
  expect(root.querySelector('p')?.textContent).toBe(
    'An exact passage & <literal text>. StrongLink'
  )
  expect(root.querySelector('strong')?.textContent).toBe('Strong')
  expect(root.querySelector('a')?.getAttribute('rel')).toContain('noopener')
  expect(root.querySelector('figcaption')?.textContent).toBe(
    'A caption & <text>'
  )
  expect(root.querySelector('img')?.getAttribute('width')).toBe('640')
  expect(root.querySelector('code')?.textContent).toBe('const answer = 42')
  expect(root.querySelector('iframe')?.getAttribute('src')).toContain(
    'youtube-nocookie.com/embed/dQw4w9WgXcQ'
  )
  return root
}

it('serializes and parses rich article JSON with Tiptap and Happy DOM 21', () => {
  const extensions = getReadOnlyExtensions()
  const html = generateHTML(content, extensions)
  checkHtml(html)
  checkHtml(generateHTML(generateJSON(html, extensions), extensions))
})

it('renders the real article body and writing preview with the same exact text', () => {
  checkHtml(
    renderToStaticMarkup(createElement(ArticleReadOnlyBody, { content }))
  )
  const preview = checkHtml(
    renderToStaticMarkup(createElement(WritingPreview, { content }))
  )
  expect(preview.querySelector('p')?.style.textAlign).toBe('center')
})
