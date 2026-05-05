/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
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
    expect(screen.getByText('My Article')).toBeInTheDocument()
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

  it('toggles sort direction and shows indicator on active column', () => {
    const tips = [
      makeTip({
        _id: 'a1' as Id<'tips'>,
        amountUsd: 3,
        createdAt: new Date('2024-03-01T00:00:00Z').getTime(),
        tipper: { username: 'bob' },
      }),
      makeTip({
        _id: 'a2' as Id<'tips'>,
        amountUsd: 10,
        createdAt: new Date('2024-03-02T00:00:00Z').getTime(),
        tipper: { username: 'alice' },
      }),
    ]

    render(<TipHistory tips={tips} />)

    const amountBtn = screen.getByRole('button', { name: /amount/i })

    fireEvent.click(amountBtn)
    expect(amountBtn.textContent).toMatch(/▲|▼/)
    expect(screen.getAllByText(/\+\$/)[0]).toHaveTextContent('+$3.00')

    fireEvent.click(amountBtn)
    expect(amountBtn.textContent).toMatch(/▲|▼/)
    expect(screen.getAllByText(/\+\$/)[0]).toHaveTextContent('+$10.00')
  })

  it('downloads CSV in current sort order and escapes commas/quotes/newlines', () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => 'blob:mock' as unknown as string)
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {
        // noop
      })

    const click = vi.fn()
    const remove = vi.fn()

    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'a') return originalCreateElement(tag)
      const a = originalCreateElement('a') as HTMLAnchorElement
      vi.spyOn(a, 'click').mockImplementation(click)
      vi.spyOn(a, 'remove').mockImplementation(remove)
      return a
    }) as typeof document.createElement)

    const blobSpy = vi.spyOn(globalThis, 'Blob')

    const tips = [
      makeTip({
        _id: 'a1' as Id<'tips'>,
        articleTitle: 'Zeta',
        amountUsd: 5,
        createdAt: new Date('2024-03-01T00:00:00Z').getTime(),
        tipper: { username: 'bob, "the"\nnew' },
      }),
      makeTip({
        _id: 'a2' as Id<'tips'>,
        articleTitle: 'Alpha',
        amountUsd: 1,
        createdAt: new Date('2024-03-02T00:00:00Z').getTime(),
        tipper: { username: 'alice' },
      }),
    ]

    render(<TipHistory tips={tips} />)

    fireEvent.click(screen.getByRole('button', { name: /article/i }))
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const anchor = document.body.querySelector('a')
    if (!(anchor instanceof HTMLAnchorElement)) {
      throw new Error('Expected an anchor element to be created')
    }
    expect(anchor.getAttribute('href')).toBe('blob:mock')
    expect(anchor.download).toMatch(/^tip-history-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    expect(remove).toHaveBeenCalled()

    const blobArg = blobSpy.mock.calls[0]?.[0]
    const csvText = Array.isArray(blobArg) ? String(blobArg[0]) : ''
    expect(csvText).toContain('Tipper,Article,AmountUsd,CreatedAt')
    expect(csvText).toMatch(/\n.*Alpha,1\.00,/)
    expect(csvText).toMatch(/"bob, ""the""\nnew"/)
  })
})
