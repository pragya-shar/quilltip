/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonthlyEarningsChart } from '@/components/dashboard/monthly-earnings-chart'

describe('MonthlyEarningsChart', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 5, 15))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders readable month labels instead of raw keys', () => {
    render(
      <MonthlyEarningsChart
        monthlyEarnings={{
          '2024-01': 10,
          '2024-02': 20,
          '2024-03': 30,
        }}
      />
    )

    expect(screen.getByText('Jan')).toBeInTheDocument()
    expect(screen.getByText('Feb')).toBeInTheDocument()
    expect(screen.getByText('Mar')).toBeInTheDocument()
    expect(screen.queryByText('2024-01')).not.toBeInTheDocument()
    expect(screen.queryByText('2024-02')).not.toBeInTheDocument()
    expect(screen.queryByText('2024-03')).not.toBeInTheDocument()
  })

  it('renders six month slots for sparse data', () => {
    const { container } = render(
      <MonthlyEarningsChart monthlyEarnings={{ '2024-06': 30 }} />
    )

    expect(container.querySelectorAll('.grid > div')).toHaveLength(6)
    expect(screen.getByText('$30')).toBeInTheDocument()
    expect(screen.getAllByText('$0')).toHaveLength(5)
  })

  it('shows helper text when all amounts are zero', () => {
    render(<MonthlyEarningsChart monthlyEarnings={{}} />)

    expect(
      screen.getByText(/no earnings in the last 6 months/i)
    ).toBeInTheDocument()
    expect(screen.getAllByText('$0')).toHaveLength(6)
  })

  it('includes year on labels when the window spans two years', () => {
    vi.setSystemTime(new Date(2025, 0, 15))

    render(
      <MonthlyEarningsChart
        monthlyEarnings={{
          '2024-12': 5,
          '2025-01': 10,
        }}
      />
    )

    expect(screen.getByText('Dec 2024')).toBeInTheDocument()
    expect(screen.getByText('Jan 2025')).toBeInTheDocument()
  })
})
