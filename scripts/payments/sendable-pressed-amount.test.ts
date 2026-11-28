import { describe, expect, it } from 'vitest'
import { sendablePressedAmount } from '../../lib/payments/views'

/**
 * One table for every early press: the engine's queued taps and the tip
 * bar's hand-off both call `sendablePressedAmount`, so a press sends the
 * amount on the button or nothing.
 */
export const PRESSED_AMOUNT_CASES: readonly {
  pressed: number
  offered: readonly number[]
  sends: number | null
}[] = [
  { pressed: 100, offered: [25, 50, 100, 200, 500], sends: 100 },
  { pressed: 100, offered: [10, 25, 50], sends: null },
  { pressed: 100, offered: [200, 500], sends: null },
  { pressed: 50, offered: [10, 25, 100], sends: null },
  { pressed: 100, offered: [], sends: null },
  { pressed: 500, offered: [100, 500], sends: 500 },
]

describe('the amount an early press may send', () => {
  it.each(PRESSED_AMOUNT_CASES)(
    'pressed $pressed with $offered offered sends $sends',
    ({ pressed, offered, sends }) => {
      expect(sendablePressedAmount(pressed, offered)).toBe(sends)
    }
  )
})
