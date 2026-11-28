// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { ArticleReadOnlyBody } from '../../components/articles/ArticleReadOnlyBody'
import {
  ARTICLE_LINK_REL,
  ARTICLE_LINK_TARGET,
  createArticleLinkExtension,
} from '../../lib/tiptap/articleLink'
import { renderArticleHtml } from '../../lib/tiptap/renderArticleHtml'

// A link as an older document may store it, a plain link, and a script link.
const stored = {
  href: 'https://example.com/a',
  target: '_self',
  rel: 'opener',
  class: 'x',
  title: 'kept out',
}
const doc: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'stored',
          marks: [{ type: 'link', attrs: stored }],
        },
        {
          type: 'text',
          text: ' plain',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/b' } }],
        },
        {
          type: 'text',
          text: ' script',
          marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
        },
      ],
    },
  ],
}

function anchors(html: string) {
  const root = document.createElement('div')
  root.innerHTML = html
  return [...root.querySelectorAll('a')].map((a) => ({
    href: a.getAttribute('href'),
    target: a.getAttribute('target'),
    rel: a.getAttribute('rel'),
    class: a.getAttribute('class'),
    title: a.getAttribute('title'),
  }))
}

const fixed = (href: string, className: string | null = null) => ({
  href,
  target: ARTICLE_LINK_TARGET,
  rel: ARTICLE_LINK_REL,
  class: className,
  title: null,
})
const expected = [
  fixed('https://example.com/a'),
  fixed('https://example.com/b'),
  // Script and data addresses stay emptied.
  fixed(''),
]

function readerEditor() {
  // The highlight editor's set (components/articles/HighlightableArticle).
  return new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: false, underline: false }),
      createArticleLinkExtension({ openOnClick: false }),
    ],
    content: doc,
    editable: false,
  })
}

describe('article links (#612)', () => {
  it('the fixed values are rel "noopener noreferrer" and target "_blank"', () => {
    expect([ARTICLE_LINK_REL, ARTICLE_LINK_TARGET]).toEqual([
      'noopener noreferrer',
      '_blank',
    ])
  })

  it('passes openOnClick to the link extension as given', () => {
    // The writing editors are editable: a click there must not open the link.
    expect(
      createArticleLinkExtension({ openOnClick: false }).options
    ).toMatchObject({ openOnClick: false })
    expect(
      createArticleLinkExtension({ openOnClick: true }).options
    ).toMatchObject({ openOnClick: true })
  })

  it('the server renderer renders the fixed rel and target and no stored class', () => {
    expect(anchors(renderArticleHtml(doc)!)).toEqual(expected)
  })

  it('the client body renders the fixed rel and target and no stored class', () => {
    const html = renderToStaticMarkup(
      createElement(ArticleReadOnlyBody, { content: doc })
    )
    expect(anchors(html)).toEqual(expected)
  })

  it('the highlight editor renders the fixed rel and target and no stored class', () => {
    const editor = readerEditor()
    expect(anchors(editor.view.dom.innerHTML)).toEqual(expected)
    editor.destroy()
  })

  it('an editor keeps only the address of a link, and its own class', () => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ link: false }),
        createArticleLinkExtension({
          openOnClick: false,
          className: 'underline cursor-pointer',
        }),
      ],
      content:
        '<p><a href="https://example.com/c" target="_self" rel="opener" class="x" title="t">pasted</a></p>',
    })
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toEqual([
      { type: 'link', attrs: { href: 'https://example.com/c' } },
    ])
    expect(anchors(editor.view.dom.innerHTML)).toEqual([
      fixed('https://example.com/c', 'underline cursor-pointer'),
    ])
    // A stored document loads without its stored link attributes.
    editor.commands.setContent(doc)
    const marks = editor
      .getJSON()
      .content?.[0]?.content?.map((n) => n.marks?.[0]?.attrs)
    expect(marks).toEqual([
      { href: 'https://example.com/a' },
      { href: 'https://example.com/b' },
      { href: 'javascript:alert(1)' },
    ])
    editor.destroy()
  })

  it('every reader and editor takes its link mark from the shared extension', () => {
    const root = join(__dirname, '../..')
    const sources: string[] = []
    for (const dir of ['app', 'components', 'hooks', 'lib']) {
      for (const file of readdirSync(join(root, dir), { recursive: true })) {
        const path = join(dir, String(file))
        if (/\.(ts|tsx)$/.test(path)) sources.push(path)
      }
    }
    const importers = sources.filter((path) =>
      readFileSync(join(root, path), 'utf8').includes('@tiptap/extension-link')
    )
    expect(importers).toEqual(['lib/tiptap/articleLink.ts'])
    for (const path of [
      'lib/tiptap/readExtensions.ts',
      'components/articles/HighlightableArticle.tsx',
      'components/editor/Editor.tsx',
      'components/editor/EditorWithToolbar.tsx',
      'components/editor/useWritingWorkspace.ts',
    ]) {
      expect(readFileSync(join(root, path), 'utf8'), path).toContain(
        'createArticleLinkExtension('
      )
    }
  })
})
