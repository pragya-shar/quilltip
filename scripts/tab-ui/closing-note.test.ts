import { describe, expect, it } from 'vitest'

import { TAB_BALANCE, TAB_CLOSE } from '../../lib/copy/tab'

/**
 * The note under a closing tab's balance answers when it unlocks and what
 * the reader does then, beside the figure (#671).
 */
describe('closing tab balance note', () => {
  it('names the unlock date and the Withdraw action', () => {
    expect(TAB_BALANCE.closingFreeNote('Monday 30 November', false)).toBe(
      'Unlocks around Monday 30 November. Come back then and choose Withdraw to move it to your wallet. Quick tips are off while your tab closes.'
    )
  })

  it('without a date, states the waiting period', () => {
    expect(TAB_BALANCE.closingFreeNote(null, false)).toBe(
      'Unlocks after about 3 days. Come back then and choose Withdraw to move it to your wallet. Quick tips are off while your tab closes.'
    )
  })

  it('once unlocked, says so and names the action', () => {
    const note = TAB_BALANCE.closingFreeNote('Monday 30 November', true)
    expect(note).toBe('Unlocked. Choose Withdraw to move it to your wallet.')
    expect(note).not.toContain('Come back')
  })

  it('uses the same date wording as the close timeline', () => {
    expect(TAB_BALANCE.closingFreeNote('Friday 4 December', false)).toContain(
      TAB_CLOSE.unlocks('Friday 4 December')
    )
  })
})
