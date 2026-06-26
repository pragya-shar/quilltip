/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ArticleGrid from '@/components/articles/ArticleGrid'

vi.mock('next/link', () => ({
  default: (props: { href: string; children: ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}))

describe('ArticleGrid empty states', () => {
  it('shows quoted search term and clear search button', async () => {
    const onClearSearch = vi.fn()
    render(
      <ArticleGrid
        articles={[]}
        emptyState={{
          hasSearch: true,
          hasFilters: true,
          searchTerm: 'blockchain',
          onClearSearch,
        }}
      />
    )

    expect(
      screen.getByRole('heading', { name: 'No results for "blockchain"' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Try a different term or clear your search.')
    ).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onClearSearch).toHaveBeenCalledOnce()
  })

  it('shows clear filters for filter-only empty state', async () => {
    const onClearAll = vi.fn()
    render(
      <ArticleGrid
        articles={[]}
        emptyState={{
          hasSearch: false,
          hasFilters: true,
          activeTag: 'rust',
          onClearAll,
        }}
      />
    )

    expect(
      screen.getByRole('heading', { name: 'No articles match these filters' })
    ).toBeInTheDocument()
    expect(screen.getByText(/tag "rust"/)).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClearAll).toHaveBeenCalledOnce()
  })

  it('shows browse latest for empty catalog', () => {
    render(<ArticleGrid articles={[]} />)

    expect(
      screen.getByRole('heading', { name: 'No articles yet' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse latest' })).toHaveAttribute(
      'href',
      '/articles'
    )
  })

  it('home variant uses one primary and one secondary action', () => {
    render(<ArticleGrid articles={[]} variant="home" />)

    expect(
      screen.getByRole('link', { name: 'Write your first article' })
    ).toHaveAttribute('href', '/write')
    expect(
      screen.getByRole('link', { name: 'Browse articles' })
    ).toHaveAttribute('href', '/articles')
  })
})
