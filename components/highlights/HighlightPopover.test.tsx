/** @vitest-environment jsdom */
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/highlights/HighlightTipButton', () => ({
  HighlightTipButton: () => null,
}))

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user: null }),
}))

import { HighlightPopover } from '@/components/highlights/HighlightPopover'

describe('HighlightPopover', () => {
  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(
      <HighlightPopover
        position={{ top: 0, left: 0 }}
        onCreateHighlight={vi.fn()}
        onClose={onClose}
        selectedText="Enough text for the preview area"
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
      <HighlightPopover
        position={{ top: 0, left: 0 }}
        onCreateHighlight={vi.fn()}
        onClose={onClose}
        selectedText="Enough text for the preview area"
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
})
