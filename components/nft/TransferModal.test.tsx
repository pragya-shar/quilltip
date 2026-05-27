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
        currentOwnerUsername="seller"
        nftId={nftId}
      />
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
    </>
  )
}

async function reviewAndConfirmTransfer(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.type(
    screen.getByLabelText(/Transfer To \(Username\)/i),
    'buyername'
  )
  await user.click(screen.getByRole('button', { name: /^Review transfer$/i }))
  await screen.findByTestId('transfer-confirm-recipient')
  await user.click(screen.getByRole('button', { name: /^Confirm transfer$/i }))
}

describe('TransferModal', () => {
  beforeEach(() => {
    mockTransfer.mockReset()
    vi.mocked(toast.error).mockClear()
  })

  it('blocks transfer to the current owner on review', async () => {
    const user = userEvent.setup({ delay: null })

    render(
      <TransferModal
        isOpen
        onClose={() => {}}
        articleId={articleId}
        articleTitle="Test Article"
        currentOwner="GAEV4UC0WEUWGLAQW7NYYPULUA65XMVYYA670GTHL0M705E2ZINYFXPM"
        currentOwnerUsername="seller"
        nftId={nftId}
      />
    )

    await user.type(
      screen.getByLabelText(/Transfer To \(Username\)/i),
      'seller'
    )
    await user.click(screen.getByRole('button', { name: /^Review transfer$/i }))

    expect(screen.getByTestId('transfer-modal-message')).toHaveTextContent(
      'Cannot transfer to the current owner'
    )
    expect(
      screen.queryByRole('button', { name: /^Confirm transfer$/i })
    ).not.toBeInTheDocument()
    expect(mockTransfer).not.toHaveBeenCalled()
  })

  it('does not call transferNFT when only reviewing', async () => {
    const user = userEvent.setup({ delay: null })

    render(
      <TransferModal
        isOpen
        onClose={() => {}}
        articleId={articleId}
        articleTitle="Test Article"
        currentOwner="seller"
        currentOwnerUsername="seller"
        nftId={nftId}
      />
    )

    await user.type(
      screen.getByLabelText(/Transfer To \(Username\)/i),
      'buyername'
    )
    await user.click(screen.getByRole('button', { name: /^Review transfer$/i }))

    expect(screen.getByTestId('transfer-confirm-recipient')).toHaveTextContent(
      '@buyername'
    )
    expect(mockTransfer).not.toHaveBeenCalled()
  })

  it('shows recipient and asset details on the confirmation step', async () => {
    const user = userEvent.setup({ delay: null })

    render(
      <TransferModal
        isOpen
        onClose={() => {}}
        articleId={articleId}
        articleTitle="Test Article"
        currentOwner="seller"
        currentOwnerUsername="seller"
        nftId={nftId}
      />
    )

    await user.type(
      screen.getByLabelText(/Transfer To \(Username\)/i),
      'buyername'
    )
    await user.click(screen.getByRole('button', { name: /^Review transfer$/i }))

    expect(screen.getByTestId('transfer-confirm-recipient')).toHaveTextContent(
      '@buyername'
    )
    expect(screen.getByTestId('transfer-confirm-asset')).toHaveTextContent(
      'Test Article'
    )
    expect(
      screen.getByTestId('transfer-confirm-current-owner')
    ).toHaveTextContent('@seller')
    expect(screen.getByTestId('transfer-confirm-nft-id')).toHaveTextContent(
      nftId
    )
    expect(screen.getByTestId('transfer-confirm-warning')).toHaveTextContent(
      'Test Article'
    )
    expect(screen.getByTestId('transfer-confirm-warning')).toHaveTextContent(
      '@buyername'
    )
    expect(screen.getByTestId('transfer-confirm-warning')).toHaveTextContent(
      'cannot be undone'
    )
  })

  it('does not transfer when cancel is clicked on the confirmation step', async () => {
    const user = userEvent.setup({ delay: null })

    render(
      <TransferModal
        isOpen
        onClose={() => {}}
        articleId={articleId}
        articleTitle="Test Article"
        currentOwner="seller"
        currentOwnerUsername="seller"
        nftId={nftId}
      />
    )

    await user.type(
      screen.getByLabelText(/Transfer To \(Username\)/i),
      'buyername'
    )
    await user.click(screen.getByRole('button', { name: /^Review transfer$/i }))
    await user.click(screen.getByRole('button', { name: /^Cancel$/i }))

    expect(mockTransfer).not.toHaveBeenCalled()
  })

  it('does not transfer when back is clicked on the confirmation step', async () => {
    const user = userEvent.setup({ delay: null })

    render(
      <TransferModal
        isOpen
        onClose={() => {}}
        articleId={articleId}
        articleTitle="Test Article"
        currentOwner="seller"
        currentOwnerUsername="seller"
        nftId={nftId}
      />
    )

    await user.type(
      screen.getByLabelText(/Transfer To \(Username\)/i),
      'buyername'
    )
    await user.click(screen.getByRole('button', { name: /^Review transfer$/i }))
    await user.click(screen.getByRole('button', { name: /^Back$/i }))

    expect(mockTransfer).not.toHaveBeenCalled()
    expect(
      screen.getByLabelText(/Transfer To \(Username\)/i)
    ).toBeInTheDocument()
  })

  it('shows a single success message in the message slot after transfer', async () => {
    const user = userEvent.setup({ delay: null })
    mockTransfer.mockResolvedValue('transfer_id')

    render(
      <TransferModal
        isOpen
        onClose={() => {}}
        articleId={articleId}
        articleTitle="Test Article"
        currentOwner="seller"
        currentOwnerUsername="seller"
        nftId={nftId}
      />
    )

    await reviewAndConfirmTransfer(user)

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
  }, 10_000)

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
        currentOwnerUsername="seller"
        nftId={nftId}
      />
    )

    await reviewAndConfirmTransfer(user)

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

  it('shows progress only in the message slot while the button stays Confirm transfer', async () => {
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
        currentOwnerUsername="seller"
        nftId={nftId}
      />
    )

    await reviewAndConfirmTransfer(user)

    const slot = screen.getByTestId('transfer-modal-message')
    await waitFor(() => {
      expect(slot).toHaveTextContent('Processing transfer...')
    })

    const submit = screen.getByRole('button', { name: /^Confirm transfer$/i })
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
    await user.click(screen.getByRole('button', { name: /^Review transfer$/i }))
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
