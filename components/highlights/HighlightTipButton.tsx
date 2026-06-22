'use client'

import { useState, useEffect, useRef } from 'react'
import { useConvex, useMutation } from 'convex/react'
import { useAuth } from '@/components/providers/AuthContext'
import { useWallet } from '@/components/providers/WalletProvider'
import { useWalletActivation } from '@/components/providers/WalletActivationContext'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertCircle, Coins } from 'lucide-react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'
import { stellarClient } from '@/lib/stellar/client'
import {
  stellarFlowEmitter,
  type TipFlowStep,
} from '@/lib/stellar/stellar-flow-emitter'
import {
  generateHighlightId,
  formatTipAmount,
} from '@/lib/stellar/highlight-utils'
import { useTipDialogXlmUsdRate } from '@/hooks/useTipDialogXlmUsdRate'
import { TIP_PRESETS_HIGHLIGHT } from '@/lib/constants'
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
import { signInToTip, validateTipAmountForm } from '@/lib/tip/signInToTip'
import { connectWalletFromOverlay } from '@/lib/wallet/connectWalletFromOverlay'
import { applyPendingAmountFields } from '@/lib/tip/applyPendingTipFormState'
import {
  clearPendingTipIntent,
  matchesHighlightPendingIntent,
  readPendingTipIntent,
} from '@/lib/tip/pendingTipIntent'
import { writePendingHighlightSelection } from '@/lib/highlight/pendingHighlightSelection'
import { TipAppreciationStep } from '@/components/tipping/TipAppreciationStep'
import { TipCheckoutStep } from '@/components/tipping/TipCheckoutStep'
import type { TipModalStep } from '@/components/tipping/tipModalStep'

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
  resumeOpen?: boolean
  resumeAmountCents?: number
  resumeCustomAmount?: string
  onResumeOpenChange?: (open: boolean) => void
  onResumeDialogVisible?: () => void
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
  resumeOpen = false,
  resumeAmountCents,
  resumeCustomAmount,
  onResumeOpenChange,
  onResumeDialogVisible,
}: HighlightTipButtonProps) {
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
  const [isOpen, setIsOpen] = useState(resumeOpen)
  const [modalStep, setModalStep] = useState<TipModalStep>(
    resumeOpen ? 'checkout' : 'appreciation'
  )
  const resumedRef = useRef(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const restoredFromPendingIntentRef = useRef(false)
  const [isLoading, setIsLoading] = useState(false)
  const [tipFlowStep, setTipFlowStep] = useState<TipFlowStep | null>(null)
  const [tipFailure, setTipFailure] = useState<TipFailureMessage | null>(null)
  const [tipFormError, setTipFormError] = useState<TipFailureMessage | null>(
    null
  )
  const [tipSuccess, setTipSuccess] = useState<string | null>(null)

  const convex = useConvex()
  const createHighlightTip = useMutation(api.highlightTips.create)
  const { priceUsd: displayXlmUsdRate } = useTipDialogXlmUsdRate(isOpen)

  useEffect(() => {
    return stellarFlowEmitter.subscribe((event) => {
      if (event.flow === 'tip') {
        setTipFlowStep(event.step)
      }
    })
  }, [])

  useEffect(() => {
    if (!resumeOpen || resumedRef.current) return
    resumedRef.current = true
    applyPendingAmountFields(
      {
        amountCents: resumeAmountCents,
        customAmount: resumeCustomAmount,
      },
      setSelectedAmount,
      setCustomAmount
    )
    setModalStep('checkout')
    activateWallet()
    setIsOpen(true)
    onResumeOpenChange?.(true)
  }, [
    resumeOpen,
    resumeAmountCents,
    resumeCustomAmount,
    activateWallet,
    onResumeOpenChange,
  ])

  useEffect(() => {
    if (!isOpen || !resumedRef.current) return
    onResumeDialogVisible?.()
  }, [isOpen, onResumeDialogVisible])

  useEffect(() => {
    if (!isOpen || !isAuthenticated) return
    if (resumedRef.current) return
    if (restoredFromPendingIntentRef.current) return
    if (selectedAmount != null || customAmount) return

    const pending = readPendingTipIntent()
    if (
      !matchesHighlightPendingIntent(pending, articleId) ||
      pending.startOffset !== startOffset ||
      pending.endOffset !== endOffset ||
      pending.highlightText !== highlightText
    ) {
      return
    }

    restoredFromPendingIntentRef.current = true
    applyPendingAmountFields(
      {
        amountCents: pending.amountCents,
        customAmount: pending.customAmount,
      },
      setSelectedAmount,
      setCustomAmount
    )
    setModalStep('checkout')
    activateWallet()

    requestAnimationFrame(() => {
      clearPendingTipIntent()
    })
  }, [
    isOpen,
    isAuthenticated,
    articleId,
    startOffset,
    endOffset,
    highlightText,
    selectedAmount,
    customAmount,
    activateWallet,
  ])

  const resetModalState = () => {
    setModalStep('appreciation')
    setTipFailure(null)
    setTipFormError(null)
    setTipSuccess(null)
  }

  const suspendDialogForWalletRef = useRef(false)

  const handleOpenChange = (open: boolean) => {
    if (!open && isLoading) return
    setIsOpen(open)
    onResumeOpenChange?.(open)
    if (!open) {
      if (!suspendDialogForWalletRef.current) {
        resetModalState()
        setSelectedAmount(null)
        setCustomAmount('')
      }
    } else {
      setTipFailure(null)
      setTipFormError(null)
      setTipSuccess(null)
    }
  }

  const handleContinue = () => {
    const validation = validateTipAmountForm({
      selectedAmount,
      customAmount,
    })
    if (!validation.ok) {
      setTipFormError({ title: validation.message })
      toast.error(validation.message)
      return
    }
    setTipFormError(null)
    setModalStep('checkout')
    if (isAuthenticated) {
      activateWallet()
    }
  }

  const handleBackToAppreciation = () => {
    setModalStep('appreciation')
    setTipFailure(null)
    setTipFormError(null)
  }

  const handleSignInToTip = () => {
    writePendingHighlightSelection({
      articleId: String(articleId),
      highlightText,
      startOffset,
      endOffset,
    })
    signInToTip(
      router,
      pathname,
      { selectedAmount, customAmount },
      {
        kind: 'highlight',
        articleId: articleId,
        articleSlug,
        highlightText,
        startOffset,
        endOffset,
        ...(startContainerPath ? { startContainerPath } : {}),
        ...(endContainerPath ? { endContainerPath } : {}),
        ...(selectedAmount != null ? { amountCents: selectedAmount } : {}),
        ...(customAmount ? { customAmount } : {}),
      }
    )
  }

  const handleTip = async () => {
    const validation = validateTipAmountForm({
      selectedAmount,
      customAmount,
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
      const message = 'Author has not set up their Stellar wallet yet'
      setTipFormError({ title: message })
      toast.error(message)
      return
    }

    try {
      const cooldown = await convex.query(api.tips.canTip, {})
      if (!cooldown.allowed) {
        const detail = `Please wait ${cooldown.waitSec}s before tipping again.`
        setTipFormError({ title: 'Slow down', detail })
        toast.error('Slow down', { description: detail })
        return
      }
    } catch (err) {
      console.error('[HighlightTipButton] canTip pre-flight failed', err)
    }

    setTipFailure(null)
    setTipFormError(null)
    setTipSuccess(null)
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

      clearPendingTipIntent()
      setTipFailure(null)
      setTipFormError(null)
      const successMessage = `Successfully tipped ${authorName} ${formatTipAmount(amountCents)} for this highlight!`
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
        resetModalState()
        setSelectedAmount(null)
        setCustomAmount('')
        onSuccess?.()
      }, 3000)
    } catch (error) {
      console.error('Highlight tip error:', error)
      setTipFailure(formatTipFailureMessage(error))
    } finally {
      setIsLoading(false)
      setTipFlowStep(null)
    }
  }

  const handleConnectWallet = async () => {
    try {
      const connected = await connectWalletFromOverlay({
        activateWallet,
        connect,
        closeOverlay: () => {
          suspendDialogForWalletRef.current = true
          setIsOpen(false)
        },
        reopenOverlay: () => {
          suspendDialogForWalletRef.current = false
          setModalStep('checkout')
          setIsOpen(true)
        },
      })
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

  const amountValidation = validateTipAmountForm({
    selectedAmount,
    customAmount,
  })
  const checkoutAmountCents = amountValidation.ok
    ? amountValidation.amountCents
    : 0

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
          data-testid="highlight-tip-dialog"
          className="max-w-md max-h-[min(90dvh,calc(100%-2rem))] overflow-y-auto"
          onEscapeKeyDown={(e) => {
            if (isLoading) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (isLoading) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {modalStep === 'appreciation'
                ? 'Tip this highlight'
                : 'Send your tip'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {modalStep === 'appreciation'
                ? 'Choose an amount to tip this highlight.'
                : 'Complete your highlight tip.'}
            </DialogDescription>
          </DialogHeader>

          {inlineTipAlert}

          {modalStep === 'appreciation' ? (
            <TipAppreciationStep
              variant="highlight"
              authorName={authorName}
              highlightText={highlightText}
              presets={TIP_PRESETS_HIGHLIGHT}
              selectedAmount={selectedAmount}
              customAmount={customAmount}
              onSelectedAmountChange={setSelectedAmount}
              onCustomAmountChange={setCustomAmount}
              onContinue={handleContinue}
              onCancel={() => handleOpenChange(false)}
              isLoading={isLoading}
              canContinue={!!selectedAmount || !!customAmount}
              priceUsd={displayXlmUsdRate}
              idPrefix="highlight-tip"
            />
          ) : (
            <TipCheckoutStep
              variant="highlight"
              authorName={authorName}
              amountCents={checkoutAmountCents}
              isAuthenticated={isAuthenticated}
              isConnected={isConnected}
              isWalletLoading={isWalletLoading}
              publicKey={publicKey}
              isLoading={isLoading}
              tipSuccess={tipSuccess}
              tipFailure={tipFailure}
              tipFlowStep={tipFlowStep}
              onBack={handleBackToAppreciation}
              onSignIn={handleSignInToTip}
              onConnectWallet={handleConnectWallet}
              onSendTip={() => void handleTip()}
              useGradientButtons
            />
          )}
        </DialogContent>
      </Dialog>

      <InstallWalletDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
      />
    </>
  )
}
