'use client'

import { useState } from 'react'
import { useMutation } from 'convex/react'
import { useAuth } from '@/components/providers/AuthContext'
import { useWallet } from '@/components/providers/WalletProvider'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Coins, Heart, Loader2, Wallet } from 'lucide-react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'
import { stellarClient } from '@/lib/stellar/client'
import {
  generateHighlightId,
  formatTipAmount,
} from '@/lib/stellar/highlight-utils'
import {
  TIP_PRESETS_HIGHLIGHT,
  TIP_MIN_CENTS,
  TIP_MAX_CENTS,
  TIP_MIN_USD,
  TIP_MAX_USD,
} from '@/lib/constants'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface HighlightTipButtonProps {
  articleId: Id<'articles'>
  articleSlug: string
  authorName: string
  authorStellarAddress?: string | null
  highlightText: string
  startOffset: number
  endOffset: number
  startContainerPath?: string
  endContainerPath?: string
  className?: string
  onSuccess?: () => void
}

export function HighlightTipButton({
  articleId,
  articleSlug,
  authorName,
  authorStellarAddress,
  highlightText,
  startOffset,
  endOffset,
  startContainerPath,
  endContainerPath,
  className = '',
  onSuccess,
}: HighlightTipButtonProps) {
  const { isAuthenticated } = useAuth()
  const { isConnected, publicKey, signTransaction, connect } = useWallet()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const createHighlightTip = useMutation(api.highlightTips.create)

  const handleOpenChange = (open: boolean) => {
    if (!open && isLoading) return
    setIsOpen(open)
  }

  const handleTip = async () => {
    if (!isAuthenticated) {
      toast.error('Please sign in to send tips')
      router.push('/login')
      return
    }

    if (!isConnected || !publicKey) {
      toast.error('Please connect your Stellar wallet to send tips')
      return
    }

    if (!authorStellarAddress) {
      toast.error('Author has not set up their Stellar wallet yet')
      return
    }

    const amountCents = selectedAmount || parseFloat(customAmount) * 100

    if (!amountCents || amountCents < TIP_MIN_CENTS) {
      toast.error('Please select or enter a valid amount')
      return
    }

    if (amountCents > TIP_MAX_CENTS) {
      toast.error(`Maximum tip amount is $${TIP_MAX_USD.toFixed(0)}`)
      return
    }

    setIsLoading(true)

    try {
      const highlightId = await generateHighlightId(
        articleSlug,
        highlightText,
        startOffset,
        endOffset
      )

      const transactionData = await stellarClient.buildHighlightTipTransaction(
        publicKey,
        {
          highlightId,
          articleId: articleId.toString(),
          authorAddress: authorStellarAddress,
          amountCents,
        }
      )

      const signedXDR = await signTransaction(transactionData.xdr)

      const receipt = await stellarClient.submitTipTransaction(signedXDR)

      await createHighlightTip({
        highlightId,
        articleId,
        highlightText,
        startOffset,
        endOffset,
        startContainerPath,
        endContainerPath,
        amountCents,
        stellarTxId: receipt.transactionHash ?? '',
        stellarMemo: highlightId,
        stellarNetwork: 'TESTNET',
        stellarLedger: undefined,
        stellarFeeCharged: undefined,
        stellarSourceAccount: publicKey,
        stellarDestinationAccount: authorStellarAddress,
        stellarAmountXlm: (transactionData.stroops / 10_000_000).toString(),
        contractTipId: receipt.tipId,
        platformFee: transactionData.platformFee,
        authorShare: transactionData.authorReceived,
      })

      setIsOpen(false)
      setSelectedAmount(null)
      setCustomAmount('')

      toast.success(
        `Successfully tipped ${authorName} ${formatTipAmount(amountCents)} for this highlight!`,
        {
          description: receipt.transactionHash
            ? `Transaction: ${receipt.transactionHash.slice(0, 8)}...`
            : undefined,
          action: receipt.transactionHash
            ? {
                label: 'View',
                onClick: () =>
                  window.open(
                    `https://stellar.expert/explorer/testnet/tx/${receipt.transactionHash}`,
                    '_blank'
                  ),
              }
            : undefined,
        }
      )

      if (onSuccess) {
        onSuccess()
      }
    } catch (error) {
      console.error('Highlight tip error:', error)

      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send tip'

      if (
        errorMessage.includes('User declined') ||
        errorMessage.includes('rejected')
      ) {
        toast.error('Transaction cancelled by user')
      } else {
        toast.error('Transaction failed', {
          description: errorMessage,
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const displayText =
    highlightText.length > 60
      ? highlightText.slice(0, 60) + '...'
      : highlightText

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`inline-flex transform items-center gap-2 rounded-lg bg-gradient-to-r from-yellow-400 to-orange-500 px-3 py-1.5 text-sm font-medium text-white shadow-md transition-all hover:from-yellow-500 hover:to-orange-600 hover:scale-105 ${className}`}
          title="Tip this highlight"
        >
          <Coins className="h-3.5 w-3.5" />
          <span className="font-medium">Tip Highlight</span>
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90vh] max-w-md overflow-y-auto"
        onInteractOutside={(e) => {
          if (isLoading) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (isLoading) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Tip Highlight</DialogTitle>
          <DialogDescription className="sr-only">
            Send a tip to {authorName} for this highlighted passage.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-900 dark:bg-yellow-950/30">
          <p className="text-sm italic text-foreground">
            &ldquo;{displayText}&rdquo;
          </p>
        </div>

        <p className="mb-4 text-muted-foreground">
          Tip {authorName} for this specific insight. 97.5% goes directly to the
          author!
        </p>

        {!isConnected && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <p>Connect your Stellar wallet to tip this highlight.</p>
          </div>
        )}

        <div className="mb-4 grid grid-cols-3 gap-3">
          {TIP_PRESETS_HIGHLIGHT.map((amount) => (
            <button
              key={amount.cents}
              type="button"
              onClick={() => {
                setSelectedAmount(amount.cents)
                setCustomAmount('')
              }}
              className={`relative rounded-lg border-2 px-4 py-3 transition-all ${
                selectedAmount === amount.cents
                  ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40'
                  : 'border-border hover:border-orange-300'
              }`}
            >
              {amount.popular && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 transform rounded-full bg-orange-500 px-2 py-0.5 text-xs text-white">
                  Popular
                </span>
              )}
              <span className="font-semibold">{amount.label}</span>
            </button>
          ))}
        </div>

        <div className="mb-6">
          <label
            htmlFor="highlight-tip-custom-amount"
            className="mb-2 block text-sm font-medium text-foreground"
          >
            Or enter custom amount
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 transform text-muted-foreground">
              $
            </span>
            <input
              id="highlight-tip-custom-amount"
              type="number"
              min={TIP_MIN_USD}
              max={TIP_MAX_USD}
              step="0.01"
              value={customAmount}
              onChange={(e) => {
                setCustomAmount(e.target.value)
                setSelectedAmount(null)
              }}
              placeholder="0.00"
              className="w-full rounded-lg border border-input bg-background py-2 pl-8 pr-4 text-foreground focus:border-transparent focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Minimum: ${TIP_MIN_USD.toFixed(2)} Maximum: ${TIP_MAX_USD.toFixed(2)}
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            disabled={isLoading}
            className="flex-1 rounded-lg border border-input bg-background px-4 py-2 text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>

          {!isConnected ? (
            <button
              type="button"
              onClick={async () => {
                try {
                  await connect()
                  toast.success('Wallet connected successfully!')
                } catch {
                  toast.error('Failed to connect wallet')
                }
              }}
              disabled={isLoading}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 text-white hover:from-blue-600 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Wallet className="h-4 w-4" />
              <span>Connect Wallet</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleTip()}
              disabled={isLoading || (!selectedAmount && !customAmount)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-yellow-400 to-orange-500 px-4 py-2 text-white hover:from-yellow-500 hover:to-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Heart className="h-4 w-4" />
                  <span>Send Tip</span>
                </>
              )}
            </button>
          )}
        </div>

        {isConnected && publicKey && (
          <div className="mt-4 text-center text-xs text-green-600 dark:text-green-500">
            <p className="flex items-center justify-center gap-1">
              <Wallet className="h-3 w-3" />
              Connected: {publicKey.slice(0, 6)}...{publicKey.slice(-6)}
            </p>
          </div>
        )}

        <p className="mt-2 text-center text-xs text-muted-foreground">
          Powered by Stellar &middot; Instant settlement &middot; Low fees
        </p>
      </DialogContent>
    </Dialog>
  )
}
