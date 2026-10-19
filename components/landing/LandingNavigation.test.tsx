/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LandingNavigation } from './LandingNavigation'
import HeroSection from './HeroSection'

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
