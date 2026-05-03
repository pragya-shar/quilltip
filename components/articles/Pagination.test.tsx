/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Pagination from '@/components/articles/Pagination'

vi.mock('next/link', () => {
  return {
    default: (props: { href: string; children: ReactNode }) => (
      <a href={props.href}>{props.children}</a>
    ),
  }
})

describe('Pagination getPageHref', () => {
  it('uses getPageHref for links when basePath is omitted', () => {
    const getPageHref = (page: number) => `/u?nftOwnedPage=${page}`
    render(
      <Pagination currentPage={2} totalPages={5} getPageHref={getPageHref} />
    )

    const next = screen.getByRole('link', { name: 'Next' })
    expect(next).toHaveAttribute('href', '/u?nftOwnedPage=3')
  })
})
