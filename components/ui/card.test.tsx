/** @vitest-environment jsdom */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card, cardVariants } from '@/components/ui/card'

describe('Card variants', () => {
  it('default variant includes raised shadow', () => {
    const { container } = render(<Card variant="default">Content</Card>)
    expect(container.firstChild).toHaveClass('shadow-[var(--chrome-raised)]')
  })

  it('quiet variant has no shadow', () => {
    const { container } = render(<Card variant="quiet">Content</Card>)
    expect(container.firstChild).toHaveClass('shadow-[var(--chrome-quiet)]')
    expect(container.firstChild).not.toHaveClass(
      'shadow-[var(--chrome-raised)]'
    )
  })

  it('action variant has no raised shadow and compact padding', () => {
    const { container } = render(<Card variant="action">Content</Card>)
    expect(container.firstChild).toHaveClass('p-4')
    expect(container.firstChild).toHaveClass('shadow-[var(--chrome-quiet)]')
  })

  it('workspace-row variant has no shadow or full card radius', () => {
    const { container } = render(<Card variant="workspace-row">Row</Card>)
    expect(container.firstChild).toHaveClass('border-b')
    expect(container.firstChild).toHaveClass('shadow-[var(--chrome-quiet)]')
    expect(container.firstChild).toHaveClass('rounded-none')
  })

  it('cardVariants helper matches default when no variant passed', () => {
    expect(cardVariants()).toContain('shadow-[var(--chrome-raised)]')
  })
})
