import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { renderArticleHtml } from '@/lib/tiptap/renderArticleHtml'
import {
  FIRST_SCREEN_TEXT_CHARS,
  markBodyImagesLazy,
} from '@/lib/tiptap/markBodyImagesLazy'

const image = (name: string, size = true): JSONContent => ({
  type: 'resizableImage',
  attrs: {
    src: `https://images.unsplash.com/${name}.jpg`,
    alt: 'A harbour',
    title: null,
    ...(size ? { width: 1200, height: 800 } : {}),
  },
})
const paragraph = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})
const heading = (text: string): JSONContent => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
})

/** Each rendered image's file name and its `loading` attribute. */
function loading(content: JSONContent[]): Record<string, string | null> {
  const html = renderArticleHtml({ type: 'doc', content }) ?? ''
  const result: Record<string, string | null> = {}
  for (const tag of html.match(/<img[^>]*>/g) ?? []) {
    const name = /\/([a-z-]+)\.jpg/.exec(tag)?.[1] ?? '?'
    result[name] = /loading="([^"]+)"/.exec(tag)?.[1] ?? null
  }
  return result
}

describe('article body images', () => {
  it('keeps the first two blocks eager and makes the third lazy', () => {
    expect(
      loading([
        image('zero'),
        image('one'),
        image('two'),
        paragraph('After.'),
        image('four'),
      ])
    ).toEqual({ zero: null, one: null, two: 'lazy', four: 'lazy' })
  })

  it('keeps the first image eager when it comes after the opening blocks', () => {
    expect(
      loading([
        heading('The harbour'),
        paragraph('A short opening.'),
        image('first'),
        paragraph('More text.'),
        image('second'),
      ])
    ).toEqual({ first: null, second: 'lazy' })
  })

  it('makes the first image lazy when a screen of text comes before it', () => {
    const long = 'A sentence that fills part of a line on a phone. '.repeat(11)
    expect(long.length).toBeGreaterThan(FIRST_SCREEN_TEXT_CHARS)
    expect(
      loading([
        heading('The harbour'),
        paragraph(long),
        image('far'),
        image('farther'),
      ])
    ).toEqual({ far: 'lazy', farther: 'lazy' })
  })

  it('finds the first image inside a nested block', () => {
    expect(
      loading([
        heading('The harbour'),
        paragraph('A short opening.'),
        { type: 'blockquote', content: [image('quoted')] },
        image('later'),
        { type: 'blockquote', content: [image('nested')] },
      ])
    ).toEqual({ quoted: null, later: 'lazy', nested: 'lazy' })
  })

  it('adds async decoding to lazy images only', () => {
    const html =
      renderArticleHtml({
        type: 'doc',
        content: [image('zero'), paragraph('a'), image('two'), image('three')],
      }) ?? ''
    const tags = html.match(/<img[^>]*>/g) ?? []
    expect(tags[0]).not.toContain('decoding=')
    expect(tags[2]).toContain('loading="lazy"')
    expect(tags[2]).toContain('decoding="async"')
  })

  it('keeps stored width and height, and adds none where none is stored', () => {
    const html =
      renderArticleHtml({
        type: 'doc',
        content: [
          paragraph('a'),
          paragraph('b'),
          image('sized'),
          image('unsized', false),
        ],
      }) ?? ''
    const [sized, unsized] = html.match(/<img[^>]*>/g) ?? []
    expect(sized).toContain('width="1200"')
    expect(sized).toContain('height="800"')
    expect(unsized).not.toContain('width=')
    expect(unsized).toContain('loading="lazy"')
  })

  it('does not change the stored document', () => {
    const doc = {
      type: 'doc',
      content: [paragraph('a'), paragraph('b'), image('two'), image('three')],
    }
    const before = JSON.stringify(doc)
    markBodyImagesLazy(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
})
