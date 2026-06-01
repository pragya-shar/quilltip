/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LandingHashLink } from '@/components/landing/LandingHashLink'

const scrollToLandingSection = vi.fn()

vi.mock('@/lib/landing/scroll-to-section', () => ({
  handleLandingHashClick: (
    e: { preventDefault: () => void },
    href: string
  ) => {
    e.preventDefault()
    scrollToLandingSection(href)
    return true
  },
}))

vi.mock('next/link', () => ({
  default: (props: {
    href: string
    children: React.ReactNode
    onClick?: (e: { preventDefault: () => void }) => void
  }) => (
    <a href={props.href} onClick={props.onClick}>
      {props.children}
    </a>
  ),
}))

describe('LandingHashLink', () => {
  it('scrolls in-page for hash hrefs', async () => {
    const user = userEvent.setup()
    scrollToLandingSection.mockClear()

    render(
      <LandingHashLink href="#faq">FAQ</LandingHashLink>
    )

    await user.click(screen.getByRole('link', { name: 'FAQ' }))
    expect(scrollToLandingSection).toHaveBeenCalledWith('#faq')
  })
})
