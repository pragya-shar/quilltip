/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NFTIntegration } from '@/components/nft/NFTIntegration'
import type { Id } from '@/types/convex'

const mockUseNFTByArticle = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/convex', () => ({
  useNFTByArticle: (articleId: Id<'articles'> | undefined) =>
    mockUseNFTByArticle(articleId),
}))

vi.mock('./MintButton', () => ({
  MintButton: () => <div data-testid="mint-button" />,
}))

vi.mock('./TransferModal', () => ({
  TransferModal: () => <div data-testid="transfer-modal" />,
}))

const articleId = 'jd7aaaaaaaaaaaaaaaa' as Id<'articles'>
const authorId = 'jd7bbbbbbbbbbbbbbbb' as Id<'users'>
const oldOwnerId = 'jd7cccccccccccccccc' as Id<'users'>
const newOwnerId = 'jd7dddddddddddddddd' as Id<'users'>
const sharedStellarAddress =
  'GAEV4UC0WEUWGLAQW7NYYPULUA65XMVYYA670GTHL0M705E2ZINYFXPM'

function mintedNftStatus(ownerUserId: Id<'users'>) {
  return {
    _id: 'jd7eeeeeeeeeeeeeeee' as Id<'articleNFTs'>,
    isMinted: true as const,
    isEligible: true,
    totalTips: 5000,
    tipThreshold: 1000,
    owner: sharedStellarAddress,
    mintedAt: new Date().toISOString(),
    transferCount: 1,
    rarity: 'epic' as const,
    ownerInfo: {
      id: ownerUserId,
      name: 'Owner',
      username: ownerUserId === newOwnerId ? 'suraj' : 'yash0057',
      avatar: null,
      stellarAddress: sharedStellarAddress,
    },
    minterInfo: {
      id: authorId,
      name: 'Author',
      username: 'yash0057',
      avatar: null,
    },
  }
}

async function openActionsTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: /^Actions$/i }))
}

describe('NFTIntegration transfer actions', () => {
  beforeEach(() => {
    mockUseNFTByArticle.mockReset()
  })

  it('shows Transfer NFT when the signed-in user owns the NFT by user id', async () => {
    const user = userEvent.setup({ delay: null })
    mockUseNFTByArticle.mockReturnValue(mintedNftStatus(newOwnerId))

    render(
      <NFTIntegration
        articleId={articleId}
        articleTitle="Test Article"
        articleSlug="test-article"
        authorId={authorId}
        currentUserId={newOwnerId}
      />
    )

    await openActionsTab(user)

    expect(
      screen.getByRole('button', { name: /Transfer NFT/i })
    ).toBeInTheDocument()
  })

  it('hides Transfer NFT for a former owner who shares the same stellar address', async () => {
    const user = userEvent.setup({ delay: null })
    mockUseNFTByArticle.mockReturnValue(mintedNftStatus(newOwnerId))

    render(
      <NFTIntegration
        articleId={articleId}
        articleTitle="Test Article"
        articleSlug="test-article"
        authorId={authorId}
        currentUserId={oldOwnerId}
      />
    )

    await openActionsTab(user)

    expect(
      screen.queryByRole('button', { name: /Transfer NFT/i })
    ).not.toBeInTheDocument()
    expect(screen.getByText(/don.t own this NFT/i)).toBeInTheDocument()
  })
})
