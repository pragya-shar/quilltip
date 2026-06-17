/** @vitest-environment jsdom */
import type { HTMLAttributes, ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import HowItWorksSection from '@/components/landing/HowItWorksSection'

vi.mock('motion/react', () => ({
  motion: {
    section: (props: HTMLAttributes<HTMLElement>) => <section {...props} />,
    div: (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />,
    button: (props: HTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props} />
    ),
  },
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  useInView: () => true,
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode
    href: string
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/landing/LandingTippingDemo', () => ({
  LandingTippingDemo: () => <div data-testid="landing-tipping-demo" />,
}))

describe('HowItWorksSection step controls', () => {
  function stepsRegion() {
    return screen.getByLabelText('How it works steps')
  }

  function stepTrigger(name: string) {
    return within(stepsRegion()).getByRole('button', { name })
  }

  function expectStepContentVisible(text: string) {
    expect(screen.getByText(text)).toBeVisible()
  }

  it('renders three launch-critical steps', () => {
    render(<HowItWorksSection />)

    expect(within(stepsRegion()).getAllByRole('button')).toHaveLength(3)
    expect(
      screen.getByRole('heading', { name: 'How tipping works' })
    ).toBeInTheDocument()
  })

  it('opens the first step by default', () => {
    render(<HowItWorksSection />)

    const browse = stepTrigger('Browse')
    expect(browse).toHaveAttribute('aria-expanded', 'true')
    expectStepContentVisible(
      'All articles are free to read. Explore by topic, trending, or latest. No paywalls, ever.'
    )
  })

  it('opens another step on click and collapses the previous one', async () => {
    const user = userEvent.setup()
    render(<HowItWorksSection />)

    const tip = stepTrigger('Tip')
    await user.click(tip)

    expect(tip).toHaveAttribute('aria-expanded', 'true')
    expect(stepTrigger('Browse')).toHaveAttribute('aria-expanded', 'false')
    expectStepContentVisible(
      "Install Freighter, fund with free testnet XLM, and send tips that settle in about 3 seconds."
    )
  })

  it('toggles a step closed with Enter when it is already open', async () => {
    const user = userEvent.setup()
    render(<HowItWorksSection />)

    const browse = stepTrigger('Browse')
    browse.focus()
    await user.keyboard('{Enter}')

    expect(browse).toHaveAttribute('aria-expanded', 'false')
  })

  it('links each trigger to its content panel', () => {
    render(<HowItWorksSection />)

    const browse = stepTrigger('Browse')
    const panelId = browse.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    const panel = document.getElementById(panelId!)
    expect(panel).toBeTruthy()
    expect(
      within(panel!).getByText(
        'Discover articles from writers across the platform'
      )
    ).toBeInTheDocument()
  })

  it('opens a step on mobile viewport', async () => {
    const user = userEvent.setup()
    render(<HowItWorksSection />)

    const publish = stepTrigger('Publish & earn')
    await user.click(publish)

    expect(publish).toHaveAttribute('aria-expanded', 'true')
    expectStepContentVisible(
      'Use the rich editor to publish your work. Tips go directly to your wallet with near-zero fees.'
    )
  })
})
