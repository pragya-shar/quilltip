'use client'

import { Badge } from '@/components/ui/badge'
import { Sparkles, TrendingUp } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface NFTBadgeProps {
  tokenId?: string
  totalTips?: number // in dollars
  owner?: {
    id: string
    username: string
    name?: string | null
  }
  mintedAt?: Date | string
  size?: 'sm' | 'md' | 'lg'
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  showLabel?: boolean
}

type RarityTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'nft'

type CollectibleVariant =
  | 'collectible-muted'
  | 'collectible'
  | 'collectible-emphasis'
  | 'secondary'

function rarityToVariant(tier: RarityTier): CollectibleVariant {
  if (tier === 'legendary') return 'collectible-emphasis'
  if (tier === 'rare' || tier === 'epic') return 'collectible'
  if (tier === 'common' || tier === 'uncommon' || tier === 'nft') {
    return 'collectible-muted'
  }
  return 'collectible-muted'
}

function getRarityFromTips(tips?: number, rarityProp?: NFTBadgeProps['rarity']) {
  if (rarityProp) {
    const labels: Record<Exclude<NFTBadgeProps['rarity'], undefined>, string> = {
      legendary: 'Legendary',
      epic: 'Epic',
      rare: 'Rare',
      uncommon: 'Uncommon',
      common: 'Common',
    }
    return { label: labels[rarityProp], tier: rarityProp as RarityTier }
  }
  if (tips === undefined) return { label: 'NFT', tier: 'nft' as const }
  if (tips >= 100) return { label: 'Legendary', tier: 'legendary' as const }
  if (tips >= 50) return { label: 'Epic', tier: 'epic' as const }
  if (tips >= 25) return { label: 'Rare', tier: 'rare' as const }
  if (tips >= 10) return { label: 'Uncommon', tier: 'uncommon' as const }
  return { label: 'Common', tier: 'common' as const }
}

export function NFTBadge({
  tokenId,
  totalTips,
  owner,
  mintedAt,
  size = 'md',
  rarity: rarityProp,
  showLabel = false,
}: NFTBadgeProps) {
  const rarity = getRarityFromTips(totalTips, rarityProp)
  const variant = rarityToVariant(rarity.tier)

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  }

  const iconSize = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  }

  if (!tokenId && totalTips !== undefined) {
    return (
      <Badge variant="outline" className={sizeClasses[size]}>
        <TrendingUp className={`mr-1 ${iconSize[size]}`} />$
        {totalTips.toFixed(0)} in tips
      </Badge>
    )
  }

  const mintDate = mintedAt ? new Date(mintedAt).toLocaleDateString() : ''

  if (showLabel) {
    return (
      <Badge variant={variant} className={sizeClasses[size]}>
        <Sparkles className={`mr-1 ${iconSize[size]}`} />
        {rarity.label}
      </Badge>
    )
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={variant}
            className={`${sizeClasses[size]} cursor-default`}
          >
            <Sparkles className={`mr-1 ${iconSize[size]}`} />
            NFT {rarity.label !== 'NFT' ? `• ${rarity.label}` : ''}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-2">
            <div className="font-semibold">NFT Details</div>
            {tokenId && (
              <div className="text-xs space-y-1">
                <div>
                  <span className="text-muted-foreground">Token ID:</span>{' '}
                  <span className="font-mono">{tokenId.slice(0, 12)}...</span>
                </div>
                {owner && (
                  <div>
                    <span className="text-muted-foreground">Owner:</span> @
                    {owner.username}
                  </div>
                )}
                {totalTips !== undefined && (
                  <div>
                    <span className="text-muted-foreground">Value:</span> $
                    {totalTips.toFixed(2)} in tips
                  </div>
                )}
                {mintDate && (
                  <div>
                    <span className="text-muted-foreground">Minted:</span>{' '}
                    {mintDate}
                  </div>
                )}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
