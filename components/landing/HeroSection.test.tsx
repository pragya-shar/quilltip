/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HeroSection from '@/components/landing/HeroSection'
import {
  HERO_START_READING,
  HERO_START_WRITING,
  HERO_WALLET_SETUP,
} from '@/lib/copy/nav-cta'

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    h1: ({ children, ...props }: { children?: React.ReactNode }) => (
      <h1 {...props}>{children}</h1>
    ),
    p: ({ children, ...props }: { children?: React.ReactNode }) => (
      <p {...props}>{children}</p>
    ),
  },
}))

vi.mock('next/link', () => ({
  default: (props: { href: string; children: React.ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}))

vi.mock('@/components/landing/LandingProductProof', () => ({
  LandingProductProof: () => <div data-testid="landing-product-proof" />,
}))

describe('HeroSection launch CTAs', () => {
  it('shows one primary and one secondary CTA without wallet setup', () => {
    render(<HeroSection />)

    expect(screen.getByRole('link', { name: HERO_START_READING })).toHaveAttribute(
      'href',
      '/articles'
    )
    expect(screen.getByRole('link', { name: HERO_START_WRITING })).toHaveAttribute(
      'href',
      '/register'
    )
    expect(screen.queryByRole('link', { name: HERO_WALLET_SETUP })).not.toBeInTheDocument()
    expect(screen.queryByText('Live on Stellar Testnet')).not.toBeInTheDocument()
    expect(screen.queryByText('97.5%')).not.toBeInTheDocument()
  })
})
