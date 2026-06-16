/** @vitest-environment jsdom */
import type { HTMLAttributes, ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HowItWorksSection from '@/components/landing/HowItWorksSection'

let isMobileViewport = false

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => isMobileViewport,
}))

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
  beforeEach(() => {
    isMobileViewport = false
  })

  function stepsTablist() {
    const lists = screen.getAllByRole('tablist', {
      name: 'How it works steps',
    })
    const active = lists.find((el) => el.getAttribute('aria-hidden') !== 'true')
    if (!active) {
      throw new Error('No active tablist for how it works steps')
    }
    return active
  }

  function stepTab(name: string) {
    return within(stepsTablist()).getByRole('tab', { name })
  }

  function expectPanelShows(tab: HTMLElement, text: string) {
    const panelId = tab.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    const panel = document.getElementById(panelId!)
    expect(panel).toBeTruthy()
    expect(within(panel!).getByText(text)).toBeVisible()
  }

  it('renders three launch-critical steps on desktop', () => {
    render(<HowItWorksSection />)

    expect(within(stepsTablist()).getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('heading', { name: 'How tipping works' })).toBeInTheDocument()
  })

  it('selects the first step by default on desktop', () => {
    render(<HowItWorksSection />)

    const browse = stepTab('Browse')
    expect(browse).toHaveAttribute('aria-selected', 'true')
    expectPanelShows(
      browse,
      'All articles are free to read. Explore by topic, trending, or latest. No paywalls, ever.'
    )
  })

  it('activates another step on click and exposes selected state', async () => {
    const user = userEvent.setup()
    render(<HowItWorksSection />)

    const tip = stepTab('Tip')
    await user.click(tip)

    expect(tip).toHaveAttribute('aria-selected', 'true')
    expect(stepTab('Browse')).toHaveAttribute('aria-selected', 'false')
    expectPanelShows(
      tip,
      "Install Freighter, fund with free testnet XLM, and send tips that settle in about 3 seconds."
    )
  })

  it('moves to the next step with ArrowRight and updates focus', async () => {
    const user = userEvent.setup()
    render(<HowItWorksSection />)

    const browse = stepTab('Browse')
    browse.focus()
    await user.keyboard('{ArrowRight}')

    const tip = stepTab('Tip')
    expect(tip).toHaveFocus()
    expect(tip).toHaveAttribute('aria-selected', 'true')
  })

  it('links each tab to its tabpanel', () => {
    render(<HowItWorksSection />)

    const browse = stepTab('Browse')
    const panelId = browse.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    const panel = document.getElementById(panelId!)
    expect(panel).toHaveAttribute('role', 'tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', browse.id)
  })

  it('operates mobile step tabs when the mobile layout is active', async () => {
    isMobileViewport = true
    const user = userEvent.setup()
    render(<HowItWorksSection />)

    const publish = stepTab('Publish & earn')
    await user.click(publish)

    expect(publish).toHaveAttribute('aria-selected', 'true')
    expectPanelShows(
      publish,
      'Use the rich editor to publish your work. Tips go directly to your wallet with near-zero fees.'
    )
  })
})
