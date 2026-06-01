import { describe, expect, it } from 'vitest'
import type { Doc, Id } from '../_generated/dataModel'
import {
  articleMatchesSearchTerms,
  dedupeArticlesById,
  isSingleTokenSearch,
} from './articleSearch'

function stubArticle(
  overrides: Partial<Doc<'articles'>> & Pick<Doc<'articles'>, '_id'>
): Doc<'articles'> {
  return {
    _creationTime: 0,
    slug: 's',
    title: 'Title',
    content: { type: 'doc', content: [] },
    published: true,
    authorId: 'user1' as Id<'users'>,
    authorUsername: 'writer',
    viewCount: 0,
    highlightCount: 0,
    tipCount: 0,
    totalTipsUsd: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('articleSearch helpers', () => {
  it('dedupeArticlesById keeps first occurrence per id', () => {
    const a = stubArticle({ _id: 'a1' as Id<'articles'>, title: 'First' })
    const b = stubArticle({ _id: 'a1' as Id<'articles'>, title: 'Second' })
    const c = stubArticle({ _id: 'a2' as Id<'articles'> })
    expect(dedupeArticlesById([a, b, c])).toEqual([a, c])
  })

  it('isSingleTokenSearch is false for multi-word queries', () => {
    expect(isSingleTokenSearch('one two')).toBe(false)
    expect(isSingleTokenSearch('tag')).toBe(true)
  })

  it('articleMatchesSearchTerms requires all terms in built content', () => {
    const article = stubArticle({
      _id: 'a1' as Id<'articles'>,
      title: 'Banana Guide',
      excerpt: 'A valid excerpt for public listing.',
      tags: ['rust'],
    })
    expect(articleMatchesSearchTerms(article, 'banana guide')).toBe(true)
    expect(articleMatchesSearchTerms(article, 'banana mango')).toBe(false)
    expect(articleMatchesSearchTerms(article, 'rust')).toBe(true)
  })
})
