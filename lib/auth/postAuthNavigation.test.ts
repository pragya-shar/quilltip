import { describe, expect, it } from 'vitest'
import { shouldUseFullPageAuthNavigation } from '@/lib/auth/postAuthNavigation'

describe('shouldUseFullPageAuthNavigation', () => {
  it('uses client routing for normal return paths', () => {
    expect(shouldUseFullPageAuthNavigation('/articles', null)).toBe(false)
  })

  it('uses full navigation for article tip resume params', () => {
    expect(
      shouldUseFullPageAuthNavigation('/writer/post?resumeArticleTip=1', null)
    ).toBe(true)
  })

  it('uses full navigation for pending highlight tip intent', () => {
    expect(
      shouldUseFullPageAuthNavigation('/writer/post', {
        kind: 'highlight',
        articleId: 'articles:123',
        articleSlug: 'post',
        highlightText: 'Highlighted text',
        startOffset: 0,
        endOffset: 16,
      })
    ).toBe(true)
  })
})
