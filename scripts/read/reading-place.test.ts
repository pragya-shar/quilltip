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
    expect(parsePlaces('[{"articleId":1}]')).toEqual([])
  })

  it('mirrors finished ids into the cookie value', () => {
    let places = upsertPlace([], place('a', { finished: true }))
    places = upsertPlace(places, place('b'))
    places = upsertPlace(places, place('c d', { finished: true }))
    expect(finishedCookieValue(places)).toBe('c%20d,a')
  })
})
