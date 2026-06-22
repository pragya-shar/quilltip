/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TagFilterLink } from './TagFilterLink'

const useSearchParams = vi.fn()

vi.mock('next/navigation', () => ({
  useSearchParams: () => useSearchParams(),
}))

function hrefParams(href: string) {
  const qs = href.split('?')[1] ?? ''
  return new URLSearchParams(qs)
}

describe('TagFilterLink', () => {
  beforeEach(() => {
    useSearchParams.mockReset()
  })

  it('strips profile-only params from the articles browse href', () => {
    useSearchParams.mockReturnValue(
      new URLSearchParams('page=2&nftOwnedPage=3&nftMintedPage=1')
    )
    render(<TagFilterLink tag="rust">rust</TagFilterLink>)
    const href = screen
      .getByRole('link', { name: 'Filter by tag rust' })
      .getAttribute('href')
    expect(href).toBeTruthy()
    const params = hrefParams(href!)
    expect(params.get('tag')).toBe('rust')
    expect(params.has('page')).toBe(false)
    expect(params.has('nftOwnedPage')).toBe(false)
    expect(params.has('nftMintedPage')).toBe(false)
  })

  it('includes author when the prop is provided', () => {
    useSearchParams.mockReturnValue(
      new URLSearchParams('page=2&nftOwnedPage=3')
    )
    render(
      <TagFilterLink tag="rust" author="alice">
        rust
      </TagFilterLink>
    )
    const params = hrefParams(
      screen
        .getByRole('link', { name: 'Filter by tag rust' })
        .getAttribute('href')!
    )
    expect(params.get('author')).toBe('alice')
    expect(params.get('tag')).toBe('rust')
  })

  it('preserves search from the current articles browse URL', () => {
    useSearchParams.mockReturnValue(
      new URLSearchParams('search=stellar&tag=old&page=3')
    )
    render(<TagFilterLink tag="rust">rust</TagFilterLink>)
    const params = hrefParams(
      screen
        .getByRole('link', { name: 'Filter by tag rust' })
        .getAttribute('href')!
    )
    expect(params.get('search')).toBe('stellar')
    expect(params.get('tag')).toBe('rust')
    expect(params.has('page')).toBe(false)
  })
})
