/** @vitest-environment jsdom */
import { createRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WithdrawalDialog } from '@/components/dashboard/WithdrawalDialog'

const validGAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

describe('WithdrawalDialog', () => {
  it(
    'calls onWithdraw with entered amount and address',
    async () => {
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
    await user.type(screen.getByLabelText(/Stellar Address/i), validGAddress)
    await user.click(screen.getByRole('button', { name: /Withdraw$/i }))

    await waitFor(() => {
      expect(onWithdraw).toHaveBeenCalledWith({
        amountUsd: 10,
        stellarAddress: validGAddress,
      })
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
    },
    10_000
  )

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
        savedStellarAddress={validGAddress}
        onWithdraw={onWithdraw}
        triggerRef={triggerRef}
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
    const triggerRef = createRef<HTMLButtonElement>()

    render(
      <WithdrawalDialog
        open
        onOpenChange={() => {}}
        availableBalanceUsd={100}
        minWithdrawalUsd={5}
        savedStellarAddress={validGAddress}
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
