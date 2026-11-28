import { describe, expect, it } from 'vitest'
import { onOnline, onTap } from '../../lib/payments/tip-machine'
import { money } from '../../lib/payments/money'
import type { TipPhase } from '../../lib/payments/types'

// Offline is a refusal before anything is sent, not a state the control
// keeps: back online, it is ready to tip again, and nothing is sent by that.

const check = { online: false, available: money(500), unavailable: null }

describe('back online', () => {
  it('an offline control is ready again, and nothing is sent', () => {
    const refused = onTap({ phase: 'idle' }, 100, check, 'r1')
    expect(refused).toEqual({
      send: false,
      phase: { phase: 'offline', amount: money(100) },
    })
    expect(onOnline(refused.phase, true)).toEqual({ phase: 'idle' })
  })

  it('still offline, it stays offline', () => {
    const phase: TipPhase = { phase: 'offline', amount: money(100) }
    expect(onOnline(phase, false)).toBe(phase)
  })

  it('leaves every other phase as it is', () => {
    const phases: TipPhase[] = [
      { phase: 'idle' },
      { phase: 'sending', requestId: 'r1', amount: money(100) },
      { phase: 'sent', requestId: 'r1', amount: money(100) },
      { phase: 'failed', code: 'X', amount: money(100) },
    ]
    for (const phase of phases) expect(onOnline(phase, true)).toBe(phase)
  })
})
