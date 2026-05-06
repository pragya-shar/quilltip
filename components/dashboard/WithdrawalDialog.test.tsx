/** @vitest-environment jsdom */
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WithdrawalDialog } from '@/components/dashboard/WithdrawalDialog'

const VALID_TEST_PUBLIC_KEY =
  'GC2BKLYOOYPDEFJKLKY6FNNRQMGFLVHJKQRGNSSRRGSMPGF32LHCQVGF'

function corruptAccountId(address: string): string {
  const chars = address.split('')
  const idx = 15
  chars[idx] = chars[idx] === 'A' ? 'B' : 'A'
  return chars.join('')
}

describe('WithdrawalDialog', () => {
  it('calls onWithdraw with entered amount and address', async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    const triggerRef = createRef<HTMLButtonElement>()
    render(
      <WithdrawalDialog
        open
        onOpenChange={onOpenChange}
        availableBalanceUsd={100}
        minWithdrawalUsd={5}
        savedStellarAddress={null}
        onWithdraw={onWithdraw}
        triggerRef={triggerRef}
      />
    )

    await user.type(screen.getByLabelText(/Amount \(USD\)/i), '10')
    await user.type(
      screen.getByLabelText(/Stellar Address/i),
      VALID_TEST_PUBLIC_KEY
    )
    await user.click(screen.getByRole('button', { name: /Withdraw$/i }))

    expect(onWithdraw).toHaveBeenCalledWith({
      amountUsd: 10,
      stellarAddress: VALID_TEST_PUBLIC_KEY,
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('uses saved Stellar address without manual entry', async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn().mockResolvedValue(undefined)
    const triggerRef = createRef<HTMLButtonElement>()
    render(
      <WithdrawalDialog
        open
        onOpenChange={() => {}}
        availableBalanceUsd={100}
        minWithdrawalUsd={5}
        savedStellarAddress={VALID_TEST_PUBLIC_KEY}
        onWithdraw={onWithdraw}
        triggerRef={triggerRef}
      />
    )

    await user.type(screen.getByLabelText(/Amount \(USD\)/i), '20')
    await user.click(screen.getByRole('button', { name: /Withdraw$/i }))

    expect(onWithdraw).toHaveBeenCalledWith({
      amountUsd: 20,
      stellarAddress: VALID_TEST_PUBLIC_KEY,
    })
  })

  it('shows inline error and disables withdraw for an invalid address', async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn().mockResolvedValue(undefined)
    const triggerRef = createRef<HTMLButtonElement>()
    const invalidAddress = corruptAccountId(VALID_TEST_PUBLIC_KEY)

    render(
      <WithdrawalDialog
        open
        onOpenChange={() => {}}
        availableBalanceUsd={100}
        minWithdrawalUsd={5}
        savedStellarAddress={null}
        onWithdraw={onWithdraw}
        triggerRef={triggerRef}
      />
    )

    await user.type(screen.getByLabelText(/Amount \(USD\)/i), '10')
    await user.type(screen.getByLabelText(/Stellar Address/i), invalidAddress)

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid Stellar address')
    const withdraw = screen.getByRole('button', { name: /Withdraw$/i })
    expect(withdraw).toBeDisabled()
    await user.click(withdraw)
    expect(onWithdraw).not.toHaveBeenCalled()
  })

  it('does not call onWithdraw when amount is below minimum', async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn().mockResolvedValue(undefined)
    const triggerRef = createRef<HTMLButtonElement>()
    render(
      <WithdrawalDialog
        open
        onOpenChange={() => {}}
        availableBalanceUsd={100}
        minWithdrawalUsd={5}
        savedStellarAddress={VALID_TEST_PUBLIC_KEY}
        onWithdraw={onWithdraw}
        triggerRef={triggerRef}
      />
    )

    await user.type(screen.getByLabelText(/Amount \(USD\)/i), '2')
    await user.click(screen.getByRole('button', { name: /Withdraw$/i }))

    expect(onWithdraw).not.toHaveBeenCalled()
  })

  it('renders nothing when closed', () => {
    const triggerRef = createRef<HTMLButtonElement>()
    const { container } = render(
      <WithdrawalDialog
        open={false}
        onOpenChange={() => {}}
        availableBalanceUsd={100}
        minWithdrawalUsd={5}
        onWithdraw={vi.fn()}
        triggerRef={triggerRef}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})
