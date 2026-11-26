import { describe, expect, it } from 'vitest'
import { renderArticleHtml } from '@/lib/tiptap/renderArticleHtml'
import {
  EAGER_OPENING_BLOCKS,
  markBodyImagesLazy,
} from '@/lib/tiptap/markBodyImagesLazy'

const image = (src: string) => ({
  type: 'resizableImage',
  attrs: { src, alt: 'A harbour', title: null, width: 1200, height: 800 },
})
const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})

const doc = {
  type: 'doc',
  content: [
    image('https://images.unsplash.com/opening.jpg'),
    paragraph('First paragraph.'),
    paragraph('Second paragraph.'),
    image('https://images.unsplash.com/later.jpg'),
    {
      type: 'blockquote',
      content: [image('https://images.unsplash.com/quoted.jpg')],
    },
  ],
}

describe('article body images', () => {
  it('keeps the opening images eager and makes later ones lazy', () => {
    const html = renderArticleHtml(doc) ?? ''
    const tags = html.match(/<img[^>]*>/g) ?? []
    expect(tags).toHaveLength(3)
    expect(tags[0]).toContain('opening.jpg')
    expect(tags[0]).not.toContain('loading=')
    expect(tags[1]).toContain('loading="lazy"')
    expect(tags[1]).toContain('decoding="async"')
    expect(tags[2]).toContain('loading="lazy"')
  })

  it('keeps width and height, so lazy images reserve their space', () => {
    const html = renderArticleHtml(doc) ?? ''
    for (const tag of html.match(/<img[^>]*>/g) ?? []) {
      expect(tag).toContain('width="1200"')
      expect(tag).toContain('height="800"')
    }
  })

  it('does not change the stored document', () => {
    const before = JSON.stringify(doc)
    markBodyImagesLazy(doc)
    expect(JSON.stringify(doc)).toBe(before)
    expect(EAGER_OPENING_BLOCKS).toBe(2)
  })
})
