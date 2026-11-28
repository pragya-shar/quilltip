import { describe, expect, it } from 'vitest'
import { MONEY_TEXT_SAMPLES } from '@/lib/payments/money-samples'
import {
  figureParts,
  figureState,
  spokenDollars,
  spokenValue,
} from '@/system/money/figure'

// The money figure lays out the money layer's display text:
// exact, two decimals, up to six with fractions of a cent, "≈" only for a
// converted figure, "$0.00" below the sixth decimal, never "<$0.01".

describe('figureParts', () => {
  it('splits an exact amount into dollars and cents', () => {
    expect(figureParts('$18.40')).toEqual({
      approx: false,
      sign: '',
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
      '$-1.00',
      '−−$1.00',
      '−≈ $1.00',
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

describe('a direction', () => {
  it('reads a leading sign after any mark, and says it', () => {
    expect(figureParts('−$1.00')).toMatchObject({
      sign: '−',
      whole: '1',
      fraction: '.00',
      spoken: 'minus $1.00',
    })
    expect(figureParts('+$1.95')).toMatchObject({
      sign: '+',
      spoken: 'plus $1.95',
    })
    expect(figureParts('≈ −$2.40')).toMatchObject({
      approx: true,
      sign: '−',
      spoken: 'minus about $2.40',
    })
  })

  it('draws a hyphen as the minus sign', () => {
    expect(figureParts('-$1.00')).toMatchObject({ sign: '−' })
  })
})

// Literal outputs of the money layer's formatter (lib/payments/money.ts,
// `formatMoney` and `formatShort`), so a change on either side fails here.
describe("the money layer's text", () => {
  const LAYER: [display: string, spoken: string][] = [
    ['$1.00', '$1.00'], // formatMoney(100)
    ['$0.0975', '$0.0975'], // formatMoney(9.75)
    ['$2.925', '$2.925'], // formatMoney(292.5)
    ['$0.00', '$0.00'], // formatMoney(0.00001)
    ['$1,234,567.89', '$1,234,567.89'], // formatMoney(123456789)
    ['−$1.00', 'minus $1.00'], // formatMoney(100, { sign: 'minus' })
    ['+$1.95', 'plus $1.95'], // formatMoney(195, { sign: 'plus' })
    ['≈ $18.40', 'about $18.40'], // formatMoney(1840.5, { converted: true })
    ['≈ −$1.00', 'minus about $1.00'], // { sign: 'minus', converted: true }
    ['≈ +$0.40', 'plus about $0.40'], // { sign: 'plus', converted: true }
    ['$5', '$5'], // formatShort(500)
  ]
  it.each(LAYER)('lays out %s', (display, spoken) => {
    expect(figureParts(display)?.spoken).toBe(spoken)
  })

  it('adds the mark once for a converted value the layer already marked', () => {
    const state = figureState({
      cents: 1840,
      display: '≈ $18.40',
      converted: true,
    })
    expect(state).toMatchObject({
      parts: { approx: true, spoken: 'about $18.40' },
    })
  })

  it('adds the mark from the flag to a signed value', () => {
    expect(
      figureState({ cents: 100, display: '−$1.00', converted: true })
    ).toMatchObject({ parts: { approx: true, spoken: 'minus about $1.00' } })
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

describe('a converted figure', () => {
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
    expect(say('$1,234.05')).toBe('1,234 dollars 5')
    expect(say('−$18.40', true)).toBe('minus about 18 dollars 40')
  })

  it('says cents under a dollar, and one dollar as one', () => {
    const say = (display: string) => {
      const parts = figureParts(display)
      return parts ? spokenDollars(parts) : null
    }
    expect(say('$0.0975')).toBe('9.75 cents')
    expect(say('$0.10')).toBe('10 cents')
    expect(say('$0.01')).toBe('1 cent')
    expect(say('$0.00')).toBe('0 cents')
    expect(say('$0.04875')).toBe('4.875 cents')
    expect(say('$1.95')).toBe('1 dollar 95')
    expect(say('$1.00')).toBe('1 dollar')
    expect(say('$2.50')).toBe('2 dollars 50')
    expect(say('$2.925')).toBe('2 dollars 92.5')
    expect(say('+$0.98')).toBe('plus 98 cents')
  })

  it("prefers the money layer's own words", () => {
    expect(
      spokenValue({ cents: 9.75, display: '$0.0975', spoken: '9.75 cents' })
    ).toBe('9.75 cents')
    expect(
      spokenValue({ cents: 100, display: '−$1.00', spoken: '1 dollar' })
    ).toBe('minus 1 dollar')
    // Words that already say the sign keep it once.
    for (const sample of MONEY_TEXT_SAMPLES)
      expect(
        spokenValue({
          cents: sample.cents,
          display: sample.text,
          spoken: sample.spoken,
        }),
        sample.name
      ).toBe(sample.spoken)
    expect(spokenValue({ cents: 195, display: '$1.95' })).toBe('1 dollar 95')
    expect(spokenValue({ cents: 0, display: '<$0.01' })).toBeNull()
  })
})
