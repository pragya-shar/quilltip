/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FeaturesSection from '@/components/landing/FeaturesSection'
import { LANDING_FEATURES } from '@/lib/landing/features'

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
}))

vi.mock('@/components/landing/Reveal', () => ({
  Reveal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('next/link', () => ({
  default: (props: { href: string; children: React.ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}))

describe('FeaturesSection keyboard navigation', () => {
  it('exposes a focusable link for each core feature', () => {
    render(<FeaturesSection />)

    for (const feature of LANDING_FEATURES) {
      expect(
        screen.getAllByRole('link', { name: feature.title }).length
      ).toBeGreaterThan(0)
    }
  })
})
