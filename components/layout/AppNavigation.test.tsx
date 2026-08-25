/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import AppNavigation from '@/components/layout/AppNavigation'
import { NAV_SIGN_IN, NAV_TRY_ON_TESTNET } from '@/lib/copy/nav-cta'

const mockUseAuth = vi.fn()
const mockUsePathname = vi.fn(() => '/')

vi.mock('next/link', () => ({
  default: (props: { href: string; children: ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/components/theme/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}))

vi.mock('motion/react', () => ({
  motion: {
    span: (props: { children: ReactNode; className?: string }) => (
      <span className={props.className}>{props.children}</span>
    ),
  },
}))

describe('AppNavigation mobile menu', () => {
  beforeEach(() => {
    document.body.style.pointerEvents = ''
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      signOut: vi.fn(),
    })
  })

  it('opens a dialog when the menu toggle is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    render(<AppNavigation />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Navigation menu' })
    ).toBeInTheDocument()
  }, 15000)

  it('closes the dialog when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(<AppNavigation />)

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the dialog when opened with Enter and closed with Escape', async () => {
    const user = userEvent.setup()
    render(<AppNavigation />)

    const trigger = screen.getByRole('button', { name: 'Toggle menu' })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps focus inside the dialog when tabbing', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Behind</button>
        <AppNavigation />
      </>
    )

    const behind = screen.getByRole('button', { name: 'Behind' })

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))
    const dialog = screen.getByRole('dialog')

    for (let i = 0; i < 12; i++) {
      await user.tab()
      expect(behind).not.toHaveFocus()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('returns focus to the menu trigger when closed with Escape', async () => {
    const user = userEvent.setup()
    render(<AppNavigation />)

    const trigger = screen.getByRole('button', { name: 'Toggle menu' })

    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

describe('AppNavigation auth CTAs', () => {
  beforeEach(() => {
    document.body.style.pointerEvents = ''
    mockUsePathname.mockReturnValue('/')
  })

  it('hides signed-out CTAs while auth is loading', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      signOut: vi.fn(),
    })

    render(<AppNavigation />)

    expect(screen.queryByText(NAV_SIGN_IN)).not.toBeInTheDocument()
    expect(screen.queryByText(NAV_TRY_ON_TESTNET)).not.toBeInTheDocument()
  })

  it('shows signed-out CTAs when auth has resolved for guests', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      signOut: vi.fn(),
    })

    render(<AppNavigation />)

    expect(screen.getByText(NAV_SIGN_IN)).toBeInTheDocument()
    expect(screen.getByText(NAV_TRY_ON_TESTNET)).toBeInTheDocument()
  })

  it('shows authenticated links when signed in', () => {
    mockUseAuth.mockReturnValue({
      user: { username: 'writer' },
      isAuthenticated: true,
      isLoading: false,
      signOut: vi.fn(),
    })

    render(<AppNavigation />)

    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(screen.getByText('Profile')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.queryByText(NAV_SIGN_IN)).not.toBeInTheDocument()
    expect(screen.queryByText(NAV_TRY_ON_TESTNET)).not.toBeInTheDocument()
  })

  it('shows auth skeleton on protected routes while guest auth resolves', () => {
    mockUsePathname.mockReturnValue('/drafts')
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      signOut: vi.fn(),
    })

    const { container } = render(<AppNavigation />)

    expect(screen.queryByText(NAV_SIGN_IN)).not.toBeInTheDocument()
    expect(screen.queryByText(NAV_TRY_ON_TESTNET)).not.toBeInTheDocument()
    expect(container.querySelector('[aria-hidden]')).toBeInTheDocument()
  })

  it('shows auth skeleton in mobile menu on protected routes for guests', async () => {
    mockUsePathname.mockReturnValue('/drafts')
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      signOut: vi.fn(),
    })

    const user = userEvent.setup()
    const { container } = render(<AppNavigation />)

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))

    expect(screen.queryByText(NAV_SIGN_IN)).not.toBeInTheDocument()
    expect(screen.queryByText(NAV_TRY_ON_TESTNET)).not.toBeInTheDocument()
    expect(container.querySelector('[aria-hidden]')).toBeInTheDocument()
  })
})
