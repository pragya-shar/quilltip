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
import './nft.css'

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
  const [isPreparing, setIsPreparing] = useState(false)
  const [mintError, setMintError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const connectButtonRef = useRef<HTMLButtonElement>(null)
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

    setMintError(null)
    setIsPreparing(true)
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

      setIsPreparing(false)
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

      const message = getFriendlyMintErrorMessage(error, fallback)
      setMintError(message)
      toast.error(message)
    } finally {
      setNftMintFlowStep(null)
      nftMintFlowStepRef.current = null
      setIsPreparing(false)
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
          <span className="text-ui-muted-foreground">NFT Minting Progress</span>
          <span className="font-medium">
            ${totalTips.toFixed(2)} / ${threshold.toFixed(2)}
          </span>
        </div>
        <div
          className="nft-progress"
          role="progressbar"
          aria-label="Minting progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className="nft-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-ui-muted-foreground">
          ${(threshold - totalTips).toFixed(2)} more in support to become
          eligible
        </p>
      </div>
    )
  }

  return (
    <>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (isLoading) return
          if (open) {
            setMintError(null)
            activateWallet()
          }
          setDialogOpen(open)
        }}
      >
        <DialogTrigger asChild>
          <Button
            disabled={!canMint}
            className="nft-button w-full"
            variant="default"
            type="button"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Mint NFT
          </Button>
        </DialogTrigger>
        <DialogContent
          className="nft-dialog"
          hideCloseButton={isLoading}
          onEscapeKeyDown={(e) => {
            if (isLoading) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (isLoading) e.preventDefault()
          }}
        >
          <DialogHeader className="nft-dialog-header">
            <DialogTitle className="nft-dialog-title">
              Mint Article as NFT
            </DialogTitle>
            <DialogDescription className="nft-dialog-description">
              Create a unique NFT for your article on Stellar testnet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!wallet.isConnected && (
              <div className="nft-notice nft-notice-warning">
                <p className="text-sm">
                  Connect your wallet to mint this article as an NFT.
                </p>
              </div>
            )}
            <div className="nft-summary space-y-2">
              <h4 className="nft-article-title">{articleTitle}</h4>
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-ui-muted-foreground">Total Tips:</span>
                  <span className="font-medium">${totalTips.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ui-muted-foreground">
                    Threshold Met:
                  </span>
                  <span className="font-medium text-ui-success-foreground">
                    ✓ Yes
                  </span>
                </div>
                {wallet.isConnected && wallet.publicKey ? (
                  <div className="nft-notice nft-notice-success">
                    <div className="flex w-full flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-ui-success-foreground font-medium">
                        ✓ Wallet Connected
                      </span>
                      <span className="font-mono text-ui-success-foreground">
                        {`${wallet.publicKey.slice(0, 4)}...${wallet.publicKey.slice(-4)}`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="nft-notice nft-notice-warning">
                    <span className="text-xs text-ui-warning-foreground">
                      Wallet not connected
                    </span>
                  </div>
                )}
              </div>
            </div>

            {mintError && (
              <p className="nft-notice nft-notice-error" role="alert">
                {mintError}
              </p>
            )}
            {isLoading && (
              <div className="nft-summary" aria-busy="true" aria-live="polite">
                <p className="mb-4 font-semibold">
                  {isPreparing ? 'Preparing your NFT' : 'Mint in progress'}
                </p>
                {isPreparing ? (
                  <p className="nft-muted">
                    Checking eligibility and preparing permanent metadata before
                    wallet approval.
                  </p>
                ) : (
                  <ol className="nft-steps">
                    {NFT_MINT_UI_STEPS.map((stepKey, i) => {
                      const activeIdx = Math.max(mintStepActiveIndex, 0)
                      const isComplete = i < activeIdx
                      const isCurrent = i === activeIdx
                      return (
                        <li
                          key={stepKey}
                          className="nft-step"
                          data-current={isCurrent}
                          data-complete={isComplete}
                          aria-current={isCurrent ? 'step' : undefined}
                        >
                          <span className="nft-step-marker" aria-hidden>
                            {isComplete ? (
                              <Check className="h-4 w-4" />
                            ) : isCurrent ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              i + 1
                            )}
                          </span>
                          <span>{nftMintFlowProgressLabel(stepKey)}</span>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </div>
            )}

            <div className="space-y-2 text-sm text-ui-muted-foreground">
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

            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <Button
                variant="outline"
                type="button"
                onClick={() => setDialogOpen(false)}
                disabled={isLoading}
                className="nft-button nft-button-secondary flex-1"
              >
                Cancel
              </Button>

              {!wallet.isConnected ? (
                <Button
                  ref={connectButtonRef}
                  onClick={handleConnectWallet}
                  disabled={isLoading}
                  className="nft-button flex-1"
                >
                  <Wallet className="mr-2 h-4 w-4" />
                  Connect Wallet
                </Button>
              ) : (
                <Button
                  onClick={handleMint}
                  disabled={isLoading}
                  className="nft-button flex-1"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {isPreparing
                        ? 'Preparing NFT'
                        : nftMintFlowStep
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
        returnFocusRef={connectButtonRef}
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
      />
    </>
  )
}
