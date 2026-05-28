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
        returnPath="/author/my-article"
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
        returnPath="/author/my-article"
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
        returnPath="/author/my-article"
        onClose={onClose}
      />
    )

    screen.getByRole('button', { name: 'Not now' }).click()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('links Sign in and register with returnTo', () => {
    render(
      <HighlightSignInPrompt
        position={{ top: 0, left: 0 }}
        selectedText="Enough text for the preview area"
        returnPath="/author/my-article"
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fauthor%2Fmy-article'
    )
    expect(
      screen.getByRole('link', { name: 'Create a free account' })
    ).toHaveAttribute('href', '/register?returnTo=%2Fauthor%2Fmy-article')
  })

  it('calls onBeforeAuthNavigate when Sign in is clicked', () => {
    const onBeforeAuthNavigate = vi.fn()
    render(
      <HighlightSignInPrompt
        position={{ top: 0, left: 0 }}
        selectedText="Enough text for the preview area"
        returnPath="/author/my-article"
        onClose={vi.fn()}
        onBeforeAuthNavigate={onBeforeAuthNavigate}
      />
    )

    screen.getByRole('link', { name: 'Sign in' }).click()

    expect(onBeforeAuthNavigate).toHaveBeenCalledTimes(1)
  })

  it('exposes dialog semantics for assistive tech', () => {
    render(
      <HighlightSignInPrompt
        position={{ top: 0, left: 0 }}
        selectedText="Enough text for the preview area"
        returnPath="/author/my-article"
        onClose={vi.fn()}
      />
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby')
    expect(dialog).toHaveAttribute('aria-describedby')
  })
})
