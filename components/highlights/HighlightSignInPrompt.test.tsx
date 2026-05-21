/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { HighlightSignInPrompt } from '@/components/highlights/HighlightSignInPrompt'

describe('HighlightSignInPrompt', () => {
  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(
      <HighlightSignInPrompt
        position={{ top: 0, left: 0 }}
        selectedText="Enough text for the preview area"
        onClose={onClose}
      />
    )

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    )

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('removes the Escape listener on unmount', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <HighlightSignInPrompt
        position={{ top: 0, left: 0 }}
        selectedText="Enough text for the preview area"
        onClose={onClose}
      />
    )

    unmount()

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    )

    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when Not now is clicked', () => {
    const onClose = vi.fn()
    render(
      <HighlightSignInPrompt
        position={{ top: 0, left: 0 }}
        selectedText="Enough text for the preview area"
        onClose={onClose}
      />
    )

    screen.getByRole('button', { name: 'Not now' }).click()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('links Sign in to /login and register to /register', () => {
    render(
      <HighlightSignInPrompt
        position={{ top: 0, left: 0 }}
        selectedText="Enough text for the preview area"
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login'
    )
    expect(
      screen.getByRole('link', { name: 'Create a free account' })
    ).toHaveAttribute('href', '/register')
  })

  it('exposes dialog semantics for assistive tech', () => {
    render(
      <HighlightSignInPrompt
        position={{ top: 0, left: 0 }}
        selectedText="Enough text for the preview area"
        onClose={vi.fn()}
      />
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby')
    expect(dialog).toHaveAttribute('aria-describedby')
  })
})
