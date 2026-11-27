import { describe, expect, it } from 'vitest'
import {
  bodyParagraphNodes,
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
    { type: 'paragraph', content: [{ type: 'hardBreak' }] },
    { type: 'paragraph' },
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

  it('counts body paragraphs as Today does: top level and quoted, not empty', () => {
    const texts = bodyParagraphNodes(doc).map((n) =>
      (n.content ?? []).map((c) => c.text).join('')
    )
    expect(texts).toEqual(['One. Two.', 'Three.', 'Quoted.', 'Four.'])
    expect(bodyParagraphNodes(null)).toEqual([])
  })
})

describe('the server HTML carries the anchors', () => {
  it('gives each body paragraph its id, and others none', () => {
    const { html } = renderReadingHtml(doc)
    expect(html).toContain('<p id="s-0-0">One. Two.</p>')
    expect(html).toContain('<p id="s-1-0">Three.</p>')
    expect(html).toContain('<blockquote><p id="s-2-0">Quoted.</p></blockquote>')
    expect(html).toContain('<p id="s-3-0">Four.</p>')
    expect(html).toContain('<li><p>Listed.</p></li>')
    expect(html).toContain('<p><br></p><p></p>')
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
