'use client'

import { useState, useRef } from 'react'
import { useNFTByArticle } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { MintButton } from './MintButton'
import { NFTBadge } from './NFTBadge'
import { TransferModal } from './TransferModal'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { NftSidebarSkeleton } from '@/components/articles/NftSidebarSkeleton'
import './nft.css'
import { ArrowRight, Trophy, TrendingUp, Users, Zap } from 'lucide-react'

interface NFTIntegrationProps {
  articleId: Id<'articles'>
  articleTitle: string
  articleSlug: string
  authorId: Id<'users'>
  currentUserId?: Id<'users'>
  embedded?: boolean
}

export function NFTIntegration({
  articleId,
  articleTitle,
  articleSlug,
  authorId,
  currentUserId,
  embedded = false,
}: NFTIntegrationProps) {
  const [showTransferModal, setShowTransferModal] = useState(false)
  const transferTriggerRef = useRef<HTMLButtonElement>(null)

  const nftStatus = useNFTByArticle(articleId)

  const isLoading = nftStatus === undefined

  const handleMintComplete = () => {
    // Convex will automatically refresh the query data
  }

  const handleTransferComplete = (_newOwner: string) => {
    // Convex will automatically refresh the query data with updated owner
  }

  const isAuthor = currentUserId === authorId
  const isOwner =
    nftStatus != null &&
    nftStatus.isMinted === true &&
    currentUserId != null &&
    nftStatus.ownerInfo?.id === currentUserId
  const canMint = isAuthor && !nftStatus?.isMinted && nftStatus?.isEligible
  const canTransfer = isOwner

  const progressPercentage = nftStatus
    ? (nftStatus.totalTips / nftStatus.tipThreshold) * 100
    : 0

  if (isLoading) return <NftSidebarSkeleton />

  if (!nftStatus) {
    return null
  }

  return (
    <div className="space-y-6">
      <section
        className={`nft-panel ${embedded ? '' : 'nft-panel-standalone'}`}
        aria-label="NFT collection"
      >
        <header className="nft-panel-header">
          <div className="nft-row">
            <div>
              <h5 className="nft-panel-title">
                NFT Status
                {nftStatus.isMinted && (
                  <NFTBadge rarity={nftStatus.rarity || 'common'} size="sm" />
                )}
              </h5>
              <p className="nft-muted">
                {nftStatus.isMinted
                  ? `Minted as NFT on ${new Date(nftStatus.mintedAt!).toLocaleDateString()}`
                  : 'Not yet minted as NFT'}
              </p>
            </div>
            {nftStatus.isMinted && (
              <Badge variant="secondary" className="nft-tag">
                #{articleId.slice(0, 8)}
              </Badge>
            )}
          </div>
        </header>
        <div>
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="nft-tabs">
              <TabsTrigger className="nft-tab" value="overview">
                Overview
              </TabsTrigger>
              <TabsTrigger className="nft-tab" value="stats">
                Stats
              </TabsTrigger>
              <TabsTrigger className="nft-tab" value="actions">
                Actions
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="nft-tab-content">
              {/* Minting Progress or Ownership Info */}
              {!nftStatus.isMinted ? (
                <div className="nft-tab-content">
                  <div>
                    <div className="nft-row mb-2 text-sm">
                      <span>Minting Progress</span>
                      <span className="font-medium">
                        ${(nftStatus.totalTips / 100).toFixed(2)} / $
                        {(nftStatus.tipThreshold / 100).toFixed(2)}
                      </span>
                    </div>
                    <div
                      className="nft-progress"
                      role="progressbar"
                      aria-label="Minting progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(progressPercentage, 100)}
                    >
                      <div
                        className="nft-progress-fill"
                        style={{
                          width: `${Math.min(progressPercentage, 100)}%`,
                        }}
                      />
                    </div>
                    <p className="nft-muted mt-2 text-xs">
                      {progressPercentage >= 100
                        ? 'Eligible for minting!'
                        : `$${((nftStatus.tipThreshold - nftStatus.totalTips) / 100).toFixed(2)} more in reader support to become eligible`}
                    </p>
                  </div>

                  {/* Eligibility Badges */}
                  <div className="flex flex-wrap gap-2">
                    {nftStatus.totalTips >= 500 && (
                      <Badge variant="outline" className="nft-tag">
                        <TrendingUp className="w-3 h-3 mr-1" />
                        Trending
                      </Badge>
                    )}
                    {nftStatus.totalTips >= 1000 && (
                      <Badge variant="outline" className="nft-tag">
                        <Zap className="w-3 h-3 mr-1" />
                        Popular
                      </Badge>
                    )}
                    {nftStatus.totalTips >= 2500 && (
                      <Badge variant="outline" className="nft-tag">
                        <Trophy className="w-3 h-3 mr-1" />
                        Viral
                      </Badge>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="nft-detail-row">
                    <span className="text-sm">Current Owner</span>
                    <span className="font-mono text-sm">
                      {nftStatus.owner?.slice(0, 6)}...
                      {nftStatus.owner?.slice(-6)}
                    </span>
                  </div>
                  <div className="nft-detail-row">
                    <span className="text-sm">Transfer History</span>
                    <span className="font-medium">
                      {nftStatus.transferCount}{' '}
                      {nftStatus.transferCount === 1 ? 'transfer' : 'transfers'}
                    </span>
                  </div>
                  <div className="nft-detail-row">
                    <span className="text-sm">Rarity</span>
                    <NFTBadge
                      rarity={nftStatus.rarity || 'common'}
                      size="sm"
                      showLabel
                    />
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="stats" className="nft-tab-content">
              <div className="nft-stats">
                <div className="space-y-2">
                  <p className="text-sm text-ui-muted-foreground">Total Tips</p>
                  <p className="nft-stat-value">
                    ${(nftStatus.totalTips / 100).toFixed(2)}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-ui-muted-foreground">Tip Count</p>
                  <p className="nft-stat-value">
                    {Math.floor(nftStatus.totalTips / 25)}
                  </p>
                </div>
              </div>

              <div className="nft-rule">
                <div className="nft-muted flex flex-wrap items-center gap-2 text-sm">
                  <Users className="w-4 h-4" />
                  <span>Community engagement score: </span>
                  <span className="font-medium text-ui-foreground">
                    {Math.min(Math.floor(progressPercentage * 1.5), 150)}/150
                  </span>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="actions" className="nft-tab-content">
              {/* Mint Button */}
              {canMint && (
                <MintButton
                  articleId={articleId}
                  articleTitle={articleTitle}
                  articleSlug={articleSlug}
                  totalTips={nftStatus.totalTips / 100} // Convert cents to dollars
                  threshold={nftStatus.tipThreshold / 100} // Convert cents to dollars
                  isAuthor={isAuthor}
                  onMintSuccess={handleMintComplete}
                />
              )}

              {/* Transfer Button */}
              {canTransfer && (
                <Button
                  ref={transferTriggerRef}
                  type="button"
                  onClick={() => setShowTransferModal(true)}
                  className="nft-button nft-button-secondary w-full"
                  variant="outline"
                >
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Transfer NFT
                </Button>
              )}

              {/* Status Messages */}
              {!canMint && !canTransfer && (
                <div className="text-center py-4">
                  {nftStatus.isMinted ? (
                    <p className="text-sm text-ui-muted-foreground">
                      You don&apos;t own this NFT. Current owner can transfer
                      it.
                    </p>
                  ) : (
                    <p className="text-sm text-ui-muted-foreground">
                      {isAuthor
                        ? `Collect $${((nftStatus.tipThreshold - nftStatus.totalTips) / 100).toFixed(2)} more in tips to mint as NFT`
                        : 'Only the author can mint this article as an NFT once eligible'}
                    </p>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </section>

      {/* Transfer Modal */}
      {nftStatus.isMinted && nftStatus.owner && (
        <TransferModal
          isOpen={showTransferModal}
          onClose={() => setShowTransferModal(false)}
          articleId={articleId}
          articleTitle={articleTitle}
          currentOwner={nftStatus.owner}
          currentOwnerUsername={nftStatus.ownerInfo?.username}
          nftId={nftStatus._id}
          onTransferComplete={handleTransferComplete}
          triggerRef={transferTriggerRef}
        />
      )}
    </div>
  )
}
