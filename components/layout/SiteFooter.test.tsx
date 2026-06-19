/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { practiceFundsNote } from '@/lib/copy/network-status'

vi.mock('@/components/landing/Reveal', () => ({
  Reveal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/layout/FooterNav', () => ({
  FooterNav: () => <nav aria-label="Footer" />,
}))

vi.mock('@/components/ui/Logo', () => ({
  Logo: () => <span>Logo</span>,
}))

describe('SiteFooter', () => {
  it('renders compact network badge instead of full practice note on default variant', () => {
    render(<SiteFooter variant="default" />)

    expect(
      screen.getByText('Testnet — practice funds only')
    ).toBeInTheDocument()
    expect(screen.queryByText(practiceFundsNote())).not.toBeInTheDocument()
  })

  it('renders compact network badge on landing variant', () => {
    render(<SiteFooter variant="landing" />)

    expect(
      screen.getByText('Testnet — practice funds only')
    ).toBeInTheDocument()
    expect(screen.queryByText(practiceFundsNote())).not.toBeInTheDocument()
  })
})
