import { describe, expect, it } from 'vitest'
import {
  extractTextFromTiptapJson,
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
