// Shared by the article content tests: the three reader paths and a DOM
// summary of what they render.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { ArticleReadOnlyBody } from '../../components/articles/ArticleReadOnlyBody'
import { renderArticleHtml } from '../../lib/tiptap/renderArticleHtml'
import { getReadOnlyExtensions } from '../../lib/tiptap/readExtensions'
import { createReaderYoutubeNode } from '../../lib/tiptap/youtubeEmbed'

export const ID = 'dQw4w9WgXcQ'
export const EMBED = `https://www.youtube-nocookie.com/embed/${ID}?rel=1`
export const video = (src: unknown, attrs: Record<string, unknown> = {}) => ({
  type: 'youtube',
  attrs: { src, ...attrs },
})
export const image = (n: number) => ({
  type: 'resizableImage',
  attrs: { src: `https://example.test/api/storage/${n}`, alt: `image ${n}` },
})
export const doc = (...content: JSONContent[]): JSONContent => ({
  type: 'doc',
  content,
})

export function inspect(html: string) {
  const root = document.createElement('div')
  root.innerHTML = html
  return {
    frames: [...root.querySelectorAll('iframe')].map((f) => ({
      src: f.getAttribute('src'),
      width: f.getAttribute('width'),
    })),
    hiddenVideos: root.querySelectorAll('[data-youtube-video][hidden]').length,
    images: root.querySelectorAll('img').length,
    text: root.textContent,
  }
}

// The three reader paths: the server HTML, the client body, and the
// highlight editor (its video node and media limit, as HighlightableArticle
// configures them).
export const readers: [string, (content: JSONContent) => string][] = [
  ['server renderer', (content) => renderArticleHtml(content)!],
  [
    'client body',
    (content) =>
      renderToStaticMarkup(createElement(ArticleReadOnlyBody, { content })),
  ],
  [
    'highlight editor',
    (content) => {
      const editor = new Editor({
        extensions: [
          StarterKit,
          createReaderYoutubeNode(),
          ...getReadOnlyExtensions().filter((e) => e.name === 'resizableImage'),
        ],
        content,
        editable: false,
      })
      const html = editor.view.dom.innerHTML
      editor.destroy()
      return html
    },
  ],
]
