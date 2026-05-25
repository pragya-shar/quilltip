/** @vitest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { AuthorNotFoundPage } from '@/components/profile/AuthorNotFoundPage'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/badhandle',
}))

vi.mock('@/components/layout/AppNavigation', () => ({
  default: () => <nav data-testid="app-nav" />,
}))

vi.mock('@/components/layout/SiteFooter', () => ({
  SiteFooter: () => <footer data-testid="site-footer" />,
}))

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, signOut: vi.fn() }),
}))

describe('AuthorNotFoundPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    push.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders profile unavailable heading and username', () => {
    render(<AuthorNotFoundPage username="badhandle" />)

    expect(screen.getByText('Profile unavailable')).toBeInTheDocument()
    expect(screen.getByText('@badhandle')).toBeInTheDocument()
    expect(
      screen.getByText(/No writer profile exists for/i)
    ).toBeInTheDocument()
  })

  it('renders search input with accessible label', () => {
    render(<AuthorNotFoundPage username="badhandle" />)

    expect(screen.getByLabelText('Search for articles')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Search articles and writers...')
    ).toBeInTheDocument()
  })

  it('links Browse articles to /articles and Go home to /', () => {
    render(<AuthorNotFoundPage username="badhandle" />)

    expect(
      screen.getByRole('link', { name: 'Browse articles' })
    ).toHaveAttribute('href', '/articles')
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute(
      'href',
      '/'
    )
  })

  it('navigates to articles search after debounced input', () => {
    render(<AuthorNotFoundPage username="badhandle" />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: 'stellar' } })
    act(() => vi.advanceTimersByTime(300))

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/articles?search=stellar&page=1')
  })

  it('does not navigate when search is empty or whitespace', () => {
    render(<AuthorNotFoundPage username="badhandle" />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: '   ' } })
    act(() => vi.advanceTimersByTime(300))

    expect(push).not.toHaveBeenCalled()
  })
})
