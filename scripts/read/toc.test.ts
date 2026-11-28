import { describe, expect, it } from 'vitest'
import { extractH2HeadingsFromTiptapJson } from '@/lib/articles/toc'

const doc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Title' }],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'The Ledger' }],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'Text.' }] },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'The ledger!' }],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '  ' }],
    },
  ],
}

describe('table of contents', () => {
  it('lists level-2 headings with unique ids', () => {
    expect(extractH2HeadingsFromTiptapJson(doc)).toEqual([
      { id: 'the-ledger', text: 'The Ledger', level: 2 },
      { id: 'the-ledger-2', text: 'The ledger!', level: 2 },
    ])
  })

  it('reads nothing from content that is not a document', () => {
    expect(extractH2HeadingsFromTiptapJson(null)).toEqual([])
    expect(extractH2HeadingsFromTiptapJson('text')).toEqual([])
  })
})
