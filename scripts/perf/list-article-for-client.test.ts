import { describe, expect, it } from 'vitest'
import { getArticlePreview } from '@/convex/lib/articlePreview'
import { getArticleOpening } from '@/lib/articles/getArticleOpening'
import { listArticleForClient } from '@/lib/articles/listArticleForClient'

const words = (n: number, seed: string) =>
  Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ')

const body = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Part one' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: `The harbour was still dark. ${words(400, 'w')}.`,
        },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: words(800, 'x') }] },
  ],
}

describe('listArticleForClient', () => {
  it('keeps the card text and drops the body and search text', () => {
    for (const excerpt of [undefined, '', 'A short subtitle.']) {
      const article = {
        excerpt,
        content: body,
        searchContent: words(500, 's'),
        title: 'T',
      }
      const trimmed = listArticleForClient(article)
      expect(getArticlePreview(trimmed)).toBe(getArticlePreview(article))
      expect(getArticleOpening(trimmed)).toBe(getArticleOpening(article))
      expect(trimmed.searchContent).toBeUndefined()
      expect(trimmed.title).toBe('T')
      expect(JSON.stringify(trimmed).length).toBeLessThan(1000)
      expect(JSON.stringify(article).length).toBeGreaterThan(5000)
    }
  })

  it('leaves an empty or missing body as it was', () => {
    expect(listArticleForClient({ content: undefined }).content).toBeUndefined()
    const empty = { type: 'doc', content: [] }
    expect(listArticleForClient({ content: empty }).content).toBe(empty)
  })
})
