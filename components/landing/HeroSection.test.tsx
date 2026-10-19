/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HeroSection from '@/components/landing/HeroSection'
vi.mock('next/link', () => ({
  default: (props: { href: string; children: React.ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}))

vi.mock('@/components/landing/LandingTippingDemo', () => ({
  LandingTippingDemo: () => <div data-testid="landing-tipping-demo" />,
}))

describe('HeroSection prototype CTAs', () => {
  it('offers the prototype reading and writing actions without requiring a wallet', () => {
    render(<HeroSection />)

    expect(
      screen.getByRole('link', { name: 'I’m here to read' })
    ).toHaveAttribute('href', '/articles')
    expect(
      screen.getByRole('link', { name: 'I’m here to write' })
    ).toHaveAttribute('href', '/write')
    expect(
      screen.queryByRole('link', { name: 'Set up wallet' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Live on Stellar Testnet')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('97.5%')).not.toBeInTheDocument()
  })
})
