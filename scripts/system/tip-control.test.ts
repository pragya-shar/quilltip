import { describe, expect, it } from 'vitest'
import {
  amountChoosable,
  buttonAmount,
  pressHoldAfter,
  centsFromInput,
  firstName,
  tipButtonLabel,
  tipButtonParts,
  tipNote,
} from '@/system/money/tip'

const three = { cents: 300, display: '$3' }

describe('tip button words', () => {
  it('states the amount apart from the words, so it is never cut', () => {
    expect(
      tipButtonParts({ phase: 'idle' }, three, 'article', 'Tomás Reyes')
    ).toEqual({ words: 'Tip Tomás', amount: '$3' })
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
      tipButtonLabel({ phase: 'holding', amount: three }, three, 'article')
    ).toBe('Sending $3')
    expect(
      tipButtonLabel({ phase: 'sending', amount: three }, three, 'article')
    ).toBe('Sending $3')
    expect(
      tipButtonLabel({ phase: 'sent', amount: three }, three, 'article')
    ).toBe('Sent $3')
    expect(
      tipButtonLabel({ phase: 'failed', amount: three }, three, 'article')
    ).toBe('Try again: tip $3')
    expect(
      tipButtonLabel({ phase: 'offline', amount: three }, three, 'article')
    ).toBe('Offline. You can tip when you reconnect.')
    expect(tipButtonLabel({ phase: 'idle' }, null, 'article')).toBe(
      'Choose an amount'
    )
  })

  it('states the chosen amount after a refusal, as the amount control does', () => {
    const two = { cents: 200, display: '$2' }
    expect(
      tipButtonLabel({ phase: 'failed', amount: three }, two, 'article')
    ).toBe('Try again: tip $2')
    expect(
      tipButtonLabel(
        { phase: 'needs-funds', amount: three, available: null },
        two,
        'article'
      )
    ).toBe('Add money to tip $2')
    expect(
      tipButtonLabel({ phase: 'failed', amount: three }, null, 'article')
    ).toBe('Try again: tip $3')
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

  it('states the short amount when the money layer gives one', () => {
    const one = { cents: 100, display: '$1.00', short: '$1' }
    expect(tipButtonLabel({ phase: 'idle' }, one, 'passage')).toBe(
      'Tip this line $1'
    )
    expect(
      tipButtonLabel({ phase: 'sending', amount: one }, one, 'article')
    ).toBe('Sending $1')
    expect(
      tipButtonLabel(
        { phase: 'idle' },
        { cents: 100, display: '$1.00' },
        'article',
        'Ama'
      )
    ).toBe('Tip Ama $1.00')
  })

  it('explains a refusal and being offline, and nothing else', () => {
    expect(tipNote({ phase: 'failed', amount: three })).toBe(
      'That tip did not go through. You were not charged.'
    )
    expect(tipNote({ phase: 'offline', amount: three })).toBeNull()
    expect(tipNote({ phase: 'sent', amount: three })).toBeNull()
  })
})

describe('the writer', () => {
  it('is named by first name on the button', () => {
    expect(firstName('Tomás Reyes')).toBe('Tomás')
    expect(firstName('  Noor  ')).toBe('Noor')
  })
})

describe('another amount', () => {
  it('reads dollars as cents', () => {
    expect(centsFromInput('2')).toBe(200)
    expect(centsFromInput('2.5')).toBe(250)
    expect(centsFromInput('$2.50')).toBe(250)
    expect(centsFromInput(' 10 ')).toBe(1000)
  })

  it('reads a decimal comma', () => {
    expect(centsFromInput('2,5')).toBe(250)
    expect(centsFromInput('2,50')).toBe(250)
    expect(centsFromInput('$2,50')).toBe(250)
  })

  it('refuses anything else, and zero', () => {
    for (const text of [
      '',
      'abc',
      '0',
      '0.00',
      '-1',
      '2.505',
      '1,000',
      '2,505',
      '1e3',
    ])
      expect(centsFromInput(text), text).toBeNull()
  })
})

describe('one amount for the label and the press', () => {
  const two = { cents: 200, display: '$2' }
  it('is the chosen amount when idle, none without one', () => {
    expect(buttonAmount({ phase: 'idle' }, two)).toBe(two)
    expect(buttonAmount({ phase: 'idle' }, null)).toBeNull()
  })
  it('after a refusal, the amount chosen since, else the one tried', () => {
    expect(buttonAmount({ phase: 'failed', amount: three }, two)).toBe(two)
    expect(buttonAmount({ phase: 'failed', amount: three }, null)).toBe(three)
    expect(
      tipButtonLabel({ phase: 'failed', amount: three }, null, 'article')
    ).toBe('Try again: tip $3')
  })
  it("in another phase, the phase's own", () => {
    const other = {
      phase: 'other',
      words: 'Adding',
      amount: three,
      busy: false,
    } as const
    expect(buttonAmount(other, null)).toBe(three)
    expect(tipButtonLabel(other, null, 'article')).toBe('Adding $3')
  })
  it('holds presses a moment when the button turns into another action', () => {
    // Longer than the gap between the two taps of a double tap.
    expect(pressHoldAfter('failed')).toBeGreaterThanOrEqual(400)
    expect(pressHoldAfter('needs-funds')).toBeGreaterThanOrEqual(400)
    for (const phase of ['idle', 'sending', 'sent', 'offline'] as const)
      expect(pressHoldAfter(phase), phase).toBe(0)
  })

  it('lets the reader choose the amount only where the button sends it', () => {
    const one = { cents: 100, display: '$1' }
    const phases = [
      { phase: 'idle' },
      { phase: 'holding', amount: three },
      { phase: 'sending', amount: three },
      { phase: 'sent', amount: three },
      { phase: 'failed', amount: three },
      { phase: 'offline', amount: three },
      { phase: 'needs-funds', amount: three, available: null },
      { phase: 'other', words: 'Adding', amount: three, busy: false },
    ] as const
    for (const state of phases) {
      // Where the amount control is hidden, a chosen amount changes nothing
      // the button says or sends.
      const reads = buttonAmount(state, one) !== buttonAmount(state, two)
      expect(amountChoosable(state), state.phase).toBe(reads)
      if (!amountChoosable(state))
        expect(tipButtonParts(state, one, 'article')).toEqual(
          tipButtonParts(state, two, 'article')
        )
    }
  })
})
