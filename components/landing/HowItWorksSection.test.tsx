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

describe('HowItWorksSection step controls', () => {
  beforeEach(() => {
    isMobileViewport = false
  })

  function stepsTablist(label: 'Writer steps' | 'Reader steps') {
    const lists = screen.getAllByRole('tablist', { name: label })
    const active = lists.find((el) => el.getAttribute('aria-hidden') !== 'true')
    if (!active) {
      throw new Error(`No active tablist for ${label}`)
    }
    return active
  }

  function stepTab(label: 'Writer steps' | 'Reader steps', name: string) {
    return within(stepsTablist(label)).getByRole('tab', { name })
  }

  function expectPanelShows(tab: HTMLElement, text: string) {
    const panelId = tab.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    const panel = document.getElementById(panelId!)
    expect(panel).toBeTruthy()
    expect(within(panel!).getByText(text)).toBeVisible()
  }

  it('selects the first writer step by default on desktop', () => {
    render(<HowItWorksSection />)

    const signUp = stepTab('Writer steps', 'Sign Up')
    expect(signUp).toHaveAttribute('aria-selected', 'true')
    expectPanelShows(
      signUp,
      'One-click registration with your email. Connect Freighter wallet to start receiving tips instantly.'
    )
  })

  it('activates another step on click and exposes selected state', async () => {
    const user = userEvent.setup()
    render(<HowItWorksSection />)

    const write = stepTab('Writer steps', 'Write')
    await user.click(write)

    expect(write).toHaveAttribute('aria-selected', 'true')
    expect(stepTab('Writer steps', 'Sign Up')).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expectPanelShows(
      write,
      'Full markdown support, code blocks, media embeds, and a distraction-free writing experience.'
    )
  })

  it('moves to the next step with ArrowRight and updates focus', async () => {
    const user = userEvent.setup()
    render(<HowItWorksSection />)

    const signUp = stepTab('Writer steps', 'Sign Up')
    signUp.focus()
    await user.keyboard('{ArrowRight}')

    const write = stepTab('Writer steps', 'Write')
    expect(write).toHaveFocus()
    expect(write).toHaveAttribute('aria-selected', 'true')
  })

  it('links each tab to its tabpanel', () => {
    render(<HowItWorksSection />)

    const signUp = stepTab('Writer steps', 'Sign Up')
    const panelId = signUp.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    const panel = document.getElementById(panelId!)
    expect(panel).toHaveAttribute('role', 'tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', signUp.id)
  })

  it('resets to the first reader step when switching audience tabs', async () => {
    const user = userEvent.setup()
    render(<HowItWorksSection />)

    await user.click(stepTab('Writer steps', 'Write'))
    await user.click(screen.getByRole('tab', { name: 'For Readers' }))

    const browse = stepTab('Reader steps', 'Browse')
    expect(browse).toHaveAttribute('aria-selected', 'true')
    expectPanelShows(
      browse,
      'All articles are free to read. Explore by topic, trending, or latest. No paywalls, ever.'
    )
    expect(
      within(stepsTablist('Reader steps')).getAllByRole('tab')
    ).toHaveLength(4)
  })

  it('operates mobile step tabs when the mobile layout is active', async () => {
    isMobileViewport = true
    const user = userEvent.setup()
    render(<HowItWorksSection />)

    const publish = stepTab('Writer steps', 'Publish')
    await user.click(publish)

    expect(publish).toHaveAttribute('aria-selected', 'true')
    expectPanelShows(
      publish,
      'Your article is stored permanently on Arweave. A tamper-proof record of your creative work, forever.'
    )
  })
})
