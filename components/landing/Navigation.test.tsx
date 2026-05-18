/** @vitest-environment jsdom */
import type { HTMLAttributes, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import Navigation from '@/components/landing/Navigation'

vi.mock('next/link', () => ({
  default: (props: { href: string; children: ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}))

vi.mock('motion/react', () => ({
  motion: {
    nav: (props: HTMLAttributes<HTMLElement>) => <nav {...props} />,
    div: (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  },
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/theme/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}))

describe('Navigation mobile menu', () => {
  beforeEach(() => {
    document.body.style.pointerEvents = ''
  })

  it('closes the mobile sheet when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(<Navigation />)

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
