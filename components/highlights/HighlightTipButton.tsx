'use client'

import { useState, useEffect } from 'react'
import { useConvex, useMutation } from 'convex/react'
import { useAuth } from '@/components/providers/AuthContext'
import { useWallet } from '@/components/providers/WalletProvider'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Coins, Heart, Loader2, Wallet } from 'lucide-react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'
import { stellarClient } from '@/lib/stellar/client'
import {
  stellarFlowEmitter,
  type StellarFlowEvent,
  type TipFlowStep,
  tipFlowProgressLabel,
} from '@/lib/stellar/stellar-flow-emitter'
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
import { InstallWalletDialog } from '@/components/stellar/InstallWalletDialog'
import {
  NO_WALLET_AVAILABLE_ERROR_CODE,
  ALBEDO_INSECURE_LOCALHOST_ERROR_CODE,
} from '@/lib/stellar/wallet-adapter'

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
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [tipFlowStep, setTipFlowStep] = useState<TipFlowStep | null>(null)

  const convex = useConvex()
  const createHighlightTip = useMutation(api.highlightTips.create)

  useEffect(() => {
    return stellarFlowEmitter.subscribe((event: StellarFlowEvent) => {
      if (event.flow === 'tip') {
        setTipFlowStep(event.step)
      }
    })
  }, [])

  const handleOpenChange = (open: boolean) => {
    if (!open && isLoading) return
    setIsOpen(open)
    if (!open) {
      setSelectedAmount(null)
      setCustomAmount('')
    }
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

    // Pre-flight cooldown check: avoids building a Stellar transaction that
    // the server would ultimately reject, which would otherwise leave an
    // on-chain payment with no matching DB record. This is an optimization;
    // the createHighlightTip mutation still enforces the cooldown server-side,
    // so any network hiccup here falls through silently to the real gate.
    try {
      const cooldown = await convex.query(api.tips.canTip, {})
      if (!cooldown.allowed) {
        toast.error('Slow down', {
          description: `Please wait ${cooldown.waitSec}s before tipping again.`,
        })
        return
      }
    } catch (err) {
      // Fall through: the server-side cooldown check will catch it if needed.
      // Logging so the failure is visible in monitoring even though we don't
      // surface it to the user.
      console.error('[HighlightTipButton] canTip pre-flight failed', err)
    }

    setIsLoading(true)

    try {
      stellarFlowEmitter.emit({ flow: 'tip', step: 'awaiting_signature' })
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
      setTipFlowStep(null)
      setIsLoading(false)
    }
  }

  const handleConnectWallet = async () => {
    try {
      await connect()
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

  const displayText =
    highlightText.length > 60
      ? highlightText.slice(0, 60) + '...'
      : highlightText

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <button
            type="button"
            className={`focus-ring inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-lg hover:from-yellow-500 hover:to-orange-600 transition-all transform hover:scale-105 shadow-md text-sm ${className}`}
            title="Tip this highlight"
          >
            <Coins className="w-3.5 h-3.5" />
            <span className="font-medium">Tip Highlight</span>
          </button>
        </DialogTrigger>
        <DialogContent
          className="max-w-md max-h-[min(90dvh,calc(100%-2rem))] overflow-y-auto"
          onEscapeKeyDown={(e) => {
            if (isLoading) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (isLoading) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>Tip Highlight</DialogTitle>
            <DialogDescription className="sr-only">
              Choose an amount to tip this highlight on the Stellar network.
            </DialogDescription>
          </DialogHeader>

          <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-sm text-foreground italic">
              &ldquo;{displayText}&rdquo;
            </p>
          </div>

          <p className="text-muted-foreground mb-4 text-sm">
            Tip {authorName} for this specific insight. 97.5% goes directly to
            the author!
          </p>

          {!isConnected && (
            <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-900 dark:text-amber-100">
              <p>Connect your Stellar wallet to tip this highlight.</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mb-4">
            {TIP_PRESETS_HIGHLIGHT.map((amount) => (
              <button
                key={amount.cents}
                type="button"
                onClick={() => {
                  setSelectedAmount(amount.cents)
                  setCustomAmount('')
                }}
                className={`focus-ring relative px-4 py-3 rounded-lg border-2 transition-all ${
                  selectedAmount === amount.cents
                    ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30'
                    : 'border-border hover:border-orange-300'
                }`}
              >
                {amount.popular && (
                  <span className="absolute -top-2 left-1/2 transform -translate-x-1/2 px-2 py-0.5 bg-orange-500 text-white text-xs rounded-full">
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
              className="block text-sm font-medium text-foreground mb-2"
            >
              Or enter custom amount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
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
                className="focus-ring w-full pl-8 pr-4 py-2 border border-input bg-background text-foreground rounded-lg"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Minimum: ${TIP_MIN_USD.toFixed(2)} • Maximum: $
              {TIP_MAX_USD.toFixed(2)}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
              className="focus-ring flex-1 px-4 py-2 border border-input bg-background text-foreground rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>

            {!isConnected ? (
              <button
                type="button"
                onClick={handleConnectWallet}
                disabled={isLoading}
                className="focus-ring flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Wallet className="w-4 h-4" />
                <span>Connect Wallet</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleTip()}
                disabled={isLoading || (!selectedAmount && !customAmount)}
                className="focus-ring flex-1 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-lg hover:from-yellow-500 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>
                      {tipFlowStep
                        ? tipFlowProgressLabel(tipFlowStep)
                        : 'Awaiting signature'}
                    </span>
                  </>
                ) : (
                  <>
                    <Heart className="w-4 h-4" />
                    <span>Send Tip</span>
                  </>
                )}
              </button>
            )}
          </div>

          {isConnected && publicKey && (
            <div className="text-xs text-green-600 text-center mt-4">
              <p className="flex items-center justify-center gap-1">
                <Wallet className="w-3 h-3" />
                Connected: {publicKey.slice(0, 6)}...{publicKey.slice(-6)}
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center mt-2">
            Powered by Stellar • Instant settlement • Low fees
          </p>
        </DialogContent>
      </Dialog>

      <InstallWalletDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
      />
    </>
  )
}
