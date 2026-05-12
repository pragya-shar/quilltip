import { describe, expect, it } from 'vitest'
import { formatTipFailureMessage } from './tip-error-messages'

describe('formatTipFailureMessage', () => {
  it('maps user rejection', () => {
    const r = formatTipFailureMessage(new Error('User declined'))
    expect(r.title).toContain('Wallet')
    expect(r.detail).toBeDefined()
  })

  it('maps network failure', () => {
    const r = formatTipFailureMessage(
      new Error('Transaction failed on the network')
    )
    expect(r.title).toContain('network')
  })

  it('maps cooldown copy verbatim', () => {
    const msg = 'Please wait 12s before tipping again.'
    const r = formatTipFailureMessage(new Error(msg))
    expect(r.title).toBe('Tip cooldown')
    expect(r.detail).toBe(msg)
  })
})
