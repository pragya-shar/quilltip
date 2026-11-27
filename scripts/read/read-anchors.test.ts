import { describe, expect, it } from 'vitest'
import {
  paragraphNumbers,
  parseReadAnchor,
  readAnchor,
} from '@/lib/tiptap/readAnchors'
import { renderArticleHtml } from '@/lib/tiptap/renderArticleHtml'
import { renderReadingHtml } from '@/lib/tiptap/renderReadingHtml'

const text = (t: string) => ({ type: 'text', text: t })
const p = (t: string) => ({ type: 'paragraph', content: [text(t)] })
const doc = {
  type: 'doc',
  content: [
    p('One. Two.'),
    { type: 'heading', attrs: { level: 2 }, content: [text('A heading')] },
    p('Three.'),
    { type: 'blockquote', content: [p('Quoted.')] },
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [p('Listed.')] }],
    },
    p('Four.'),
  ],
}

describe('the anchor scheme', () => {
  it('writes and reads #s-{p}-{k}', () => {
    expect(readAnchor(3)).toBe('s-3-0')
    expect(readAnchor(3, 2)).toBe('s-3-2')
    expect(parseReadAnchor('#s-3-2')).toEqual({ paragraph: 3, sentence: 2 })
    expect(parseReadAnchor('s-0-0')).toEqual({ paragraph: 0, sentence: 0 })
    for (const bad of ['', '#s-3', '#s-a-0', '#x-1-0', '#s-1-0-1'])
      expect(parseReadAnchor(bad), bad).toBeNull()
  })

  it('counts top-level paragraphs only', () => {
    expect(paragraphNumbers(doc)).toEqual([0, null, 1, null, null, 2])
    expect(paragraphNumbers(null)).toEqual([])
  })
})

describe('the server HTML carries the anchors', () => {
  it('gives each top-level paragraph its id, and nested ones none', () => {
    const { html } = renderReadingHtml(doc)
    expect(html).toContain('<p id="s-0-0">One. Two.</p>')
    expect(html).toContain('<p id="s-1-0">Three.</p>')
    expect(html).toContain('<p id="s-2-0">Four.</p>')
    expect(html).toContain('<blockquote><p>Quoted.</p></blockquote>')
    expect(html).toContain('<li><p>Listed.</p></li>')
    expect(html).toContain('<h2 id="a-heading">A heading</h2>')
  })

  it('is the article HTML apart from the ids', () => {
    const { html } = renderReadingHtml(doc)
    expect(html!.replace(/ id="[^"]+"/g, '')).toBe(renderArticleHtml(doc))
  })

  it('renders nothing for no content', () => {
    expect(renderReadingHtml(null).html).toBeUndefined()
  })
})
