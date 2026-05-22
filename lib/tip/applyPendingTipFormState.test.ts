import { describe, expect, it, vi } from 'vitest'
import { applyPendingAmountFields } from './applyPendingTipFormState'

describe('applyPendingAmountFields', () => {
  it('sets preset amount and clears custom amount', () => {
    const setSelectedAmount = vi.fn()
    const setCustomAmount = vi.fn()
    applyPendingAmountFields(
      { amountCents: 100 },
      setSelectedAmount,
      setCustomAmount
    )
    expect(setSelectedAmount).toHaveBeenCalledWith(100)
    expect(setCustomAmount).toHaveBeenCalledWith('')
  })

  it('sets custom amount and clears preset when no amountCents', () => {
    const setSelectedAmount = vi.fn()
    const setCustomAmount = vi.fn()
    applyPendingAmountFields(
      { customAmount: '2.50' },
      setSelectedAmount,
      setCustomAmount
    )
    expect(setCustomAmount).toHaveBeenCalledWith('2.50')
    expect(setSelectedAmount).toHaveBeenCalledWith(null)
  })

  it('does nothing when no amount fields', () => {
    const setSelectedAmount = vi.fn()
    const setCustomAmount = vi.fn()
    applyPendingAmountFields({}, setSelectedAmount, setCustomAmount)
    expect(setSelectedAmount).not.toHaveBeenCalled()
    expect(setCustomAmount).not.toHaveBeenCalled()
  })
})
