/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { YouTubeEmbedDialog } from '@/components/editor/YouTubeEmbedDialog'

describe('YouTubeEmbedDialog', () => {
  it('shows an error when submitting an empty URL', async () => {
    const user = userEvent.setup({ delay: null })
    const onVideoEmbed = vi.fn(() => true)

    render(
      <YouTubeEmbedDialog
        isOpen
        onClose={vi.fn()}
        onVideoEmbed={onVideoEmbed}
      />
    )

    await user.click(screen.getByLabelText('YouTube URL'))
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Please enter a YouTube URL'
      )
    })
    expect(onVideoEmbed).not.toHaveBeenCalled()
  })

  it('shows an error for an invalid URL', async () => {
    const user = userEvent.setup({ delay: null })
    const onVideoEmbed = vi.fn(() => true)

    render(
      <YouTubeEmbedDialog
        isOpen
        onClose={vi.fn()}
        onVideoEmbed={onVideoEmbed}
      />
    )

    await user.type(
      screen.getByLabelText('YouTube URL'),
      'https://example.com/video'
    )
    await user.click(screen.getByRole('button', { name: 'Embed Video' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Please enter a valid YouTube URL'
      )
    })
    expect(onVideoEmbed).not.toHaveBeenCalled()
  })

  it('shows an error when embed command fails and keeps dialog open', async () => {
    const user = userEvent.setup({ delay: null })
    const onVideoEmbed = vi.fn(() => false)
    const onClose = vi.fn()

    render(
      <YouTubeEmbedDialog
        isOpen
        onClose={onClose}
        onVideoEmbed={onVideoEmbed}
      />
    )

    await user.type(
      screen.getByLabelText('YouTube URL'),
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    )
    await user.click(screen.getByRole('button', { name: 'Embed Video' }))

    await waitFor(() => {
      expect(onVideoEmbed).toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not embed this video'
      )
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('clears the error while typing', async () => {
    const user = userEvent.setup({ delay: null })

    render(
      <YouTubeEmbedDialog
        isOpen
        onClose={vi.fn()}
        onVideoEmbed={vi.fn(() => true)}
      />
    )

    const urlInput = screen.getByLabelText('YouTube URL')
    await user.click(urlInput)
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    await user.type(urlInput, 'https://')
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
