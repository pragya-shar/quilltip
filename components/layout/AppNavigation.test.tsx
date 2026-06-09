/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import AppNavigation from '@/components/layout/AppNavigation'

vi.mock('next/link', () => ({
  default: (props: { href: string; children: ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    signOut: vi.fn(),
  }),
}))

vi.mock('@/components/theme/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}))

describe('AppNavigation mobile menu', () => {
  beforeEach(() => {
    document.body.style.pointerEvents = ''
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
  })

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
