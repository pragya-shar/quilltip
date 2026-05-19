'use client'

import { useState, useEffect, useRef } from 'react'
import { useAction, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Check, Loader2, Sparkles, Wallet } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useWallet } from '@/components/providers/WalletProvider'
import { useWalletActivation } from '@/components/providers/WalletActivationContext'
import { nftClient } from '@/lib/stellar/nft-client'
import { stellarClient } from '@/lib/stellar/client'
import { InstallWalletDialog } from '@/components/stellar/InstallWalletDialog'
import {
  NO_WALLET_AVAILABLE_ERROR_CODE,
  ALBEDO_INSECURE_LOCALHOST_ERROR_CODE,
} from '@/lib/stellar/wallet-adapter'
import {
  stellarFlowEmitter,
  type NftMintFlowStep,
  type StellarFlowEvent,
  nftMintFlowProgressLabel,
} from '@/lib/stellar/stellar-flow-emitter'
import { cn } from '@/lib/utils'

const NFT_MINT_UI_STEPS: readonly NftMintFlowStep[] = [
  'awaiting_signature',
  'submitting',
  'confirming',
] as const

function nftMintStepIndex(step: NftMintFlowStep): number {
  return NFT_MINT_UI_STEPS.indexOf(step)
}

function getFriendlyMintErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : ''

  if (
    message.includes('Arweave uploads are disabled') ||
    message.includes('Arweave wallet key is not configured') ||
    message.includes('Arweave wallet key is invalid')
  ) {
    return 'NFT minting is temporarily unavailable. Please try again later.'
  }

  if (message.includes('NFT metadata upload to Arweave failed')) {
    return "We couldn't prepare your NFT metadata right now. Please try again in a moment."
  }

  return message || fallback
}

interface MintButtonProps {
  articleId: string | Id<'articles'>
  articleTitle: string
  articleSlug: string
  totalTips: number // in dollars
  threshold: number // in dollars
  isAuthor: boolean
  coverImage?: string
  excerpt?: string
  onMintSuccess?: () => void
}

