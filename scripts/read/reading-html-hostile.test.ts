// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { getReadingExtensions } from '@/lib/tiptap/readingExtensions'
import { renderReadingHtml } from '@/lib/tiptap/renderReadingHtml'

// Hostile documents through the reading renderer, parsed back with an HTML
// parser: every element and every attribute on the page is one the reading
// view allows, with values it checked. An author's document is untrusted.
// The parser is happy-dom, which the server renderer already uses; no
// second HTML parser is a dependency, and none is added for this test.
//
// The schema-driven cases walk every node, mark and attribute of the
// reading schema, so a node, mark or attribute added to the schema fails
// the coverage check below until it is listed and tested here.

const SOURCES = { storageOrigin: 'https://deploy-1.convex.cloud' }
const UPLOAD = 'https://deploy-1.convex.cloud/api/storage/0b1c2d3e'
const render = (content: object[]) =>
  renderReadingHtml({ type: 'doc', content } as never, SOURCES)

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
  IMG: [
    'src',
    'alt',
    'width',
    'height',
    'loading',
    'decoding',
    'referrerpolicy',
  ],
  FIGURE: [],
  FIGCAPTION: [],
  DIV: ['data-youtube-video'],
  IFRAME: [
    'src',
    'title',
    'width',
    'height',
    'loading',
    'referrerpolicy',
    'sandbox',
    'allow',
    'allowfullscreen',
  ],
}

/** The HTML parsed into an inert template: frames and images never load. */
function parse(html: string) {
  const template = document.createElement('template')
  template.innerHTML = `<div id="root">${html}</div>`
  return template.content.getElementById('root')!
}

/** Every element and attribute in `html` is allowed; no script surface. */
function expectOnlyAllowed(html: string) {
  const root = parse(html)
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const allowed = ALLOWED[el.tagName]
    expect(allowed, `element ${el.tagName}`).toBeDefined()
    for (const attr of Array.from(el.attributes)) {
      expect(allowed, `${el.tagName}[${attr.name}="${attr.value}"]`).toContain(
        attr.name
      )
      if (attr.name === 'href' || attr.name === 'src')
        expect(attr.value, `${el.tagName}[${attr.name}]`).toMatch(
          /^(https:\/\/|http:\/\/|mailto:|\/(?![/\\])|#)/
        )
    }
  }
  expect(root.querySelector('script, style, [style], [class], h1')).toBeNull()
  return root
}

// --- The reading schema, entry by entry --------------------------------

const HOSTILE_VALUES: unknown[] = [
  '"><script>alert(1)</script>',
  'javascript:alert(1)',
  "x' onerror='alert(1)",
  1,
  2.5,
  -1,
  true,
  null,
  [],
  { toString: 'x' },
]
const JUNK_ATTRS = {
  id: 'read-next',
  class: 'qt-x',
  style: 'position:fixed;inset:0',
  onclick: 'alert(1)',
  onerror: 'alert(1)',
  target: '_blank',
  srcdoc: '<script>alert(1)</script>',
  'data-x': 'y',
}

/** The schema as the reading view defines it, reviewed entry by entry. */
const SCHEMA_NODES: Record<string, readonly string[]> = {
  doc: [],
  paragraph: ['anchor'],
  text: [],
  blockquote: [],
  bulletList: [],
  orderedList: ['start', 'type'],
  listItem: [],
  codeBlock: ['language'],
  hardBreak: [],
  heading: ['anchor', 'level'],
  horizontalRule: [],
  resizableImage: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  youtube: ['src'],
}
const SCHEMA_MARKS: Record<string, readonly string[]> = {
  bold: [],
  italic: [],
  underline: [],
  strike: [],
  code: [],
  link: ['href', 'target', 'rel', 'class', 'title'],
}

/** A node of `type` with `attrs`, inside a parent that may hold it. */
function placed(type: string, attrs: object): object[] {
  const inner = [text('x')]
  switch (type) {
    case 'text':
      return [p([{ type: 'text', text: 'x', ...attrs }])]
    case 'hardBreak':
      return [p([text('a'), { type, attrs }, text('b')])]
    case 'listItem':
      return [
        { type: 'bulletList', content: [{ type, attrs, content: [p(inner)] }] },
      ]
    case 'bulletList':
    case 'orderedList':
      return [
        { type, attrs, content: [{ type: 'listItem', content: [p(inner)] }] },
      ]
    case 'blockquote':
      return [{ type, attrs, content: [p(inner)] }]
    case 'doc':
      return [{ type, attrs, content: [p(inner)] }]
    case 'resizableImage':
    case 'youtube':
    case 'horizontalRule':
      return [{ type, attrs }]
    default:
      return [{ type, attrs, content: inner }]
  }
}

