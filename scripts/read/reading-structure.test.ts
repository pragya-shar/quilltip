import { describe, expect, it, vi } from 'vitest'
import { readingPlainText } from '@/lib/tiptap/readingPlainText'
import { renderReadingHtml } from '@/lib/tiptap/renderReadingHtml'
import {
  READING_LIMITS,
  safeImageSrc,
  safeLinkHref,
} from '@/lib/tiptap/sanitizeReadingDoc'

// What each parent may hold, how many embeds and images a document may
// have, and malformed documents: each either renders a valid document or
// ends in the not-available state, never an exception or an empty article.

const SOURCES = { storageOrigin: 'https://deploy-1.convex.cloud' }
const render = (content: unknown) =>
  renderReadingHtml({ type: 'doc', content } as never, SOURCES)
const text = (t: string, marks?: unknown) =>
  marks === undefined
    ? { type: 'text', text: t }
    : { type: 'text', text: t, marks }
const p = (...content: unknown[]) => ({ type: 'paragraph', content })
const UNAVAILABLE = { html: undefined, headings: [], unavailable: 'invalid' }

describe('children per parent', () => {
  it('lets inline parents hold only text and hard breaks', () => {
    const { html } = render([
      p(
        text('a'),
        p(text('p in p')),
        { type: 'heading', attrs: { level: 2 }, content: [text('H in P')] },
        { type: 'resizableImage', attrs: { src: '/images/a.png' } },
        { type: 'youtube', attrs: { src: 'https://youtu.be/dQw4w9WgXcQ' } },
        { type: 'horizontalRule' },
        { type: 'hardBreak' },
        text('b')
      ),
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [p(text('One')), text('Two')],
      },
    ])
    expect(html).toBe('<p id="s-0-0">a<br>b</p><h2 id="h-two">Two</h2>')
  })

  it('keeps code blocks to plain text', () => {
    const { html } = render([
      {
        type: 'codeBlock',
        content: [
          text('x', [
            { type: 'bold' },
            { type: 'link', attrs: { href: 'https://e.example' } },
          ]),
          { type: 'hardBreak' },
          p(text('y')),
        ],
      },
    ])
    expect(html).toBe('<pre><code>x</code></pre>')
  })

  it('holds lists to list items, each opening with a paragraph', () => {
    const { html } = render([
      { type: 'bulletList', content: [p(text('bare')), { type: 'listItem' }] },
      {
        type: 'orderedList',
        attrs: { start: '0x10' },
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'bulletList',
                content: [{ type: 'listItem', content: [p(text('inner'))] }],
              },
            ],
          },
        ],
      },
      { type: 'listItem', content: [p(text('bare li'))] },
    ])
    expect(html).toBe(
      '<ul><li><p></p></li></ul>' +
        '<ol><li><p></p><ul><li><p>inner</p></li></ul></li></ol>'
    )
  })

  it('drops an empty quote or list, and a nested document', () => {
    const { html } = render([
      { type: 'blockquote' },
      { type: 'blockquote', content: [text('bare text')] },
      { type: 'bulletList', content: [] },
      { type: 'orderedList' },
      { type: 'doc', content: [p(text('nested doc'))] },
      p(text('kept')),
    ])
    expect(html).toBe('<p id="s-0-0">kept</p>')
  })

  it('reads ordered list starts only as whole numbers', () => {
    const starts = ['7.0', [9], '0x10', ' 12 ', '1e3', 3, '12', 0, -2]
    const { html } = render(
      starts.map((start) => ({
        type: 'orderedList',
        attrs: { start },
        content: [{ type: 'listItem', content: [p(text('i'))] }],
      }))
    )
    expect(html!.match(/<ol[^>]*>/g)).toEqual([
      '<ol>',
      '<ol>',
      '<ol>',
      '<ol>',
      '<ol>',
      '<ol start="3">',
      '<ol start="12">',
      '<ol>',
      '<ol>',
    ])
  })
})

describe('malformed documents', () => {
  it('never throws on malformed marks', () => {
    const marks = [
      'link',
      5,
      [null],
      { 0: { type: 'bold' }, length: 1 },
      [{ type: '__proto__' }, { type: 'constructor' }, { type: ['bold'] }],
      [
        { type: 'link', attrs: null },
        { type: 'link', attrs: 'x' },
      ],
      [{ type: 'link', attrs: { href: { toString: 1 } } }],
    ]
    for (const mark of marks) {
      expect(render([p(text('a', mark))]), JSON.stringify(mark)).toEqual({
        html: '<p id="s-0-0">a</p>',
        headings: [],
      })
      expect(
        readingPlainText({
          type: 'doc',
          content: [p(text('a', mark))],
        } as never)
      ).toBe('a')
    }
  })

  it('keeps each mark once, the first link, and code alone', () => {
    const { html } = render([
      p(
        text('a', [
          { type: 'bold' },
          { type: 'bold' },
          { type: 'link', attrs: { href: 'https://a.example/' } },
          { type: 'link', attrs: { href: 'https://b.example/' } },
          { type: 'italic' },
        ]),
        text('c', [{ type: 'code' }, { type: 'bold' }, { type: 'italic' }])
      ),
    ])
    expect(html).toBe(
      '<p id="s-0-0"><a target="_blank" rel="noopener noreferrer nofollow ugc" href="https://a.example/"><strong><em>a</em></strong></a><code>c</code></p>'.replace(
        ' target="_blank"',
        ''
      )
    )
  })

  it('drops wrong node shapes without throwing', () => {
    const { html } = render([
      { type: '__proto__', content: [text('x')] },
      { type: 'constructor' },
      { type: ['paragraph'], content: [text('arr')] },
      { type: 'text', text: 'top-level text' },
      null,
      7,
      'x',
      [p(text('array'))],
      { type: 'paragraph', content: 'str' },
      { type: 'paragraph', content: { 0: text('x'), length: 1 } },
      p(
        null,
        1,
        'x',
        [text('arr')],
        { type: 'text', text: 7 },
        { type: 'text', text: '' },
        { type: 'text' },
        text('ok')
      ),
      { type: 'heading', attrs: 'x', content: [text('h')] },
      { type: 'image', attrs: [] },
      { type: 'image', attrs: null },
      { type: 'youtube', attrs: 7 },
    ])
    expect(html).toBe(
      // Empty paragraphs carry no anchor.
      '<p></p><p></p><p id="s-0-0">ok</p><h2 id="h-h">h</h2>'
    )
  })

  it('ends in the not-available state when nothing is left to show', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(render([])).toEqual(UNAVAILABLE)
    expect(
      render([{ type: 'iframe' }, { type: 'youtube', attrs: {} }])
    ).toEqual(UNAVAILABLE)
    expect(renderReadingHtml(null, SOURCES)).toEqual(UNAVAILABLE)
    expect(renderReadingHtml('doc' as never, SOURCES)).toEqual(UNAVAILABLE)
    expect(
      renderReadingHtml({ type: 'doc', content: 'x' } as never, SOURCES)
    ).toEqual(UNAVAILABLE)
    quiet.mockRestore()
  })
})