export function MintButton({
  articleId,
  articleTitle,
  // articleSlug, // Future use for metadata generation
  totalTips,
  threshold,
  isAuthor,
  // coverImage, // Future use for NFT metadata
  // excerpt, // Future use for NFT description
  onMintSuccess,
}: MintButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [nftMintFlowStep, setNftMintFlowStep] =
    useState<NftMintFlowStep | null>(null)
  const nftMintFlowStepRef = useRef<NftMintFlowStep | null>(null)

  const mintNFT = useMutation(api.nfts.mintNFT)
  const uploadNftMetadataForMint = useAction(
    api.nftMetadataUpload.uploadNftMetadataForMint
  )
  const wallet = useWallet()
  const { activateWallet } = useWalletActivation()
  const [xlmPrice, setXlmPrice] = useState<number | null>(null)

  useEffect(() => {
    return stellarFlowEmitter.subscribe((event: StellarFlowEvent) => {
      if (event.flow === 'nft_mint') {
        setNftMintFlowStep(event.step)
        nftMintFlowStepRef.current = event.step
      }
    })
  }, [])

  useEffect(() => {
    stellarClient.getXLMPrice().then(setXlmPrice)
  }, [])

  const canMint = totalTips >= threshold && isAuthor
  const progress = Math.min(100, (totalTips / threshold) * 100)

  const mintStepActiveIndex =
    nftMintFlowStep != null
      ? nftMintStepIndex(nftMintFlowStep)
      : isLoading
        ? 0
        : -1

  // Convert USD to stroops for contract (using real-time price)
  const tipAmountInStroops = xlmPrice
    ? Math.floor((totalTips / xlmPrice) * 10_000_000)
    : 0

  const handleConnectWallet = async () => {
    try {
      await wallet.connect()
      toast.success('Wallet connected successfully!')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to connect wallet'

      if (message.startsWith(`${NO_WALLET_AVAILABLE_ERROR_CODE}:`)) {
        setInstallDialogOpen(true)
        return
      }

      if (message.startsWith(`${ALBEDO_INSECURE_LOCALHOST_ERROR_CODE}:`)) {
        return
      }

      toast.error(message)
    }
  }

  const handleMint = async () => {
    if (!wallet.isConnected || !wallet.publicKey) {
      toast.error('Please connect your Stellar wallet first')
      return
    }

    setIsLoading(true)

    try {
      stellarFlowEmitter.emit({ flow: 'nft_mint', step: 'awaiting_signature' })

      const eligibility = await nftClient.checkEligibility(
        articleId as string,
        tipAmountInStroops
      )
      if (!eligibility.eligible) {
        throw new Error(
          eligibility.reason || 'Article not eligible for minting'
        )
      }

      const { metadataUrl } = await uploadNftMetadataForMint({
        articleId: articleId as Id<'articles'>,
        xlmPrice: xlmPrice!,
      })

      const { xdr } = await nftClient.buildMintTransaction(wallet.publicKey, {
        authorAddress: wallet.publicKey,
        articleId: articleId as string,
        tipAmount: tipAmountInStroops,
        metadataUrl,
      })

      const signedXDR = await wallet.signTransaction(xdr)

      const result = await nftClient.submitMintTransaction(signedXDR)

      if (!result.success) {
        throw new Error(result.error || 'Blockchain transaction failed')
      }

      const nftId = await mintNFT({
        articleId: articleId as Id<'articles'>,
        tipThreshold: threshold,
        metadataUrl,
      })

      if (nftId) {
        toast.success('NFT minted successfully!')
        setDialogOpen(false)
        onMintSuccess?.()
      } else {
        // Blockchain succeeded but database failed - this is a consistency issue
        console.warn('Blockchain mint succeeded but database update failed')
        toast.warning(
          'NFT minted on blockchain but database sync failed. Please refresh the page.'
        )
      }
    } catch (error) {
      console.error('Minting error:', error)

      const step = nftMintFlowStepRef.current
      let fallback = 'Failed to mint NFT'
      if (step === 'awaiting_signature' || step === null) {
        fallback = 'Transaction cancelled or wallet error'
      } else if (step === 'submitting' || step === 'confirming') {
        fallback = 'Blockchain transaction failed. Please try again'
      }

      toast.error(getFriendlyMintErrorMessage(error, fallback))
    } finally {
      setNftMintFlowStep(null)
      nftMintFlowStepRef.current = null
      setIsLoading(false)
    }
  }

  if (!isAuthor) {
    return null
  }

  if (totalTips < threshold) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">NFT Minting Progress</span>
          <span className="font-medium">
            ${totalTips.toFixed(2)} / ${threshold.toFixed(2)}
          </span>
        </div>
        <div className="w-full bg-secondary rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          ${(threshold - totalTips).toFixed(2)} more to mint NFT
        </p>
      </div>
    )
  }

  return (
    <>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (open) activateWallet()
          setDialogOpen(open)
        }}
      >
        <DialogTrigger asChild>
          <Button
            disabled={!canMint}
            className="w-full"
            variant="default"
            type="button"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Mint NFT
          </Button>
        </DialogTrigger>
        <DialogContent
          onEscapeKeyDown={(e) => {
            if (isLoading) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (isLoading) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>Mint Article as NFT</DialogTitle>
            <DialogDescription>
              Convert your article into a unique NFT on the Stellar blockchain
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!wallet.isConnected && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm text-amber-900">
                  Connect your wallet to mint this article as an NFT.
                </p>
              </div>
            )}
            <div className="bg-secondary p-4 rounded-lg space-y-2">
              <h4 className="font-medium">{articleTitle}</h4>
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Tips:</span>
                  <span className="font-medium">${totalTips.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Threshold Met:</span>
                  <span className="font-medium text-green-800 dark:text-green-300">
                    ✓ Yes
                  </span>
                </div>
                {wallet.isConnected && wallet.publicKey ? (
                  <div className="bg-green-50 border border-green-200 rounded p-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-green-900 font-medium">
                        ✓ Wallet Connected
                      </span>
                      <span className="font-mono text-green-700">
                        {`${wallet.publicKey.slice(0, 4)}...${wallet.publicKey.slice(-4)}`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded p-2">
                    <span className="text-xs text-amber-900">
                      Wallet not connected
                    </span>
                  </div>
                )}
              </div>
            </div>

            {isLoading && (
              <div
                className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/30"
                aria-busy="true"
                aria-live="polite"
              >
                <p className="mb-3 text-sm font-medium text-foreground">
                  Mint in progress
                </p>
                <ol className="flex w-full items-start gap-2 sm:gap-3">
                  {NFT_MINT_UI_STEPS.map((stepKey, i) => {
                    const activeIdx =
                      mintStepActiveIndex >= 0 ? mintStepActiveIndex : 0
                    const isComplete = i < activeIdx
                    const isCurrent = i === activeIdx
                    return (
                      <li
                        key={stepKey}
                        className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
                      >
                        <div
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors',
                            isComplete &&
                              'border-green-600 bg-green-100 text-green-800 dark:border-green-500 dark:bg-green-950/50 dark:text-green-300',
                            isCurrent &&
                              !isComplete &&
                              'border-primary bg-primary/10 text-primary',
                            !isComplete &&
                              !isCurrent &&
                              'border-muted-foreground/30 bg-muted/50 text-muted-foreground'
                          )}
                          aria-current={isCurrent ? 'step' : undefined}
                        >
                          {isComplete ? (
                            <Check
                              className="h-4 w-4"
                              strokeWidth={2.5}
                              aria-hidden
                            />
                          ) : isCurrent ? (
                            <Loader2
                              className="h-4 w-4 animate-spin"
                              aria-hidden
                            />
                          ) : (
                            <span>{i + 1}</span>
                          )}
                        </div>
                        <span
                          className={cn(
                            'text-center text-[10px] font-medium leading-tight sm:text-xs',
                            isCurrent && 'text-foreground',
                            isComplete && 'text-green-800 dark:text-green-300',
                            !isCurrent && !isComplete && 'text-muted-foreground'
                          )}
                        >
                          {nftMintFlowProgressLabel(stepKey)}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              </div>
            )}

            <div className="space-y-2 text-sm text-muted-foreground">
              <p>By minting this NFT:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>
                  You&apos;ll create a unique token representing ownership
                </li>
                <li>The NFT can be transferred or traded</li>
                <li>You&apos;ll retain authorship attribution</li>
                <li>This action cannot be undone</li>
              </ul>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                type="button"
                onClick={() => setDialogOpen(false)}
                disabled={isLoading}
                className="flex-1"
              >
                Cancel
              </Button>

              {!wallet.isConnected ? (
                <Button
                  onClick={handleConnectWallet}
                  disabled={isLoading}
                  className="flex-1"
                >
                  <Wallet className="mr-2 h-4 w-4" />
                  Connect Wallet
                </Button>
              ) : (
                <Button
                  onClick={handleMint}
                  disabled={isLoading}
                  className="flex-1"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {nftMintFlowStep
                        ? nftMintFlowProgressLabel(nftMintFlowStep)
                        : 'Minting'}
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Mint NFT
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <InstallWalletDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
      />
    </>
  )
}
