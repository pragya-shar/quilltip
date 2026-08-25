/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ActionableNotice } from '@/components/ui/ActionableNotice'

describe('ActionableNotice', () => {
  it('renders informational content as muted paragraph', () => {
    render(
      <ActionableNotice intent="informational">
        Testnet uses practice funds only.
      </ActionableNotice>
    )
    const note = screen.getByText('Testnet uses practice funds only.')
    expect(note.tagName).toBe('P')
    expect(note).toHaveClass('text-muted-foreground')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders actionable content as alert', () => {
    render(
      <ActionableNotice intent="actionable" title="Connect wallet">
        Connect your wallet to send tips.
      </ActionableNotice>
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Connect wallet')).toBeInTheDocument()
    expect(
      screen.getByText('Connect your wallet to send tips.')
    ).toBeInTheDocument()
  })
})
