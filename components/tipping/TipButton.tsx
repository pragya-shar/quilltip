'use client'

import { useState, useEffect, useCallback } from 'react'
import { useConvex, useMutation } from 'convex/react'
import { useAuth } from '@/components/providers/AuthContext'
import { useWallet } from '@/components/providers/WalletProvider'
import { useWalletActivation } from '@/components/providers/WalletActivationContext'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertCircle, Coins, Heart, Loader2, Wallet } from 'lucide-react'
import { WalletTooltip } from '@/components/guide/WalletTooltip'
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
import { TIP_PRESETS_ARTICLE, TIP_MIN_USD, TIP_MAX_USD } from '@/lib/constants'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { InstallWalletDialog } from '@/components/stellar/InstallWalletDialog'
import { ContextualWalletSetup } from '@/components/stellar/ContextualWalletSetup'
import {
  NO_WALLET_AVAILABLE_ERROR_CODE,
  ALBEDO_INSECURE_LOCALHOST_ERROR_CODE,
} from '@/lib/stellar/wallet-adapter'
import {
  formatTipFailureMessage,
  type TipFailureMessage,
} from '@/lib/stellar/tip-error-messages'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { signInToTip, validateTipAmountForm } from '@/lib/tip/signInToTip'
import { applyPendingAmountFields } from '@/lib/tip/applyPendingTipFormState'
import { clearPendingTipIntent } from '@/lib/tip/pendingTipIntent'
import type { ArticlePendingTipIntent } from '@/lib/tip/pendingTipIntent'
import { useArticleTipResume } from '@/hooks/useArticleTipResume'
import { useSuspendDialogModalForWallet } from '@/hooks/useSuspendDialogModalForWallet'
import {
  networkLabelLowercase,
  tipFlowShortNote,
} from '@/lib/copy/network-status'

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
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [tipFlowStep, setTipFlowStep] = useState<TipFlowStep | null>(null)
  const [tipFailure, setTipFailure] = useState<TipFailureMessage | null>(null)
  const [tipFormError, setTipFormError] = useState<TipFailureMessage | null>(
    null
  )
  const [tipSuccess, setTipSuccess] = useState<string | null>(null)
  const [tipMessage, setTipMessage] = useState('')

  const convex = useConvex()
  const sendTip = useMutation(api.tips.sendTip)
  const { priceUsd: displayXlmUsdRate } = useTipDialogXlmUsdRate(isOpen)
  const suspendDialogModalForWallet = useSuspendDialogModalForWallet()

  useEffect(() => {
    return stellarFlowEmitter.subscribe((event) => {
      if (event.flow === 'tip') {
        setTipFlowStep(event.step)
      }
    })
  }, [])

  const applyResumeIntent = useCallback(
    (intent: ArticlePendingTipIntent) => {
      applyPendingAmountFields(intent, setSelectedAmount, setCustomAmount)
      if (intent.message) setTipMessage(intent.message)
      activateWallet()
      setIsOpen(true)
      requestAnimationFrame(() => setIsOpen(true))
    },
    [activateWallet]
  )

  useArticleTipResume({
    articleId,
    isOpen,
    onResume: applyResumeIntent,
  })

  const handleOpenChange = (open: boolean) => {
    if (!open && (isLoading || suspendDialogModalForWallet)) return
    if (open && isAuthenticated) {
      activateWallet()
    }
    setIsOpen(open)
    setTipFailure(null)
    setTipFormError(null)
    if (!open) setTipSuccess(null)
  }

  const handleSignInToTip = () => {
    signInToTip(
      router,
      pathname,
      {
        selectedAmount,
        customAmount,
        message: tipMessage,
      },
      {
        kind: 'article',
        articleId: articleId,
        ...(selectedAmount != null ? { amountCents: selectedAmount } : {}),
        ...(customAmount ? { customAmount } : {}),
        ...(tipMessage.trim() ? { message: tipMessage.trim() } : {}),
      }
    )
  }

  const handleTip = async () => {
    const validation = validateTipAmountForm({
      selectedAmount,
      customAmount,
      message: tipMessage,
    })
    if (!validation.ok) {
      setTipFormError({ title: validation.message })
      toast.error(validation.message)
      return
    }
    const amountCents = validation.amountCents

    if (!isConnected || !publicKey) {
      const message = 'Please connect your Stellar wallet to send tips'
      setTipFormError({ title: message })
      toast.error(message)
      return
    }

    if (!authorStellarAddress) {
      const message =
        'Author has not set up their Stellar wallet for receiving tips'
      setTipFormError({ title: message })
      toast.error(message)
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
        const detail = `Please wait ${cooldown.waitSec}s before tipping again.`
        setTipFormError({ title: 'Slow down', detail })
        toast.error('Slow down', { description: detail })
        return
      }
    } catch (err) {
      // Fall through: the server-side cooldown check will catch it if needed.
      // Logging so the failure is visible in monitoring even though we don't
      // surface it to the user.
      console.error('[TipButton] canTip pre-flight failed', err)
    }

    setTipFailure(null)
    setTipFormError(null)
    setTipSuccess(null)
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

      clearPendingTipIntent()
      setTipFailure(null)
      setTipFormError(null)
      const successMessage = `Successfully tipped ${authorName} $${(amountCents / 100).toFixed(2)} via Stellar!`
      setTipSuccess(successMessage)

      toast.success(successMessage, {
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
      })

      window.setTimeout(() => {
        setIsOpen(false)
        setTipSuccess(null)
        setSelectedAmount(null)
        setCustomAmount('')
        setTipMessage('')
      }, 3000)
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
        setTipFormError(null)
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

      setTipFormError({ title: message })
      toast.error(message)
    }
  }

  const inlineTipAlert = tipSuccess ? (
    <Alert className="border-success/50 bg-success/10 text-success-foreground">
      <AlertTitle>Tip sent</AlertTitle>
      <AlertDescription>{tipSuccess}</AlertDescription>
    </Alert>
  ) : tipFailure ? (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{tipFailure.title}</AlertTitle>
      {tipFailure.detail ? (
        <AlertDescription>{tipFailure.detail}</AlertDescription>
      ) : null}
    </Alert>
  ) : tipFormError ? (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{tipFormError.title}</AlertTitle>
      {tipFormError.detail ? (
        <AlertDescription>{tipFormError.detail}</AlertDescription>
      ) : null}
    </Alert>
  ) : null

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={handleOpenChange}
        modal={!suspendDialogModalForWallet}
      >
        <DialogTrigger asChild>
          <Button variant="outline" className={cn('gap-2', className)}>
            <Coins className="w-4 h-4" />
            Tip Author
          </Button>
        </DialogTrigger>
        <DialogContent
          className="top-auto bottom-0 left-1/2 max-h-[min(90dvh,calc(100%-2rem))] max-w-md translate-x-[-50%] translate-y-0 gap-4 overflow-y-auto rounded-b-none rounded-t-xl border border-border bg-popover p-6 shadow-xl data-[state=closed]:slide-out-to-bottom-[48%] data-[state=open]:slide-in-from-bottom-[48%] sm:top-[50%] sm:bottom-auto sm:max-h-[min(90dvh,100%)] sm:translate-y-[-50%] sm:rounded-xl sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%] sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]"
          onInteractOutside={(e) => {
            if (isLoading || suspendDialogModalForWallet) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (isLoading || suspendDialogModalForWallet) e.preventDefault()
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

          {inlineTipAlert}

          {!isAuthenticated ? (
            <div className="p-3 bg-muted border border-border rounded-lg text-sm text-muted-foreground">
              <p>Sign in to send a tip to {authorName}.</p>
              <p className="mt-1">
                You can connect your Stellar wallet after signing in.
              </p>
            </div>
          ) : !isConnected ? (
            <ContextualWalletSetup
              mode="send"
              recipientLabel={authorName}
              onConnected={() => setTipFormError(null)}
            />
          ) : null}

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
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
              className="flex-1"
            >
              Cancel
            </Button>

            {!isAuthenticated ? (
              <Button
                type="button"
                onClick={handleSignInToTip}
                disabled={isLoading || (!selectedAmount && !customAmount)}
                className="flex-1 gap-2"
              >
                <Heart className="w-4 h-4" />
                Sign in to tip
              </Button>
            ) : !isConnected ? (
              <Button
                type="button"
                onClick={handleConnectWallet}
                disabled={isLoading || isWalletLoading}
                className="flex-1 gap-2"
              >
                {isWalletLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connecting
                  </>
                ) : (
                  <>
                    <Wallet className="w-4 h-4" />
                    Connect Wallet
                  </>
                )}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleTip}
                disabled={
                  isLoading ||
                  !!tipSuccess ||
                  (!selectedAmount && !customAmount)
                }
                className="flex-1 gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {tipFlowStep
                      ? tipFlowProgressLabel(tipFlowStep)
                      : 'Awaiting signature'}
                  </>
                ) : (
                  <>
                    <Heart className="w-4 h-4" />
                    {tipFailure ? 'Retry' : 'Send Tip'}
                  </>
                )}
              </Button>
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
            Powered by Stellar {networkLabelLowercase()}{' '}
            <WalletTooltip concept="stellar" />{' '}
            {networkLabelLowercase() === 'testnet' ? (
              <WalletTooltip concept="testnet" />
            ) : null}{' '}
            • {tipFlowShortNote()}
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