describe('counts', () => {
  const video = {
    type: 'youtube',
    attrs: { src: 'https://youtu.be/dQw4w9WgXcQ' },
  }
  const image = { type: 'resizableImage', attrs: { src: '/images/a.png' } }

  it(`renders ${READING_LIMITS.embeds} embeds and refuses one more`, () => {
    const at = render(
      Array.from({ length: READING_LIMITS.embeds }, () => video)
    )
    expect(at.html!.match(/<iframe/g)).toHaveLength(READING_LIMITS.embeds)
    expect(
      render(Array.from({ length: READING_LIMITS.embeds + 1 }, () => video))
    ).toMatchObject({ html: undefined, unavailable: 'too-large' })
  })

  it('counts refused embeds too', () => {
    const bad = { type: 'youtube', attrs: { src: 'https://evil.example/' } }
    expect(
      render([
        p(text('x')),
        ...Array.from({ length: READING_LIMITS.embeds + 1 }, () => bad),
      ])
    ).toMatchObject({ unavailable: 'too-large' })
  })

  it(`renders ${READING_LIMITS.images} images, nested too, and refuses one more`, () => {
    const quote = (n: number) => ({
      type: 'blockquote',
      content: Array.from({ length: n }, () => image),
    })
    const at = render([quote(READING_LIMITS.images)])
    const tags = at.html!.match(/<img[^>]*>/g)!
    expect(tags).toHaveLength(READING_LIMITS.images)
    // Every image after the first loads lazily.
    expect(tags[0]).not.toContain('loading')
    for (const tag of tags.slice(1)) expect(tag).toContain('loading="lazy"')
    expect(render([quote(READING_LIMITS.images + 1)])).toMatchObject({
      unavailable: 'too-large',
    })
  })

  it('counts every entry of a content list, primitives included', () => {
    expect(
      render([
        ...Array.from({ length: READING_LIMITS.nodes }, () => 0),
        p(text('x')),
      ])
    ).toMatchObject({ unavailable: 'too-large' })
  })
})

describe('addresses', () => {
  it('takes images only from this deployment’s storage and the site’s image paths', () => {
    expect(
      safeImageSrc(`${SOURCES.storageOrigin}/api/storage/a1?t=1#x`, SOURCES)
    ).toBe('https://deploy-1.convex.cloud/api/storage/a1')
    expect(safeImageSrc('/images/a.png?v=1', SOURCES)).toBe('/images/a.png')
    for (const src of [
      'https://deploy-2.convex.cloud/api/storage/a1',
      'https://attacker-123.convex.site/api/storage/a1',
      'https://deploy-1.convex.cloud.evil.example/api/storage/a1',
      'http://deploy-1.convex.cloud/api/storage/a1',
      'https://user:pw@deploy-1.convex.cloud/api/storage/a1',
      'https://deploy-1.convex.cloud/api/other',
      'https://images.unsplash.com/photo-1',
      'https://arweave.net/abc',
      '/search?q=1',
      '/images/../api/x',
      '//deploy-1.convex.cloud/api/storage/a1',
      '/\\deploy-1.convex.cloud/api/storage/a1',
      '/images/a b.png',
      'images/a.png',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
    ])
      expect(safeImageSrc(src, SOURCES), src).toBeNull()
    expect(
      safeImageSrc('https://deploy-1.convex.cloud/api/storage/a1', {
        storageOrigin: null,
      })
    ).toBeNull()
  })

  it('decides same-site links by parsing, and writes the normalised path', () => {
    expect(safeLinkHref('/a/./b/../c?x=1#s-2-0')).toBe('/a/c?x=1#s-2-0')
    expect(safeLinkHref('#s-2-0')).toBe('#s-2-0')
    expect(safeLinkHref('mailto:a@e.example?subject=x&body=y')).toBe(
      'mailto:a@e.example'
    )
    for (const href of [
      '//evil.example/x',
      '/\\evil.example/x',
      '/\t/evil.example/x',
      '/\n/evil.example/x',
      'https://user@e.example/',
      'https://:pw@e.example/',
      'mailto:a@e.example,b@e.example',
      'mailto:',
      'https://e.example/‮',
      'tomas/ledger',
      'https://reading.invalid/x',
      '#"><script>',
    ])
      expect(safeLinkHref(href), href).toBeNull()
  })
})
