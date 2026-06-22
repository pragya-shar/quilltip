/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TipHowItWorks } from '@/components/tipping/TipHowItWorks'

vi.mock('@/components/guide/WalletTooltip', () => ({
  WalletTooltip: () => null,
}))

describe('TipHowItWorks', () => {
  it('hides technical details until expanded', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <TipHowItWorks
        priceUsd={0.12}
        totalFormatted="$5.00"
        authorFormatted="$4.88"
        platformFeeFormatted="$0.12"
      />
    )

    expect(screen.queryByText(/97\.5%/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Platform fee/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'How it works' }))

    expect(screen.getByText(/97\.5%/)).toBeInTheDocument()
    expect(screen.getByText(/Platform fee/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /setup guide/i })).toHaveAttribute(
      'href',
      '/guide'
    )
  })
})
