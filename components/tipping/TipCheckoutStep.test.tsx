/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TipCheckoutStep } from '@/components/tipping/TipCheckoutStep'

vi.mock('@/components/guide/WalletTooltip', () => ({
  WalletTooltip: () => null,
}))

vi.mock('@/lib/copy/network-status', () => ({
  networkLabelLowercase: () => 'testnet',
  tipDialogFooterNote: () => 'Test network only',
}))

describe('TipCheckoutStep', () => {
  it('blocks the payment action while terminal verification is being applied', () => {
    const onSendTip = vi.fn()
    render(
      <TipCheckoutStep
        variant="article"
        authorName="Author"
        amountCents={100}
        isAuthenticated
        isConnected
        isWalletLoading={false}
        publicKey="GABCDEF123456789"
        isLoading={false}
        tipSuccess={null}
        tipFailure={null}
        verificationSettled
        tipFlowStep={null}
        onBack={vi.fn()}
        onSignIn={vi.fn()}
        onConnectWallet={vi.fn()}
        onSendTip={onSendTip}
      />
    )

    const finalizingButton = screen.getByRole('button', {
      name: 'Finalizing tip',
    })
    expect(finalizingButton).toBeDisabled()
    fireEvent.click(finalizingButton)
    expect(onSendTip).not.toHaveBeenCalled()
  })
})
