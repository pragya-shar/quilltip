import { describe, expect, it } from 'vitest'
import { getArticlePreview } from './articlePreview'

describe('article preview', () => {
  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Opening ' },
          { type: 'text', text: 'words', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' from the story.' },
        ],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Next paragraph.' }],
      },
    ],
  }
  it('uses a supplied subtitle, including a short one', () => {
    expect(getArticlePreview({ excerpt: '  Hi  ', content })).toBe('Hi')
  })
  it('uses opening text when the subtitle is absent or whitespace', () => {
    expect(getArticlePreview({ content })).toBe(
      'Opening words from the story. Next paragraph.'
    )
    expect(getArticlePreview({ excerpt: ' \n ', content })).toBe(
      getArticlePreview({ content })
    )
  })
  it('shortens long openings at a word boundary', () => {
    const preview = getArticlePreview({
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'word '.repeat(100) }],
          },
        ],
      },
    })
    expect(preview.length).toBeLessThanOrEqual(240)
    expect(preview).toMatch(/word…$/)
  })
  it('does not expose image URLs or document attributes as text', () => {
    expect(
      getArticlePreview({
        content: {
          type: 'doc',
          content: [{ type: 'image', attrs: { src: 'private-url' } }],
        },
      })
    ).toBe('')
  })
})
