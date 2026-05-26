'use client'

import { useState, useEffect } from 'react'
import { useConvex, useMutation } from 'convex/react'
import { useAuth } from '@/components/providers/AuthContext'
import { useWallet } from '@/components/providers/WalletProvider'
import { useWalletActivation } from '@/components/providers/WalletActivationContext'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertCircle, Coins, Heart, Loader2, Wallet } from 'lucide-react'
import { WalletTooltip } from '@/components/guide/WalletTooltip'
import Link from 'next/link'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'
import { stellarClient } from '@/lib/stellar/client'
import {
  stellarFlowEmitter,
  type TipFlowStep,
  tipFlowProgressLabel,
} from '@/lib/stellar/stellar-flow-emitter'
import {
  calculateTipBreakdown,
  formatTipAmount,
} from '@/lib/stellar/highlight-utils'
import { TipBreakdownSummaryLine } from '@/components/tipping/TipBreakdownSummaryLine'
import { TipUsdXlmRateLine } from '@/components/tipping/TipUsdXlmRateLine'
import { useTipDialogXlmUsdRate } from '@/hooks/useTipDialogXlmUsdRate'
import {
  TIP_PRESETS_ARTICLE,
  TIP_MIN_CENTS,
  TIP_MIN_USD,
  TIP_MAX_CENTS,
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
import {
  formatTipFailureMessage,
  type TipFailureMessage,
} from '@/lib/stellar/tip-error-messages'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface TipButtonProps {
  articleId: Id<'articles'>
  authorName: string
  authorStellarAddress?: string | null
  className?: string
}

export function TipButton({
  articleId,
  authorName,
  authorStellarAddress,
  className = '',
}: TipButtonProps) {
  const { isAuthenticated } = useAuth()
  const {
    isConnected,
    isLoading: isWalletLoading,
    publicKey,
    signTransaction,
    connect,
  } = useWallet()
  const { activateWallet } = useWalletActivation()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [tipFlowStep, setTipFlowStep] = useState<TipFlowStep | null>(null)
  const [tipFailure, setTipFailure] = useState<TipFailureMessage | null>(null)
  const [tipMessage, setTipMessage] = useState('')

  const convex = useConvex()
  const sendTip = useMutation(api.tips.sendTip)
  const { priceUsd: displayXlmUsdRate } = useTipDialogXlmUsdRate(isOpen)

  useEffect(() => {
    return stellarFlowEmitter.subscribe((event) => {
      if (event.flow === 'tip') {
        setTipFlowStep(event.step)
      }
    })
  }, [])

  const handleOpenChange = (open: boolean) => {
    if (!open && isLoading) return
    if (open) {
      activateWallet()
    }
    setIsOpen(open)
    setTipFailure(null)
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

    const amountCents = selectedAmount || parseFloat(customAmount) * 100

    if (!amountCents || amountCents < TIP_MIN_CENTS) {
      toast.error('Please select or enter a valid amount')
      return
    }

    if (amountCents > TIP_MAX_CENTS) {
      toast.error(`Maximum tip amount is $${TIP_MAX_USD.toFixed(2)}`)
      return
    }

    if (!authorStellarAddress) {
      toast.error(
        'Author has not set up their Stellar wallet for receiving tips'
      )
      return
    }

    if (tipMessage.length > 500) {
      toast.error('Message must be 500 characters or less')
      return
    }

    // Pre-flight cooldown check: avoids building a Stellar transaction that
    // the server would ultimately reject, which would otherwise leave an
    // on-chain payment with no matching DB record. This is an optimization;
    // the sendTip mutation still enforces the cooldown server-side, so any
    // network hiccup here falls through silently to the real gate below.
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
      console.error('[TipButton] canTip pre-flight failed', err)
    }

    setTipFailure(null)
    setIsLoading(true)

    try {
      stellarFlowEmitter.emit({ flow: 'tip', step: 'awaiting_signature' })
      const transactionData = await stellarClient.buildTipTransaction(
        publicKey,
        {
          tipper: publicKey,
          articleId: articleId.toString(),
          authorAddress: authorStellarAddress,
          amountCents,
        }
      )

      const signedXDR = await signTransaction(transactionData.xdr)
      const receipt = await stellarClient.submitTipTransaction(signedXDR)

      await sendTip({
        articleId,
        amountUsd: amountCents / 100,
        message: tipMessage.trim() ? tipMessage.trim() : undefined,
        stellarTxId: receipt.transactionHash ?? '',
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

      setTipFailure(null)
      setIsOpen(false)
      setSelectedAmount(null)
      setCustomAmount('')
      setTipMessage('')

      toast.success(
        `Successfully tipped ${authorName} $${(amountCents / 100).toFixed(2)} via Stellar!`,
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
    } catch (error) {
      console.error('Stellar tip error:', error)
      setTipFailure(formatTipFailureMessage(error))
    } finally {
      setIsLoading(false)
      setTipFlowStep(null)
    }
  }

  const previewCents = selectedAmount || parseFloat(customAmount) * 100
  const tipBreakdownPreview =
    Number.isFinite(previewCents) && previewCents > 0
      ? calculateTipBreakdown(previewCents)
      : null

  const handleConnectWallet = async () => {
    try {
      const connected = await connect()
      if (connected) {
        toast.success('Wallet connected successfully!')
      }
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

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <button
            type="button"
            className={`focus-ring inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-lg hover:from-yellow-500 hover:to-orange-600 transition-all transform hover:scale-105 shadow-lg ${className}`}
          >
            <Coins className="w-4 h-4" />
            <span className="font-medium">Tip Author</span>
          </button>
        </DialogTrigger>
        <DialogContent
          className="top-auto bottom-0 left-1/2 max-h-[min(90dvh,calc(100%-2rem))] max-w-md translate-x-[-50%] translate-y-0 gap-4 overflow-y-auto rounded-b-none rounded-t-xl border border-border bg-popover p-6 shadow-xl data-[state=closed]:slide-out-to-bottom-[48%] data-[state=open]:slide-in-from-bottom-[48%] sm:top-[50%] sm:bottom-auto sm:max-h-[min(90dvh,100%)] sm:translate-y-[-50%] sm:rounded-xl sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%] sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]"
          onInteractOutside={(e) => {
            if (isLoading) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (isLoading) e.preventDefault()
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle className="text-xl font-bold">
              Support {authorName}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Show your appreciation with a micro-tip. 97.5% goes directly to
              the author!
            </DialogDescription>
          </DialogHeader>

          {tipFailure && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{tipFailure.title}</AlertTitle>
              {tipFailure.detail ? (
                <AlertDescription>{tipFailure.detail}</AlertDescription>
              ) : null}
            </Alert>
          )}

          {!isConnected && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-900 dark:text-amber-100">
              <p>Connect your Stellar wallet to send tips to {authorName}.</p>
              <p className="mt-1">
                New to crypto?{' '}
                <Link
                  href="/guide"
                  className="focus-ring rounded text-amber-700 dark:text-amber-300 underline font-medium hover:text-amber-900 dark:hover:text-amber-100"
                >
                  Follow our setup guide
                </Link>
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {TIP_PRESETS_ARTICLE.map((amount) => (
              <button
                key={amount.cents}
                type="button"
                onClick={() => {
                  setSelectedAmount(amount.cents)
                  setCustomAmount('')
                }}
                disabled={isLoading}
                className={`focus-ring relative flex min-h-12 items-center justify-center px-4 py-3 rounded-lg border-2 transition-all disabled:opacity-50 ${
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

          <div>
            <label
              htmlFor="tip-custom-amount"
              className="block text-sm font-medium text-foreground mb-2"
            >
              Or enter custom amount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <input
                id="tip-custom-amount"
                type="number"
                min={TIP_MIN_USD}
                max={TIP_MAX_USD}
                step="0.01"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value)
                  setSelectedAmount(null)
                }}
                disabled={isLoading}
                placeholder="0.00"
                className="focus-ring w-full pl-8 pr-4 py-2 border border-input bg-background text-foreground rounded-lg disabled:opacity-50"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Minimum: ${TIP_MIN_USD.toFixed(2)} • Maximum: $
              {TIP_MAX_USD.toFixed(2)}
            </p>
            <TipUsdXlmRateLine priceUsd={displayXlmUsdRate} />
          </div>

          <div>
            <label
              htmlFor="tip-optional-message"
              className="block text-sm font-medium text-foreground mb-2"
            >
              Message to author (optional)
            </label>
            <textarea
              id="tip-optional-message"
              value={tipMessage}
              onChange={(e) => setTipMessage(e.target.value)}
              disabled={isLoading}
              maxLength={500}
              rows={3}
              placeholder="Say thanks or leave context for your tip..."
              className="focus-ring w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {tipMessage.length}/500 characters
            </p>
          </div>

          {tipBreakdownPreview && (
            <TipBreakdownSummaryLine
              totalFormatted={formatTipAmount(previewCents)}
              authorFormatted={tipBreakdownPreview.authorShareFormatted}
              platformFeeFormatted={tipBreakdownPreview.platformFeeFormatted}
            />
          )}

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
                disabled={isLoading || isWalletLoading}
                className="focus-ring flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isWalletLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting</span>
                  </>
                ) : (
                  <>
                    <Wallet className="w-4 h-4" />
                    <span>Connect Wallet</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleTip}
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
                    <span>{tipFailure ? 'Retry' : 'Send Tip'}</span>
                  </>
                )}
              </button>
            )}
          </div>

          {isConnected && publicKey && (
            <div className="text-xs text-green-800 dark:text-green-300 text-center">
              <p className="flex items-center justify-center gap-1">
                <Wallet className="w-3 h-3" />
                Connected: {publicKey.slice(0, 6)}...{publicKey.slice(-6)}
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1 flex-wrap">
            Powered by Stellar testnet <WalletTooltip concept="stellar" />{' '}
            <WalletTooltip concept="testnet" /> • Fast testnet settlement • Low
            fees
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
