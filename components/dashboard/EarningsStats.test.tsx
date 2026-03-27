/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EarningsStats } from '@/components/dashboard/EarningsStats'
import type { Doc } from '@/types/convex'
import type { Id } from '@/types/convex'

function makeEarnings(
  overrides: Partial<Doc<'authorEarnings'>> = {}
): Doc<'authorEarnings'> {
  const base = {
    _id: 'e1' as Id<'authorEarnings'>,
    _creationTime: 1,
    userId: 'u1' as Id<'users'>,
    totalEarnedUsd: 100,
    totalEarnedCents: 10000,
    availableBalanceUsd: 50,
    availableBalanceCents: 5000,
    pendingBalanceUsd: 0,
    pendingBalanceCents: 0,
    withdrawnUsd: 10,
    withdrawnCents: 1000,
    tipCount: 3,
    createdAt: 1,
    updatedAt: 1,
  }
  return { ...base, ...overrides } as Doc<'authorEarnings'>
}

describe('EarningsStats', () => {
  it('renders stat totals', () => {
    const earnings = makeEarnings({
      totalEarnedUsd: 123.45,
      availableBalanceUsd: 67.89,
      withdrawnUsd: 12,
      tipCount: 5,
    })
    render(
      <EarningsStats
        earnings={earnings}
        userProfile={{ stellarAddress: 'G' + 'A'.repeat(55) }}
        minWithdrawalUsd={5}
        onOpenWithdrawModal={vi.fn()}
      />
    )

    expect(screen.getByText('$123.45')).toBeInTheDocument()
    expect(screen.getByText('$67.89')).toBeInTheDocument()
    expect(screen.getByText('$12.00')).toBeInTheDocument()
    expect(screen.getByText('5 tips received')).toBeInTheDocument()
  })

  it('renders monthly chart labels in display order', () => {
    const earnings = makeEarnings({
      monthlyEarnings: {
        '2024-01': 10,
        '2024-02': 20,
        '2024-03': 30,
      },
    })
    const { container } = render(
      <EarningsStats
        earnings={earnings}
        userProfile={{ stellarAddress: 'x' }}
        minWithdrawalUsd={5}
        onOpenWithdrawModal={vi.fn()}
      />
    )

    const months = container.querySelectorAll('.text-xs.text-gray-500.mb-1')
    const labels = [...months].map((el) => el.textContent)
    expect(labels).toEqual(['2024-01', '2024-02', '2024-03'])
  })

  it('shows wallet setup notice when profile has no Stellar address', () => {
    const earnings = makeEarnings()
    render(
      <EarningsStats
        earnings={earnings}
        userProfile={{ stellarAddress: undefined }}
        minWithdrawalUsd={5}
        onOpenWithdrawModal={vi.fn()}
      />
    )

    expect(
      screen.getByRole('heading', { name: /Stellar Wallet Not Configured/i })
    ).toBeInTheDocument()
  })
})
