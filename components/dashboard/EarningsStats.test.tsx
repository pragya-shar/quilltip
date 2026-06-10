/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EarningsStats } from '@/components/dashboard/EarningsStats'

vi.mock('@/hooks/useDashboardNavigation', () => ({
  useDashboardNavigation: () => vi.fn(),
}))
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
    expect(screen.getByText('5 testnet tips received')).toBeInTheDocument()
  })

  it('renders monthly chart with readable labels for recent months', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 5, 15))
    const earnings = makeEarnings({
      monthlyEarnings: {
        '2024-06': 30,
      },
    })
    render(
      <EarningsStats
        earnings={earnings}
        userProfile={{ stellarAddress: 'x' }}
        minWithdrawalUsd={5}
        onOpenWithdrawModal={vi.fn()}
      />
    )

    expect(
      screen.getByRole('heading', { name: /monthly earnings/i })
    ).toBeInTheDocument()
    expect(screen.getByText('$30')).toBeInTheDocument()
    expect(screen.queryByText('2024-06')).not.toBeInTheDocument()
    vi.useRealTimers()
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

  it('shows minimum withdrawal helper and disables withdraw when balance is below minimum', () => {
    const earnings = makeEarnings({
      availableBalanceUsd: 4.5,
      availableBalanceCents: 450,
    })
    render(
      <EarningsStats
        earnings={earnings}
        userProfile={{ stellarAddress: 'G' + 'A'.repeat(55) }}
        minWithdrawalUsd={10}
        onOpenWithdrawModal={vi.fn()}
      />
    )

    expect(
      screen.getByText(/minimum available balance of \$10\.00/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /withdraw/i })).toBeDisabled()
  })
})
