/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ShareButtons from '@/components/articles/ShareButtons'

describe('ShareButtons', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    vi.spyOn(window, 'open').mockReturnValue(null)
  })

  it('clears copied feedback when a share popup is blocked', async () => {
    const user = userEvent.setup({ delay: null })
    render(
      <ShareButtons
        title="Readable article"
        url="https://example.com/article"
        excerpt="A readable article"
      />
    )

    await user.click(screen.getByRole('button', { name: /copy link/i }))
    expect(screen.getByText('Copied!')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /share on twitter/i }))

    expect(
      screen.getByText('Popup blocked. Share using these links instead.')
    ).toBeInTheDocument()
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument()
  })
})
