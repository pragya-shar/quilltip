import { describe, expect, it } from 'vitest'
import { figureParts, figureState, spokenDollars } from '@/system/money/figure'

// The money figure lays out the money layer's display text (design N2):
// exact, two decimals, up to six with fractions of a cent, "≈" only for a
// converted figure, "$0.00" below the sixth decimal, never "<$0.01".

describe('figureParts', () => {
  it('splits an exact amount into dollars and cents', () => {
    expect(figureParts('$18.40')).toEqual({
      approx: false,
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

  it('keeps fractions of a cent, up to six decimals', () => {
    for (const [display, fraction] of [
      ['$0.0975', '.0975'],
      ['$2.925', '.925'],
      ['$0.04875', '.04875'],
      ['$280.4075', '.4075'],
      ['$0.000001', '.000001'],
    ] as const) {
      expect(figureParts(display), display).toMatchObject({
        fraction,
        spoken: display,
      })
    }
  })

  it('shows an amount below the sixth decimal, and a real zero, as $0.00', () => {
    expect(figureParts('$0.00')).toMatchObject({ whole: '0', fraction: '.00' })
  })

  it('marks a converted amount as approximate, with or without the space', () => {
    for (const display of ['≈ $17.28', '≈$17.28', '≈ $0.00']) {
      expect(figureParts(display)).toMatchObject({ approx: true })
    }
    expect(figureParts('≈ $17.28')?.spoken).toBe('about $17.28')
  })

  it('refuses text it does not recognise, "<$0.01" included', () => {
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
      '<$0.01',
      '≈ <$0.01',
      '$0.0000001',
      '$1.9500',
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
    expect(figureState({ cents: 0, display: '<$0.01' })).toEqual({
      kind: 'unavailable',
    })
  })
})

describe('a converted figure (D24)', () => {
  it('takes the approximate mark from the flag, not from the text', () => {
    const state = figureState({
      cents: 1840,
      display: '$18.40',
      converted: true,
    })
    expect(state).toMatchObject({
      kind: 'value',
      parts: { approx: true, spoken: 'about $18.40' },
    })
    expect(figureState({ cents: 1840, display: '$18.40' })).toMatchObject({
      parts: { approx: false },
    })
  })
})

describe('spokenDollars', () => {
  it('says the amount in words, with "about" for a conversion', () => {
    const say = (display: string, converted = false) => {
      const state = figureState({ cents: 0, display, converted })
      return state.kind === 'value' ? spokenDollars(state.parts) : null
    }
    expect(say('$18.40', true)).toBe('about 18 dollars 40')
    expect(say('$18.40')).toBe('18 dollars 40')
    expect(say('$5')).toBe('5 dollars')
    expect(say('$5.00')).toBe('5 dollars')
    expect(say('$1,234.05')).toBe('1234 dollars 05')
    expect(say('$0.0975')).toBe('0.0975 dollars')
  })
})
