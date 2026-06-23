/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/image', () => ({
  default: function MockImage({ alt, src }: { alt: string; src: string }) {
    // eslint-disable-next-line @next/next/no-img-element -- test mock for next/image
    return <img alt={alt} src={src} />
  },
}))

import { ArticleListingThumbnail } from '@/components/articles/ArticleListingThumbnail'

describe('ArticleListingThumbnail', () => {
  it('renders cover image when coverImage is provided', () => {
    render(
      <ArticleListingThumbnail
        title="Test Article"
        coverImage="https://example.com/cover.jpg"
        href="/author/slug"
        variant="feed"
      />
    )

    expect(screen.getByRole('img', { name: 'Test Article' })).toHaveAttribute(
      'src',
      'https://example.com/cover.jpg'
    )
  })

  it('renders monogram placeholder when coverImage is missing', () => {
    render(
      <ArticleListingThumbnail
        title="Hello World"
        href="/author/slug"
        variant="feed"
      />
    )

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('He')).toBeInTheDocument()
  })

  it('links to article href', () => {
    render(
      <ArticleListingThumbnail
        title="Hello World"
        href="/author/my-slug"
        variant="card"
      />
    )

    expect(screen.getByRole('link')).toHaveAttribute('href', '/author/my-slug')
  })
})
