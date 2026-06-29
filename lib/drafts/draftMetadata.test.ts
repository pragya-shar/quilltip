import { describe, expect, it } from 'vitest'
import {
  formatWordCount,
  getMostRecentDraft,
  getWordCountFromContent,
  sortDraftsBy,
} from '@/lib/drafts/draftMetadata'

const drafts = [
  { _id: 'a', _creationTime: 100, updatedAt: 300, content: null },
  { _id: 'b', _creationTime: 200, updatedAt: 100, content: null },
  { _id: 'c', _creationTime: 300, updatedAt: 200, content: null },
]

describe('draftMetadata', () => {
  it('sorts drafts by updatedAt descending', () => {
    expect(sortDraftsBy(drafts, 'updatedAt').map((d) => d._id)).toEqual([
      'a',
      'c',
      'b',
    ])
  })

  it('sorts drafts by createdAt descending', () => {
    expect(sortDraftsBy(drafts, 'createdAt').map((d) => d._id)).toEqual([
      'c',
      'b',
      'a',
    ])
  })

  it('returns the most recently edited draft', () => {
    expect(getMostRecentDraft(drafts)?._id).toBe('a')
  })

  it('counts words from TipTap content', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'One two three' }],
        },
      ],
    }
    expect(getWordCountFromContent(content)).toBe(3)
  })

  it('formats word count labels', () => {
    expect(formatWordCount(0)).toBe('No content yet')
    expect(formatWordCount(1)).toBe('1 word')
    expect(formatWordCount(42)).toBe('42 words')
  })
})
