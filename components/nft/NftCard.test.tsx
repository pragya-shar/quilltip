/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NftCard } from '@/components/nft/NftCard'

vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
  }: {
    src: string
    alt: string
  // eslint-disable-next-line @next/next/no-img-element -- mock for next/image
  }) => <img src={src} alt={alt} />,
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>,
}))

const baseProps = {
  title: 'Test Article',
  slug: 'test-article',
  authorUsername: 'writer',
  tokenId: 'abc123def456',
  footerLabel: 'Minted by',
  footerUsername: 'minter',
}

describe('NftCard', () => {
  it('renders cover image when coverImage is set', () => {
    render(
      <NftCard
        {...baseProps}
        coverImage="https://example.com/cover.jpg"
      />
    )

    const img = screen.getByRole('img', { name: 'Test Article' })
    expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg')
  })

  it('renders fallback without img when coverImage is missing', () => {
    render(<NftCard {...baseProps} />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('No cover image')).toBeInTheDocument()
  })

  it('links to the article page', () => {
    render(<NftCard {...baseProps} />)

    const links = screen.getAllByRole('link', { name: /Test Article/i })
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute('href', '/writer/test-article')
  })

  it('shows excerpt and footer when provided', () => {
    render(
      <NftCard
        {...baseProps}
        excerpt="A short summary of the article."
      />
    )

    expect(
      screen.getByText('A short summary of the article.')
    ).toBeInTheDocument()
    expect(screen.getByText(/Minted by @minter/)).toBeInTheDocument()
    expect(screen.getByText(/Token ID: abc123de/)).toBeInTheDocument()
  })
})
