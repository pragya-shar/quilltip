import { describe, expect, it } from 'vitest'
import {
  appendArticleTipResumeToReturnPath,
  hasArticleTipResumeFlag,
  parseArticleTipResumeFromSearchParams,
  RESUME_ARTICLE_TIP_PARAM,
} from './articleTipResumeUrl'
import type { Id } from '@/convex/_generated/dataModel'

describe('articleTipResumeUrl', () => {
  const articleId = 'articles:abc' as Id<'articles'>

  it('appends resume flags to a clean path', () => {
    const path = appendArticleTipResumeToReturnPath('/alice/post', {
      kind: 'article',
      articleId: 'articles:abc',
      amountCents: 100,
      message: 'Thanks',
    })
    expect(path).toContain(`${RESUME_ARTICLE_TIP_PARAM}=1`)
    expect(path).toContain('tipCents=100')
    expect(path).toContain('tipMsg=Thanks')
  })

  it('merges with existing query params', () => {
    const path = appendArticleTipResumeToReturnPath('/alice/post?ref=1', {
      kind: 'article',
      articleId: 'articles:abc',
      amountCents: 50,
    })
    expect(path).toContain('ref=1')
    expect(path).toContain('tipCents=50')
  })

  it('parses resume data from search params', () => {
    const params = new URLSearchParams(
      'resumeArticleTip=1&tipCents=100&tipMsg=Hello'
    )
    expect(hasArticleTipResumeFlag(params)).toBe(true)
    expect(parseArticleTipResumeFromSearchParams(params, articleId)).toEqual({
      kind: 'article',
      articleId: 'articles:abc',
      amountCents: 100,
      message: 'Hello',
    })
  })
})
