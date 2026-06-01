/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  ArticleAuthorByline,
  canLinkAuthorProfile,
} from '@/components/articles/ArticleAuthorByline'
import type { ArticleAuthorBylineAuthor } from '@/components/articles/ArticleAuthorByline'

const linkableAuthor: ArticleAuthorBylineAuthor = {
  id: 'user-1',
  name: 'Jane Writer',
  username: 'janewriter',
  avatar: null,
}

const missingAuthor: ArticleAuthorBylineAuthor = {
  id: '',
  name: 'Former Author',
  username: 'unknown',
  avatar: null,
}

describe('canLinkAuthorProfile', () => {
  it('returns true when id and username are valid', () => {
    expect(canLinkAuthorProfile(linkableAuthor)).toBe(true)
  })

  it('returns false when username is unknown or empty', () => {
    expect(canLinkAuthorProfile(missingAuthor)).toBe(false)
    expect(canLinkAuthorProfile({ id: 'x', username: '' })).toBe(false)
    expect(canLinkAuthorProfile({ id: '', username: 'janewriter' })).toBe(false)
  })
})

describe('ArticleAuthorByline', () => {
  it('renders profile link with accessible label and href', () => {
    render(<ArticleAuthorByline author={linkableAuthor} />)

    const link = screen.getByRole('link', {
      name: "View Jane Writer's profile",
    })
    expect(link).toHaveAttribute('href', '/janewriter')
    expect(screen.getByText('Jane Writer')).toBeInTheDocument()
  })

  it('renders non-link fallback when profile is unavailable', () => {
    render(<ArticleAuthorByline author={missingAuthor} showHandle />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Former Author')).toBeInTheDocument()
    expect(screen.getByText('Author profile unavailable')).toBeInTheDocument()
    expect(screen.getByText('@unknown')).toBeInTheDocument()
  })

  it('renders metadata children outside the profile link', () => {
    render(
      <ArticleAuthorByline author={linkableAuthor}>
        <p>3 min read</p>
      </ArticleAuthorByline>
    )

    const link = screen.getByRole('link', {
      name: "View Jane Writer's profile",
    })
    expect(link).not.toHaveTextContent('3 min read')
    expect(screen.getByText('3 min read')).toBeInTheDocument()
  })
})
