import { describe, expect, it } from 'vitest'
import {
  extractTextFromTiptapJson,
  resolveCanonicalHighlightPassage,
  tiptapJsonHasNonEmptyText,
} from './tiptapContent'

describe('tiptapJsonHasNonEmptyText', () => {
  it('is false for empty doc / empty paragraph', () => {
    const empty: unknown = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    }
    expect(tiptapJsonHasNonEmptyText(empty)).toBe(false)
    expect(extractTextFromTiptapJson(empty)).toBe('')
  })

  it('is true when a paragraph contains text', () => {
    const doc: unknown = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    }
    expect(tiptapJsonHasNonEmptyText(doc)).toBe(true)
  })

  it('is false for whitespace-only text', () => {
    const doc: unknown = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '   \n\t  ' }],
        },
      ],
    }
    expect(tiptapJsonHasNonEmptyText(doc)).toBe(false)
  })
})

describe('resolveCanonicalHighlightPassage', () => {
  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Alpha ' },
          { type: 'text', text: 'marked', marks: [{ type: 'bold' }] },
        ],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Beta ending' }],
      },
    ],
  }

  it('proves an exact inline passage without inserting spaces between marked text nodes', () => {
    expect(
      resolveCanonicalHighlightPassage(content, {
        highlightText: 'Alpha marked',
        startOffset: 0,
        endOffset: 12,
        startContainerPath: 'text.1',
        endContainerPath: 'text.13',
      })
    ).toEqual({
      highlightText: 'Alpha marked',
      startOffset: 0,
      endOffset: 12,
      startContainerPath: 'text.1',
      endContainerPath: 'text.13',
    })
  })

  it('proves a whitespace-normalized node-spanning passage at canonical text offsets', () => {
    expect(
      resolveCanonicalHighlightPassage(content, {
        highlightText: 'marked Beta',
        startOffset: 6,
        endOffset: 16,
        startContainerPath: 'text.7',
        endContainerPath: 'text.19',
      })
    ).toMatchObject({
      highlightText: 'marked Beta',
      startOffset: 6,
      endOffset: 16,
    })
  })

  it('keeps ProseMirror positions aligned after an empty structural block', () => {
    expect(
      resolveCanonicalHighlightPassage(
        {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] },
            { type: 'paragraph' },
            { type: 'paragraph', content: [{ type: 'text', text: 'Beta' }] },
          ],
        },
        {
          highlightText: 'Beta',
          startOffset: 5,
          endOffset: 9,
          startContainerPath: 'text.10',
          endContainerPath: 'text.14',
        }
      )
    ).toMatchObject({
      highlightText: 'Beta',
      startOffset: 5,
      endOffset: 9,
    })
  })

  it('fails closed for correct text at the wrong coordinates or unrelated coordinate hints', () => {
    expect(() =>
      resolveCanonicalHighlightPassage(content, {
        highlightText: 'marked',
        startOffset: 0,
        endOffset: 6,
      })
    ).toThrow('Highlight text does not match the selected article passage')

    expect(() =>
      resolveCanonicalHighlightPassage(content, {
        highlightText: 'marked',
        startOffset: 6,
        endOffset: 12,
        startContainerPath: 'text.1',
        endContainerPath: 'text.13',
      })
    ).toThrow('Highlight coordinate hints do not match article content')
  })
})
