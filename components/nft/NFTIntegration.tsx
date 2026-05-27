'use client'

import { useState, useRef } from 'react'
import { useNFTByArticle } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { MintButton } from './MintButton'
import { NFTBadge } from './NFTBadge'
import { TransferModal } from './TransferModal'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowRight, Trophy, TrendingUp, Users, Zap } from 'lucide-react'

interface NFTIntegrationProps {
  articleId: Id<'articles'>
  articleTitle: string
  articleSlug: string
  authorId: Id<'users'>
  currentUserId?: Id<'users'>
  currentUserAddress?: string | null
}

export function NFTIntegration({
  articleId,
  articleTitle,
  articleSlug,
  authorId,
  currentUserId,
  currentUserAddress,
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

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!nftStatus) {
    return null
  }

  return (
    <div className="space-y-6">
      {/* NFT Status Card */}
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                NFT Status
                {nftStatus.isMinted && (
                  <NFTBadge rarity={nftStatus.rarity || 'common'} size="sm" />
                )}
              </CardTitle>
              <CardDescription>
                {nftStatus.isMinted
                  ? `Minted as NFT on ${new Date(nftStatus.mintedAt!).toLocaleDateString()}`
                  : 'Not yet minted as NFT'}
              </CardDescription>
            </div>
            {nftStatus.isMinted && (
              <Badge variant="secondary" className="ml-auto">
                #{articleId.slice(0, 8)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="stats">Stats</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              {/* Minting Progress or Ownership Info */}
              {!nftStatus.isMinted ? (
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-2 text-foreground">
                      <span>Minting Progress</span>
                      <span className="font-medium">
                        ${(nftStatus.totalTips / 100).toFixed(2)} / $
                        {(nftStatus.tipThreshold / 100).toFixed(2)}
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(progressPercentage, 100)}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {progressPercentage >= 100
                        ? 'Eligible for minting!'
                        : `${(100 - progressPercentage).toFixed(0)}% more tips needed to unlock NFT minting`}
                    </p>
                  </div>

                  {/* Eligibility Badges */}
                  <div className="flex gap-2">
                    {nftStatus.totalTips >= 500 && (
                      <Badge variant="outline">
                        <TrendingUp className="w-3 h-3 mr-1" />
                        Trending
                      </Badge>
                    )}
                    {nftStatus.totalTips >= 1000 && (
                      <Badge variant="outline">
                        <Zap className="w-3 h-3 mr-1" />
                        Popular
                      </Badge>
                    )}
                    {nftStatus.totalTips >= 2500 && (
                      <Badge variant="outline">
                        <Trophy className="w-3 h-3 mr-1" />
                        Viral
                      </Badge>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <span className="text-sm">Current Owner</span>
                    <span className="font-mono text-sm">
                      {nftStatus.owner?.slice(0, 6)}...
                      {nftStatus.owner?.slice(-6)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <span className="text-sm">Transfer History</span>
                    <span className="font-medium">
                      {nftStatus.transferCount}{' '}
                      {nftStatus.transferCount === 1 ? 'transfer' : 'transfers'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
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

            <TabsContent value="stats" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Total Tips</p>
                  <p className="text-2xl font-bold">
                    ${(nftStatus.totalTips / 100).toFixed(2)}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Tip Count</p>
                  <p className="text-2xl font-bold">
                    {Math.floor(nftStatus.totalTips / 25)}
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="w-4 h-4" />
                  <span>Community engagement score: </span>
                  <span className="font-medium text-foreground">
                    {Math.min(Math.floor(progressPercentage * 1.5), 150)}/150
                  </span>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="actions" className="space-y-4">
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
                  className="w-full"
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
                    <p className="text-sm text-muted-foreground">
                      You don&apos;t own this NFT. Current owner can transfer
                      it.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {isAuthor
                        ? `Collect ${((nftStatus.tipThreshold - nftStatus.totalTips) / 100).toFixed(2)} more in tips to mint as NFT`
                        : 'Only the author can mint this article as an NFT once eligible'}
                    </p>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

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
