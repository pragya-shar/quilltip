import { describe, expect, it } from 'vitest'
import {
  centsFromInput,
  tipButtonLabel,
  tipButtonParts,
  tipNote,
} from '@/system/money/tip'

const three = { cents: 300, display: '$3' }

describe('tip button words', () => {
  it('states the amount apart from the words, so it is never cut', () => {
    expect(tipButtonParts({ phase: 'idle' }, three, 'article')).toEqual({
      words: 'Tip',
      amount: '$3',
    })
    expect(
      tipButtonParts(
        { phase: 'needs-funds', amount: three, available: null },
        three,
        'article'
      )
    ).toEqual({ words: 'Add money to tip', amount: '$3' })
  })

  it('says each phase in words', () => {
    expect(tipButtonLabel({ phase: 'idle' }, three, 'passage')).toBe(
      'Tip this line $3'
    )
    expect(
      tipButtonLabel({ phase: 'sending', amount: three }, three, 'article')
    ).toBe('Sending $3')
    expect(
      tipButtonLabel({ phase: 'sent', amount: three }, three, 'article')
    ).toBe('Sent $3')
    expect(
      tipButtonLabel({ phase: 'failed', amount: three }, three, 'article')
    ).toBe('Try again')
    expect(
      tipButtonLabel({ phase: 'offline', amount: three }, three, 'article')
    ).toBe('Offline')
    expect(tipButtonLabel({ phase: 'idle' }, null, 'article')).toBe(
      'Choose an amount'
    )
  })

  it('takes one more phase from outside, with its own words', () => {
    expect(
      tipButtonLabel(
        { phase: 'other', words: 'Adding', amount: three, busy: true },
        three,
        'article'
      )
    ).toBe('Adding $3')
  })

  it('explains a refusal and being offline, and nothing else', () => {
    expect(tipNote({ phase: 'failed', amount: three })).toBe(
      'That tip did not go through. You were not charged.'
    )
    expect(tipNote({ phase: 'offline', amount: three })).toMatch(/offline/)
    expect(tipNote({ phase: 'sent', amount: three })).toBeNull()
  })
})

describe('another amount', () => {
  it('reads dollars as cents', () => {
    expect(centsFromInput('2')).toBe(200)
    expect(centsFromInput('2.5')).toBe(250)
    expect(centsFromInput('$2.50')).toBe(250)
    expect(centsFromInput(' 10 ')).toBe(1000)
  })

  it('refuses anything else, and zero', () => {
    for (const text of ['', 'abc', '0', '0.00', '-1', '2.505', '1,000', '1e3'])
      expect(centsFromInput(text), text).toBeNull()
  })
})
