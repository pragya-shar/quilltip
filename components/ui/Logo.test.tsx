/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Logo } from '@/components/ui/Logo'

vi.mock('next/link', () => ({
  default: (props: { href: string; children: ReactNode; 'aria-label'?: string }) => (
    <a href={props.href} aria-label={props['aria-label']}>
      {props.children}
    </a>
  ),
}))

vi.mock('motion/react', () => ({
  motion: {
    span: (props: { children: ReactNode; className?: string }) => (
      <span className={props.className}>{props.children}</span>
    ),
  },
}))

describe('Logo', () => {
  it('renders a home link with the Quilltip wordmark', () => {
    render(<Logo />)

    expect(screen.getByRole('link', { name: 'Quilltip' })).toHaveAttribute('href', '/')
    expect(screen.getByText('Quilltip')).toBeInTheDocument()
  })

  it('renders as a static div when href is null', () => {
    render(<Logo href={null} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Quilltip')).toBeInTheDocument()
  })

  it('can hide the wordmark', () => {
    render(<Logo showText={false} />)

    expect(screen.queryByText('Quilltip')).not.toBeInTheDocument()
  })
})
