/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LandingNavigation } from './LandingNavigation'
import HeroSection from './HeroSection'

const useAuthMock = vi.fn()
vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))
beforeEach(() => useAuthMock.mockReturnValue({ isAuthenticated: false }))

describe('Prototype landing route bindings', () => {
  it('uses the prototype navigation and real reading, writing, and account routes', () => {
    render(<LandingNavigation />)
    const navigation = within(
      screen.getByRole('navigation', { name: 'Main navigation' })
    )
    for (const [name, path] of [
      ['Articles', '/articles'],
      ['Your library', '/library'],
      ['Writing desk', '/write'],
      ['Log in', '/login'],
      ['Sign up', '/register'],
    ]) {
      expect(navigation.getByRole('link', { name })).toHaveAttribute(
        'href',
        path
      )
    }
    expect(
      navigation.queryByRole('button', {
        name: /Product|Resources|Toggle menu/,
      })
    ).not.toBeInTheDocument()
  })

  it('shows account access instead of signup for signed-in readers', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true })
    render(<LandingNavigation />)
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute(
      'href',
      '/profile'
    )
    expect(
      screen.queryByRole('link', { name: 'Log in' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Sign up' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Writing desk' })).toHaveAttribute(
      'href',
      '/write'
    )
  })

  it('sends the writing CTA through the existing protected editor route', () => {
    render(<HeroSection ready={false} />)
    expect(
      screen.getByRole('link', { name: 'I’m here to write' })
    ).toHaveAttribute('href', '/write')
    expect(
      screen.getByRole('link', { name: 'I’m here to read' })
    ).toHaveAttribute('href', '/articles')
  })

  it('connects the practice invitation to its own screen with a landing return', () => {
    render(<HeroSection ready={false} />)
    expect(
      screen.getByRole('link', { name: 'Practice a transfer' })
    ).toHaveAttribute('href', '/wallet/practice?returnTo=%2F%23try-it')
  })
})
