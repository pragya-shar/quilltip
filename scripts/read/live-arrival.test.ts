import { describe, expect, it } from 'vitest'
import {
  JUST_PUBLISHED_MAX_AGE_MS,
  liveArrivalCheck,
} from '@/components/read/liveArrival'
import { loadLiveArrival } from '@/components/read/liveArrivalLoader'

const ID = 'article-1'
const NOW = 1_000_000
const token = (articleId: string, at: number) =>
  JSON.stringify({ articleId, at })

describe('the arrival after a first publish', () => {
  it('does nothing and keeps the token without the parameter', () => {
    expect(
      liveArrivalCheck({
        search: '?ref=x',
        token: token(ID, NOW),
        articleId: ID,
        now: NOW,
      })
    ).toEqual({ search: null, consume: false, armed: false })
  })

  it('removes the parameter for every visitor, keeping the rest', () => {
    expect(
      liveArrivalCheck({
        search: '?live=1&ref=x',
        token: null,
        articleId: ID,
        now: NOW,
      })
    ).toEqual({ search: '?ref=x', consume: false, armed: false })
    expect(
      liveArrivalCheck({
        search: '?live=1&live=1',
        token: null,
        articleId: ID,
        now: NOW,
      }).search
    ).toBe('')
  })

  it('arms only for a fresh token that names this article', () => {
    const at = (t: string | null) =>
      liveArrivalCheck({ search: '?live=1', token: t, articleId: ID, now: NOW })
    expect(at(token(ID, NOW - 1_000))).toEqual({
      search: '',
      consume: true,
      armed: true,
    })
    // Stale, from the future, another article, or malformed: spent, not run.
    for (const bad of [
      token(ID, NOW - JUST_PUBLISHED_MAX_AGE_MS - 1),
      token(ID, NOW + 1_000),
      token('article-2', NOW),
      '{"articleId":"article-1"}',
      'not json',
      'null',
    ])
      expect(at(bad), bad).toEqual({ search: '', consume: true, armed: false })
  })

  it('needs the parameter to be 1', () => {
    expect(
      liveArrivalCheck({
        search: '?live=yes',
        token: token(ID, NOW),
        articleId: ID,
        now: NOW,
      }).armed
    ).toBe(false)
  })

  it('has no arrival until the Write package ships its loader', () => {
    expect(loadLiveArrival).toBeNull()
  })
})
