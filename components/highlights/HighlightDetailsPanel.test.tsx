/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
}))

vi.mock('@/hooks/convex', () => ({
  useHighlightTipsByHighlight: () => [],
}))

vi.mock('@/components/highlights/HighlightTipButton', () => ({
  HighlightTipButton: () => null,
}))

vi.mock('motion/react', () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.ComponentProps<'div'> & {
      initial?: unknown
      animate?: unknown
      exit?: unknown
      transition?: unknown
    }) => <div {...props}>{children}</div>,
  },
}))

import { HighlightDetailsPanel } from '@/components/highlights/HighlightDetailsPanel'
import type { Id } from '@/types/convex'

const baseHighlight = {
  _id: 'highlight1' as Id<'highlights'>,
  text: 'Sample highlighted passage for testing the panel.',
  startOffset: 0,
  endOffset: 10,
  startContainerPath: '0',
  endContainerPath: '0',
  highlightId: 'hl-1',
  color: '#F59E0B',
  isPublic: true,
  userId: 'user1' as Id<'users'>,
  userName: 'Test User',
  createdAt: Date.now(),
}

describe('HighlightDetailsPanel', () => {
  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(
      <HighlightDetailsPanel
        highlight={baseHighlight}
        position={{ top: 100, left: 200 }}
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
      <HighlightDetailsPanel
        highlight={baseHighlight}
        position={{ top: 100, left: 200 }}
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

  it('renders a labeled close button for keyboard dismiss', () => {
    render(
      <HighlightDetailsPanel
        highlight={baseHighlight}
        position={{ top: 100, left: 200 }}
        onClose={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Close highlight details' })
    ).toBeInTheDocument()
  })
})
