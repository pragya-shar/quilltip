/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TipHistory,
  type ReceivedTipRow,
} from '@/components/dashboard/TipHistory'
import type { Id } from '@/types/convex'

function makeTip(overrides: Partial<ReceivedTipRow>): ReceivedTipRow {
  return {
    _id: 'jd7abc' as Id<'tips'>,
    _creationTime: 1,
    articleId: 'jd7art' as Id<'articles'>,
    tipperId: 'jd7tip' as Id<'users'>,
    authorId: 'jd7auth' as Id<'users'>,
    articleTitle: 'Hello',
    articleSlug: 'hello',
    amountUsd: 5,
    amountCents: 500,
    status: 'CONFIRMED',
    createdAt: new Date('2024-06-15T12:00:00Z').getTime(),
    updatedAt: new Date('2024-06-15T12:00:00Z').getTime(),
    tipper: { name: 'Alice', username: 'alice' },
    ...overrides,
  }
}

describe('TipHistory', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows empty state when tips are empty or undefined', () => {
    const { unmount, container } = render(<TipHistory tips={undefined} />)
    expect(
      screen.getByRole('heading', { name: 'Recent Tips' })
    ).toBeInTheDocument()
    expect(screen.getByText('No tips yet')).toBeInTheDocument()
    expect(container.firstChild).not.toBeNull()
    unmount()

    render(<TipHistory tips={[]} />)
    expect(
      screen.getByRole('heading', { name: 'Recent Tips' })
    ).toBeInTheDocument()
    expect(screen.getByText('No tips yet')).toBeInTheDocument()
  })

  it('shows tipper, article title, amount, and relative tip time', () => {
    const tips = [
      makeTip({
        _id: 'a1' as Id<'tips'>,
        articleTitle: 'My Article',
        amountUsd: 12.5,
        createdAt: new Date('2024-03-01T00:00:00Z').getTime(),
        tipper: { username: 'bob' },
      }),
    ]
    render(<TipHistory tips={tips} />)

    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(
      screen.getByText((_, el) => el?.textContent === 'tipped on “My Article”')
    ).toBeInTheDocument()
    expect(screen.getByText('+$12.50')).toBeInTheDocument()
  })

  it('uses Anonymous when no tipper name', () => {
    const tips = [makeTip({ tipper: null })]
    render(<TipHistory tips={tips} />)
    expect(screen.getByText('Anonymous')).toBeInTheDocument()
  })

  it('shows relative time with absolute date on title and aria-label', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-05T12:00:00Z'))
    const createdAt = new Date('2026-05-03T12:00:00Z').getTime()
    const tipDate = new Date(createdAt)
    const absolute = tipDate.toLocaleDateString('en-US', { dateStyle: 'long' })

    render(<TipHistory tips={[makeTip({ createdAt })]} />)

    const timeEl = screen.getByText('2 days ago')
    expect(timeEl.tagName).toBe('TIME')
    expect(timeEl).toHaveAttribute('dateTime', tipDate.toISOString())
    expect(timeEl).toHaveAttribute('title', absolute)
    expect(timeEl).toHaveAttribute('aria-label', `2 days ago. ${absolute}.`)
  })
})
