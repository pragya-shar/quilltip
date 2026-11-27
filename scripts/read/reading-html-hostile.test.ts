// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderReadingHtml } from '@/lib/tiptap/renderReadingHtml'

// Hostile documents through the reading renderer, parsed with a real HTML
// parser: every element and every attribute on the page is one the reading
// view allows, with values it checked. An author's document is untrusted.

const text = (t: string, marks?: object[]) =>
  marks ? { type: 'text', text: t, marks } : { type: 'text', text: t }
const link = (href: string, extra: object = {}) => ({
  type: 'link',
  attrs: { href, ...extra },
})
const p = (content: object[], attrs?: object) => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  content,
})

const HOSTILE = {
  type: 'doc',
  content: [
    {
      type: 'resizableImage',
      attrs: {
        src: 'https://images.example/a.png',
        alt: '<h2 onerror=alert(1)> "quoted" \'single\'',
        title: '<h2 onload=alert(3)> caption "x"',
        width: '100" onerror="alert(1)',
        height: 300,
        onerror: 'alert(1)',
        style: 'position:fixed;inset:0',
        class: 'qt-x',
      },
    },
    {
      type: 'heading',
      attrs: { level: 2, id: 'read-next', anchor: 's-0-0' },
      content: [text('A "quoted" heading')],
    },
    { type: 'heading', attrs: { level: 2 }, content: [text('s 0 0')] },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [text('A "quoted" heading')],
    },
    p([
      text('js', [link('javascript:alert(1)')]),
      text(' data', [link('data:text/html,<script>alert(1)</script>')]),
      text(' vb', [link('  JaVaScRiPt:alert(1)')]),
      text(' web', [
        link('https://e.example/', {
          target: '_self',
          rel: 'opener',
          class: 'qt-x',
          onclick: 'alert(1)',
          style: 'color:red',
        }),
      ]),
      text(' mail', [link('mailto:a@e.example')]),
      text(' local', [link('/tomas/other')]),
      text(' proto', [link('//evil.example/x')]),
    ]),
    p([text('<script>alert(2)</script> body')], {
      anchor: 's-9-9"><script>alert(1)</script>',
      id: 'read-next',
      class: 'qt-x',
      style: 'display:none',
    }),
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [p([text('forged')], { anchor: 's-1-0' })],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'blockquote',
          content: [p([text('nested')], { anchor: 'read-next' })],
        },
      ],
    },
    p([text('First body.')]),
    { type: 'youtube', attrs: { src: 'javascript:alert(1)' } },
    { type: 'youtube', attrs: { src: 'https://evil.example/embed' } },
    {
      type: 'codeBlock',
      attrs: { language: 'js"><img src=x onerror=alert(1)>' },
      content: [text('<h2 x>', [{ type: 'bold' }])],
    },
    { type: 'resizableImage', attrs: { src: 'javascript:alert(1)' } },
    { type: 'resizableImage', attrs: { src: 'data:image/png;base64,AAAA' } },
    { type: 'iframe', attrs: { src: 'https://evil.example' } },
    { type: 'heading', attrs: { level: 1 }, content: [text('Level one')] },
    p([text('styled', [{ type: 'textStyle', attrs: { color: 'red' } }])]),
  ],
}

/** Tags the reading body may hold, and the attributes each may carry. */
const ALLOWED: Record<string, readonly string[]> = {
  P: ['id'],
  H2: ['id'],
  H3: [],
  H4: [],
  BLOCKQUOTE: [],
  UL: [],
  OL: ['start'],
  LI: [],
  PRE: [],
  CODE: [],
  BR: [],
  HR: [],
  STRONG: [],
  EM: [],
  U: [],
  S: [],
  A: ['href', 'rel'],
  IMG: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
  FIGURE: [],
  FIGCAPTION: [],
  DIV: ['data-youtube-video'],
  IFRAME: [
    'src',
    'width',
    'height',
    'allowfullscreen',
    'autoplay',
    'disablekbcontrols',
    'enableiframeapi',
    'endtime',
    'ivloadpolicy',
    'loop',
    'modestbranding',
    'origin',
    'playlist',
    'progressbarcolor',
    'rel',
    'start',
    'allow',
  ],
}

function parse(html: string) {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><body><div id="root">${html}</div>`,
    'text/html'
  )
  return doc.getElementById('root')!
}

describe('the reading renderer on hostile documents', () => {
  const { html, headings } = renderReadingHtml(HOSTILE as never)
  const root = parse(html!)
  const elements = Array.from(root.querySelectorAll('*'))

  it('holds only allowed elements and attributes', () => {
    for (const el of elements) {
      const allowed = ALLOWED[el.tagName]
      expect(allowed, `element ${el.tagName}`).toBeDefined()
      for (const attr of Array.from(el.attributes))
        expect(
          allowed,
          `${el.tagName}[${attr.name}="${attr.value}"]`
        ).toContain(attr.name)
    }
    expect(root.querySelector('script, style, [style], [class]')).toBeNull()
    for (const el of elements)
      for (const attr of Array.from(el.attributes))
        expect(attr.name.startsWith('on'), attr.name).toBe(false)
  })

  it('keeps markup in alt text and captions as text', () => {
    const img = root.querySelector('img')!
    expect(img.getAttribute('alt')).toBe(
      '<h2 onerror=alert(1)> "quoted" \'single\''
    )
    expect(img.hasAttribute('width')).toBe(false)
    expect(img.getAttribute('height')).toBe('300')
    expect(root.querySelector('figcaption')!.textContent).toBe(
      '<h2 onload=alert(3)> caption "x"'
    )
    // The only headings are the document's.
    expect(Array.from(root.querySelectorAll('h2')).map((h) => h.id)).toEqual([
      'h-a-quoted-heading',
      'h-s-0-0',
      'h-a-quoted-heading-2',
      'h-level-one',
    ])
  })

  it('gives ids only to body paragraphs and headings, unique', () => {
    const ids = elements.map((el) => el.id).filter(Boolean)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^(s-\d+-0|h-[\p{L}\p{N}-]+)$/u)
    expect(root.querySelector('li p')!.hasAttribute('id')).toBe(false)
    expect(root.querySelector('#read-next')).toBeNull()
    // Body paragraphs in order: the link paragraph, the script text, the
    // nested quote's, First body, and the styled one.
    expect(root.querySelector('#s-1-0')!.textContent).toBe(
      '<script>alert(2)</script> body'
    )
    expect(
      root.querySelector('blockquote blockquote p')!.hasAttribute('id')
    ).toBe(false)
    expect(headings.map((h) => h.id)).toEqual([
      'h-a-quoted-heading',
      'h-s-0-0',
      'h-a-quoted-heading-2',
      'h-level-one',
    ])
  })

  it('links: web, mail and same-site only; no target or class; rel always', () => {
    const links = Array.from(root.querySelectorAll('a'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://e.example/',
      'mailto:a@e.example',
      '/tomas/other',
      // Protocol-relative: an ordinary external web link, written in full.
      'https://evil.example/x',
    ])
    for (const a of links) {
      expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc')
      expect(a.hasAttribute('target')).toBe(false)
    }
    // The text of a refused link stays, as plain text.
    expect(root.textContent).toContain('js data vb web mail local proto')
  })

  it('drops script sources, foreign embeds and unknown nodes', () => {
    expect(root.querySelectorAll('img')).toHaveLength(1)
    expect(root.querySelector('iframe')).toBeNull()
    expect(root.querySelector('pre code')!.getAttribute('class')).toBeNull()
    expect(root.querySelector('pre code strong')).toBeNull()
  })
})