describe('the reading schema', () => {
  const schema = getSchema(getReadingExtensions())

  it('is the reviewed list of nodes, marks and attributes', () => {
    const nodes = Object.fromEntries(
      Object.entries(schema.nodes).map(([name, type]) => [
        name,
        Object.keys(type.spec.attrs ?? {}),
      ])
    )
    const marks = Object.fromEntries(
      Object.entries(schema.marks).map(([name, type]) => [
        name,
        Object.keys(type.spec.attrs ?? {}),
      ])
    )
    expect(sorted(nodes)).toEqual(sorted(SCHEMA_NODES))
    expect(sorted(marks)).toEqual(sorted(SCHEMA_MARKS))
  })

  for (const [type, names] of Object.entries(SCHEMA_NODES)) {
    it(`node ${type}: hostile values in every attribute render nothing unsafe`, () => {
      for (const value of HOSTILE_VALUES) {
        const attrs = {
          ...JUNK_ATTRS,
          ...Object.fromEntries(names.map((name) => [name, value])),
        }
        const result = render(placed(type, attrs))
        // A refusal is safe; a render holds only what is allowed.
        if (result.html !== undefined) expectOnlyAllowed(result.html)
      }
    })
  }

  for (const [type, names] of Object.entries(SCHEMA_MARKS)) {
    it(`mark ${type}: hostile values in every attribute render nothing unsafe`, () => {
      for (const value of HOSTILE_VALUES) {
        const attrs = {
          ...JUNK_ATTRS,
          ...Object.fromEntries(names.map((name) => [name, value])),
        }
        const { html } = render([p([text('marked', [{ type, attrs }])])])
        const root = expectOnlyAllowed(html!)
        expect(root.textContent).toBe('marked')
        for (const a of Array.from(root.querySelectorAll('a')))
          expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc')
      }
    })
  }

  it('never renders a level-1 heading, and only levels 2 to 4', () => {
    const asked = [
      1,
      1.5,
      '1',
      '3',
      0,
      2.5,
      3.9,
      5,
      6,
      -1,
      1e9,
      null,
      'x',
      [3],
      {},
    ]
    const { html } = render(
      asked.map((level) => ({
        type: 'heading',
        attrs: { level },
        content: [text(`L ${JSON.stringify(level)}`)],
      }))
    )
    const root = expectOnlyAllowed(html!)
    expect(root.querySelector('h1, h5, h6')).toBeNull()
    // The integers 2, 3 and 4 are kept; anything else is level 2.
    expect(
      Array.from(root.querySelectorAll('h2, h3, h4')).map((h) => h.tagName)
    ).toEqual(asked.map(() => 'H2'))
    const { html: kept } = render(
      [2, 3, 4].map((level) => ({
        type: 'heading',
        attrs: { level },
        content: [text(`L${level}`)],
      }))
    )
    expect(Array.from(parse(kept!).children).map((h) => h.tagName)).toEqual([
      'H2',
      'H3',
      'H4',
    ])
  })
})

function sorted(map: Record<string, readonly string[]>) {
  return Object.fromEntries(
    Object.keys(map)
      .sort()
      .map((key) => [key, [...(map[key] ?? [])].sort()])
  )
}

// --- One document with every trick at once ------------------------------

const HOSTILE = [
  {
    type: 'resizableImage',
    attrs: {
      src: `${UPLOAD}?token=1#x`,
      alt: '<h2 onerror=alert(1)> "quoted" \'single\'',
      title: '<h2 onload=alert(3)> caption "x"',
      width: '100" onerror="alert(1)',
      height: 300,
      onerror: 'alert(1)',
      style: 'position:fixed;inset:0',
      class: 'qt-x',
      loading: 'eager',
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
    text(' mail', [link('mailto:a@e.example?cc=b@e.example&subject=x')]),
    text(' local', [link('/tomas/./x/../other?q=1#s-1-0')]),
    text(' proto', [link('//evil.example/x')]),
    text(' slash', [link('/\\evil.example/x')]),
    text(' tab', [link('/\t/evil.example/x')]),
    text(' cred', [link('https://user:pw@e.example/')]),
    text(' ‮evil‬', [link('https://f.example/')]),
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
  {
    type: 'resizableImage',
    attrs: { src: 'https://attacker-123.convex.site/p.gif?a=42' },
  },
  { type: 'resizableImage', attrs: { src: 'https://images.example/a.png' } },
  { type: 'resizableImage', attrs: { src: '/search?q=1' } },
  { type: 'resizableImage', attrs: { src: '/images/second.png?v=2' } },
  { type: 'iframe', attrs: { src: 'https://evil.example' } },
  { type: 'heading', attrs: { level: 1 }, content: [text('Level one')] },
  p([text('styled', [{ type: 'textStyle', attrs: { color: 'red' } }])]),
]

describe('the reading renderer on a hostile document', () => {
  const { html, headings } = render(HOSTILE)
  const root = expectOnlyAllowed(html!)
  const elements = Array.from(root.querySelectorAll('*'))

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

  it('links: web without credentials, one mail address, parsed same-site paths', () => {
    const links = Array.from(root.querySelectorAll('a'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://e.example/',
      'mailto:a@e.example',
      '/tomas/other?q=1#s-1-0',
      'https://f.example/',
    ])
    for (const a of links) {
      expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc')
      expect(a.hasAttribute('target')).toBe(false)
    }
    // Bidirectional controls are stripped from link text.
    expect(links[3]!.textContent).toBe(' evil')
    // The text of a refused link stays, as plain text.
    expect(root.textContent).toContain(
      'js data vb web mail local proto slash tab cred evil'
    )
  })

  it('images: this deployment’s storage and site paths, no query, no referrer', () => {
    const images = Array.from(root.querySelectorAll('img'))
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'https://deploy-1.convex.cloud/api/storage/0b1c2d3e',
      '/images/second.png',
    ])
    for (const img of images)
      expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    // The first image loads at once; every later one waits.
    expect(images[0]!.hasAttribute('loading')).toBe(false)
    expect(images[1]!.getAttribute('loading')).toBe('lazy')
    expect(images[1]!.getAttribute('decoding')).toBe('async')
  })

  it('drops script sources, foreign embeds and unknown nodes', () => {
    expect(root.querySelector('iframe')).toBeNull()
    expect(root.querySelector('pre code')!.getAttribute('class')).toBeNull()
    expect(root.querySelector('pre code strong')).toBeNull()
  })
})
