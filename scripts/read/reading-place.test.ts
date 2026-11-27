import { describe, expect, it } from 'vitest'
import {
  PLACE_LIMIT,
  finishedCookieValue,
  parsePlaces,
  shortSentence,
  upsertPlace,
  type ReadingPlace,
} from '@/hooks/read/readingPlace'

const place = (articleId: string, over: Partial<ReadingPlace> = {}) => ({
  articleId,
  href: `/tomas/${articleId}`,
  title: `Article ${articleId}`,
  sentence: 'A peso for the bus.',
  percent: 0.4,
  updatedAt: 1,
  ...over,
})

describe('reading places for Today', () => {
  it('puts the latest first and keeps at most 20', () => {
    let places: ReadingPlace[] = []
    for (let i = 0; i < PLACE_LIMIT + 3; i++)
      places = upsertPlace(places, place(`a${i}`))
    expect(places).toHaveLength(PLACE_LIMIT)
    expect(places[0]!.articleId).toBe(`a${PLACE_LIMIT + 2}`)
    places = upsertPlace(places, place('a10', { percent: 0.7 }))
    expect(places[0]).toMatchObject({ articleId: 'a10', percent: 0.7 })
    expect(places.filter((p) => p.articleId === 'a10')).toHaveLength(1)
  })

  it('keeps a finished article finished, with its sentence', () => {
    let places = upsertPlace([], place('a', { finished: true }))
    places = upsertPlace(places, place('a', { sentence: '', percent: 0.3 }))
    expect(places[0]).toMatchObject({
      finished: true,
      sentence: 'A peso for the bus.',
      percent: 0.3,
    })
  })

  it('clamps the share read and cuts the sentence at a word', () => {
    const [p] = upsertPlace([], place('a', { percent: 1.4 }))
    expect(p!.percent).toBe(1)
    const long =
      'For thirty years she wrote one line each time she gave something away, a date and a name and a coin.'
    const short = shortSentence(long)
    expect(short.length).toBeLessThanOrEqual(80)
    expect(short.endsWith('…')).toBe(true)
    expect(long.startsWith(short.slice(0, -1))).toBe(true)
    expect(shortSentence('  Two  pesos. ')).toBe('Two pesos.')
  })

  it('reads nothing from a bad stored value', () => {
    expect(parsePlaces(null)).toEqual([])
    expect(parsePlaces('{')).toEqual([])
    expect(parsePlaces('{"a":1}')).toEqual([])
    expect(parsePlaces('[{"articleId":1}]')).toEqual([])
  })

  it('keeps only same-site paths as href', async () => {
    const { isSitePath } = await import('@/hooks/read/readingPlace')
    expect(isSitePath('/tomas/ledger')).toBe(true)
    expect(isSitePath('/tomas/ledger?x=1')).toBe(true)
    // Normalised as the parser reads it, still on this site.
    const { sitePath } = await import('@/hooks/read/readingPlace')
    expect(sitePath('/tomas/./ledger/../ledger?x=1#s-1-0')).toBe(
      '/tomas/ledger?x=1'
    )
    for (const bad of [
      '//evil.example/x',
      '/\\evil.example/x',
      '/\\evil.test/x',
      '/\t/evil.test/x',
      '/\n/evil.test/x',
      '/a\\b',
      '/x\u0085y',
      'https://evil.example/',
      'javascript:alert(1)',
      'tomas/ledger',
      '/a b',
      '',
    ])
      expect(isSitePath(bad), bad).toBe(false)
  })

  it('tolerates older entries and drops only the bad ones', () => {
    const stored = JSON.stringify([
      { articleId: 'a', href: '/t/a', title: 'A', percent: 0.5, updatedAt: 2 },
      {
        articleId: 'b',
        href: 'https://elsewhere.example/b',
        title: 'B',
        percent: 0.5,
        updatedAt: 1,
      },
      {
        articleId: 'c',
        href: '//elsewhere.example/c',
        title: 'C',
        percent: 0.5,
        updatedAt: 1,
      },
      null,
      {
        articleId: 'd',
        href: '/t/d',
        title: 'D',
        percent: 3,
        updatedAt: 1,
        finished: true,
        sentence: 'S.',
      },
    ])
    expect(parsePlaces(stored)).toEqual([
      {
        articleId: 'a',
        href: '/t/a',
        title: 'A',
        sentence: '',
        percent: 0.5,
        updatedAt: 2,
        finished: false,
      },
      {
        articleId: 'd',
        href: '/t/d',
        title: 'D',
        sentence: 'S.',
        percent: 1,
        updatedAt: 1,
        finished: true,
      },
    ])
  })

  it('mirrors finished ids into the cookie value', () => {
    let places = upsertPlace([], place('a', { finished: true }))
    places = upsertPlace(places, place('b'))
    places = upsertPlace(places, place('c d', { finished: true }))
    expect(finishedCookieValue(places)).toBe('c%20d,a')
  })
})

describe('the cookies for Today', () => {
  it('reads ids from a cookie header, decoded, at most 20', async () => {
    const { cookieIds } = await import('@/hooks/read/readingPlace')
    const header = 'a=1; qt_opened=x%20y,b,%E0%A4; qt_finished=c'
    expect(cookieIds(header, 'qt_opened')).toEqual(['x y', 'b'])
    expect(cookieIds(header, 'qt_finished')).toEqual(['c'])
    expect(cookieIds('', 'qt_opened')).toEqual([])
    const many = Array.from({ length: 30 }, (_, i) => `id${i}`).join(',')
    expect(cookieIds(`qt_opened=${many}`, 'qt_opened')).toHaveLength(20)
  })

  it('puts an opened id first, once, at most 20', async () => {
    const { withOpened } = await import('@/hooks/read/readingPlace')
    expect(withOpened(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    const full = Array.from({ length: 20 }, (_, i) => `id${i}`)
    const next = withOpened(full, 'new')
    expect(next).toHaveLength(20)
    expect(next[0]).toBe('new')
    expect(next).not.toContain('id19')
  })
})
