/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WithdrawalDialog } from '@/components/dashboard/WithdrawalDialog'

const validGAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

describe('WithdrawalDialog', () => {
  it('calls onWithdraw with entered amount and address', async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()

    render(
      <WithdrawalDialog
        open
        onOpenChange={onOpenChange}
        availableBalanceUsd={100}
        minWithdrawalUsd={5}
        savedStellarAddress={null}
        onWithdraw={onWithdraw}
      />
    )

    await user.type(screen.getByLabelText(/Amount \(USD\)/i), '10')
    await user.type(screen.getByLabelText(/Stellar Address/i), validGAddress)
    await user.click(screen.getByRole('button', { name: /Withdraw$/i }))

    expect(onWithdraw).toHaveBeenCalledWith({
      amountUsd: 10,
      stellarAddress: validGAddress,
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('uses saved Stellar address without manual entry', async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn().mockResolvedValue(undefined)

    render(
      <WithdrawalDialog
        open
        onOpenChange={() => {}}
        availableBalanceUsd={100}
        minWithdrawalUsd={5}
        savedStellarAddress={validGAddress}
        onWithdraw={onWithdraw}
      />
    )

    await user.type(screen.getByLabelText(/Amount \(USD\)/i), '20')
    await user.click(screen.getByRole('button', { name: /Withdraw$/i }))

    expect(onWithdraw).toHaveBeenCalledWith({
      amountUsd: 20,
      stellarAddress: validGAddress,
    })
  })

  it('does not call onWithdraw when amount is below minimum', async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn().mockResolvedValue(undefined)

    render(
      <WithdrawalDialog
        open
        onOpenChange={() => {}}
        availableBalanceUsd={100}
        minWithdrawalUsd={5}
        savedStellarAddress={validGAddress}
        onWithdraw={onWithdraw}
      />
    )

    await user.type(screen.getByLabelText(/Amount \(USD\)/i), '2')
    await user.click(screen.getByRole('button', { name: /Withdraw$/i }))

    expect(onWithdraw).not.toHaveBeenCalled()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <WithdrawalDialog
        open={false}
        onOpenChange={() => {}}
        availableBalanceUsd={100}
        minWithdrawalUsd={5}
        onWithdraw={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('exposes an accessible dialog when open', () => {
    render(
      <WithdrawalDialog
        open
        onOpenChange={() => {}}
        availableBalanceUsd={100}
        minWithdrawalUsd={5}
        savedStellarAddress={validGAddress}
        onWithdraw={vi.fn()}
      />
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Withdraw Earnings/i })).toBeInTheDocument()
  })
})
