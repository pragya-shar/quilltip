import { describe, expect, it } from 'vitest'
import { figureParts, figureState } from '@/system/money/figure'

describe('figureParts', () => {
  it('splits an exact amount into dollars and cents', () => {
    expect(figureParts('$18.40')).toEqual({
      approx: false,
      below: false,
      symbol: '$',
      whole: '18',
      fraction: '.40',
      spoken: '$18.40',
    })
  })

  it('keeps group separators the money layer wrote', () => {
    expect(figureParts('$1,234,567.09')).toMatchObject({
      whole: '1,234,567',
      fraction: '.09',
    })
  })

  it('keeps a whole-dollar label whole', () => {
    expect(figureParts('$5')).toMatchObject({ whole: '5', fraction: '' })
  })

  it('marks a converted amount as approximate, with or without the space', () => {
    for (const display of ['≈ $17.28', '≈$17.28']) {
      expect(figureParts(display)).toMatchObject({
        approx: true,
        whole: '17',
        fraction: '.28',
        spoken: 'about $17.28',
      })
    }
  })

  it('reads a real amount under a cent as less than one cent', () => {
    expect(figureParts('<$0.01')).toMatchObject({
      below: true,
      whole: '0',
      fraction: '.01',
      spoken: 'less than 1 cent',
    })
  })

  it('shows a real zero the money layer sent', () => {
    expect(figureParts('$0.00')).toMatchObject({ whole: '0', fraction: '.00' })
  })

  it('keeps exact sub-cent detail the money layer wrote', () => {
    expect(figureParts('$4.875')).toMatchObject({ fraction: '.875' })
  })

  it('refuses text it does not recognise', () => {
    for (const display of [
      '',
      '0',
      '$',
      '18.40',
      '$18.4',
      '-$1.00',
      '$-1.00',
      '$ 1.00',
      'USD 1.00',
      '$1,23.00',
      '$01.00',
      '<$0.02',
      '≈ <$0.01',
      '$NaN',
      '$Infinity',
    ]) {
      expect(figureParts(display), display).toBeNull()
    }
  })
})

describe('figureState', () => {
  const value = { cents: 1840, display: '$18.40' }

  it('draws the value when the server answered', () => {
    expect(figureState(value).kind).toBe('value')
  })

  it('is loading, with no digits, until the server answers', () => {
    expect(figureState(null, 'loading')).toEqual({ kind: 'loading' })
    expect(figureState(value, 'loading')).toEqual({ kind: 'loading' })
  })

  it('never turns a missing value into a zero', () => {
    expect(figureState(null)).toEqual({ kind: 'unavailable' })
    expect(figureState(null, 'unavailable')).toEqual({ kind: 'unavailable' })
  })

  it('shows unavailable when the payments layer is down, even with a stale value', () => {
    expect(figureState(value, 'unavailable')).toEqual({ kind: 'unavailable' })
  })

  it('shows unavailable for display text it cannot read', () => {
    expect(figureState({ cents: 0, display: '0' })).toEqual({
      kind: 'unavailable',
    })
  })
})
