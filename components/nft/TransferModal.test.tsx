/** @vitest-environment jsdom */
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { TransferModal } from '@/components/nft/TransferModal'
import type { Id } from '@/types/convex'

const mockTransfer = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({
  useMutation: () => mockTransfer,
}))

vi.mock('@/hooks/convex', () => ({
  useNFTByArticle: () => null,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const articleId = 'jd7aaaaaaaaaaaaaaaa' as Id<'articles'>
const nftId = 'jd7bbbbbbbbbbbbbbbb' as Id<'articleNFTs'>

function ControlledTransferModal() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <TransferModal
        isOpen={open}
        onClose={() => setOpen(false)}
        articleId={articleId}
        articleTitle="Test Article"
        currentOwner="seller"
        nftId={nftId}
      />
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
    </>
  )
}

describe('TransferModal', () => {
  beforeEach(() => {
    mockTransfer.mockReset()
    vi.mocked(toast.error).mockClear()
  })

  it(
    'shows a single success message in the message slot after transfer',
    async () => {
    const user = userEvent.setup({ delay: null })
    mockTransfer.mockResolvedValue('transfer_id')

    render(
      <TransferModal
        isOpen
        onClose={() => {}}
        articleId={articleId}
        articleTitle="Test Article"
        currentOwner="seller"
        nftId={nftId}
      />
    )

    await user.type(
      screen.getByLabelText(/Transfer To \(Username\)/i),
      'buyername'
    )
    await user.click(screen.getByRole('button', { name: /^Transfer NFT$/i }))

    await waitFor(() => {
      expect(screen.getByTestId('transfer-modal-message')).toHaveTextContent(
        'Transfer completed successfully!'
      )
    })
    expect(
      screen.queryByText('Transfer failed. Please try again.')
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByText('Transfer completed successfully!')
    ).toHaveLength(1)
  },
    10_000
  )

  it('shows a single error message in the message slot on mutation failure', async () => {
    const user = userEvent.setup({ delay: null })
    mockTransfer.mockRejectedValue(new Error('Recipient not found'))

    render(
      <TransferModal
        isOpen
        onClose={() => {}}
        articleId={articleId}
        articleTitle="Test Article"
        currentOwner="seller"
        nftId={nftId}
      />
    )

    await user.type(
      screen.getByLabelText(/Transfer To \(Username\)/i),
      'buyername'
    )
    await user.click(screen.getByRole('button', { name: /^Transfer NFT$/i }))

    await waitFor(() => {
      expect(screen.getByTestId('transfer-modal-message')).toHaveTextContent(
        'No account uses that username'
      )
    })
    expect(
      screen.queryByText('Transfer completed successfully!')
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByText(
        'No account uses that username. Check the spelling and try again.'
      )
    ).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledWith(
      'No account uses that username. Check the spelling and try again.'
    )
  })

  it('shows progress only in the message slot while the button stays Transfer NFT', async () => {
    const user = userEvent.setup({ delay: null })
    let resolveTransfer!: (value: string) => void
    const transferPromise = new Promise<string>((resolve) => {
      resolveTransfer = resolve
    })
    mockTransfer.mockReturnValue(transferPromise)

    render(
      <TransferModal
        isOpen
        onClose={() => {}}
        articleId={articleId}
        articleTitle="Test Article"
        currentOwner="seller"
        nftId={nftId}
      />
    )

    await user.type(
      screen.getByLabelText(/Transfer To \(Username\)/i),
      'buyername'
    )
    await user.click(screen.getByRole('button', { name: /^Transfer NFT$/i }))

    const slot = screen.getByTestId('transfer-modal-message')
    await waitFor(() => {
      expect(slot).toHaveTextContent('Processing transfer...')
    })

    const submit = screen.getByRole('button', { name: /^Transfer NFT$/i })
    expect(submit.textContent).not.toMatch(/Processing transfer/i)

    resolveTransfer!('transfer_id')
    await waitFor(() => {
      expect(slot).toHaveTextContent('Transfer completed successfully!')
    })
  })

  it('clears the message slot when the modal is closed and reopened', async () => {
    const user = userEvent.setup({ delay: null })

    render(<ControlledTransferModal />)

    await user.type(screen.getByLabelText(/Transfer To \(Username\)/i), 'ab')
    await user.click(screen.getByRole('button', { name: /^Transfer NFT$/i }))
    await waitFor(() => {
      expect(screen.getByTestId('transfer-modal-message')).toHaveTextContent(
        'Invalid username format'
      )
    })

    await user.click(screen.getByRole('button', { name: /^Cancel$/i }))
    await user.click(screen.getByRole('button', { name: /^Reopen$/i }))

    expect(
      screen.queryByText(/Invalid username format/)
    ).not.toBeInTheDocument()
  })
})
