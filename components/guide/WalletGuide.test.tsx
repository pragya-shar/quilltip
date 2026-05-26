/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WalletGuide } from '@/components/guide/WalletGuide'

vi.mock('next/link', () => {
  return {
    default: (props: { href: string; children: ReactNode }) => (
      <a href={props.href}>{props.children}</a>
    ),
  }
})

vi.mock('@/components/stellar/WalletConnectButton', () => {
  return {
    WalletConnectButton: () => <button type="button">Mock connect</button>,
  }
})

describe('WalletGuide tabs', () => {
  it('labels the tab list for screen readers', () => {
    render(<WalletGuide />)
    expect(screen.getByLabelText('Wallet setup steps')).toBeInTheDocument()
  })

  it('renders all tab labels in full', () => {
    render(<WalletGuide />)
    expect(
      screen.getByRole('tab', { name: 'What is a Wallet?' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'Set Up Freighter' })
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Connect' })).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'Your First Tip' })
    ).toBeInTheDocument()
  })

  it('uses a 2×2 grid on mobile and a single row on larger screens', () => {
    render(<WalletGuide />)
    const list = screen.getByLabelText('Wallet setup steps')
    expect(list.className).toContain('grid-cols-2')
    expect(list.className).toContain('sm:grid-cols-4')
  })

  it('allows tab labels to wrap', () => {
    render(<WalletGuide />)
    const trigger = screen.getByRole('tab', { name: 'What is a Wallet?' })
    expect(trigger.className).toContain('whitespace-normal')
  })
})

