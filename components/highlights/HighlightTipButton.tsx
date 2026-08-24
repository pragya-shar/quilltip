'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
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
  tipHighlightDialogDescription,
  tipHighlightDialogTitle,
} from '@/lib/copy/tipping'
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
import { connectWalletFromOverlay } from '@/lib/wallet/connectWalletFromOverlay'
import { applyPendingAmountFields } from '@/lib/tip/applyPendingTipFormState'
import {
  clearPendingTipIntent,
  matchesHighlightPendingIntent,
  readPendingTipIntent,
} from '@/lib/tip/pendingTipIntent'
import {
  clearPendingHighlightTipReceipt,
  readPendingHighlightTipReceipt,
  writePendingHighlightTipReceipt,
  type PendingHighlightTipReceipt,
} from '@/lib/tip/pendingHighlightTipReceipt'
import { writePendingHighlightSelection } from '@/lib/highlight/pendingHighlightSelection'
import { TipAppreciationStep } from '@/components/tipping/TipAppreciationStep'
import { TipCheckoutStep } from '@/components/tipping/TipCheckoutStep'
import type { TipModalStep } from '@/components/tipping/tipModalStep'
import { STELLAR_CONFIG } from '@/lib/stellar/config'

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

type HighlightTipRecordArgs = {
  intentId: Id<'highlightTipIntents'>
  stellarTxId: string
  stellarLedger?: number
  stellarFeeCharged?: string
  contractTipId?: string
}

type PendingHighlightTipRecord = PendingHighlightTipReceipt

function toHighlightTipRecordArgs(
  pending: PendingHighlightTipRecord
): HighlightTipRecordArgs {
  return {
    intentId: pending.intentId,
    stellarTxId: pending.stellarTxId,
    stellarLedger: pending.stellarLedger,
    stellarFeeCharged: pending.stellarFeeCharged,
    contractTipId: pending.contractTipId,
  }
}

const HIGHLIGHT_TIP_SYNC_FAILURE_MESSAGE: TipFailureMessage = {
  title: 'Tip sent, app sync failed',
  detail:
    'Your Stellar transaction was submitted. Retry will record that same transaction without sending another payment.',
}

const HIGHLIGHT_TIP_VERIFICATION_DELAYED_MESSAGE: TipFailureMessage = {
  title: 'Tip sent, verification delayed',
  detail:
    'Your Stellar transaction was submitted. Retry will check that same transaction without sending another payment.',
}

function configuredStellarNetwork(): 'TESTNET' | 'MAINNET' | null {
  return STELLAR_CONFIG.NETWORK === 'TESTNET' ||
    STELLAR_CONFIG.NETWORK === 'MAINNET'
    ? STELLAR_CONFIG.NETWORK
    : null
}

function stellarExpertNetworkPath(
  network: 'TESTNET' | 'MAINNET'
): 'testnet' | 'public' {
  return network === 'MAINNET' ? 'public' : 'testnet'
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
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth()
  const authUserId = user?._id
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
  const [requiresStartOver, setRequiresStartOver] = useState(false)
  const [pendingTipRecord, setPendingTipRecord] =
    useState<PendingHighlightTipRecord | null>(null)
  const [submittedTipId, setSubmittedTipId] =
    useState<Id<'highlightTips'> | null>(null)
  const [currentHighlightId, setCurrentHighlightId] = useState<string | null>(
    null
  )
  const stellarNetwork = configuredStellarNetwork()
  const receiptMatchesCurrentContext = Boolean(
    pendingTipRecord &&
    currentHighlightId &&
    stellarNetwork &&
    pendingTipRecord.articleId === String(articleId) &&
    pendingTipRecord.highlightId === currentHighlightId &&
    pendingTipRecord.tipperId === authUserId &&
    pendingTipRecord.stellarNetwork === stellarNetwork
  )

  const convex = useConvex()
  const prepareHighlightTip = useMutation(api.highlightTips.prepareHighlightTip)
  const submitHighlightTip = useMutation(api.highlightTips.submitHighlightTip)
  const retryHighlightTipVerification = useMutation(
    api.highlightTips.retryHighlightTipVerification
  )
  const verificationStatus = useQuery(
    api.highlightTips.getHighlightTipStatus,
    submittedTipId &&
      isAuthenticated &&
      !isAuthLoading &&
      authUserId &&
      receiptMatchesCurrentContext
      ? { tipId: submittedTipId }
      : 'skip'
  )
  const { priceUsd: displayXlmUsdRate } = useTipDialogXlmUsdRate(isOpen)

  useEffect(() => {
    return stellarFlowEmitter.subscribe((event) => {
      if (event.flow === 'tip') {
        setTipFlowStep(event.step)
      }
    })
  }, [])

  useEffect(() => {
    let active = true
    void generateHighlightId(
      articleSlug,
      highlightText,
      startOffset,
      endOffset
    ).then((highlightId) => {
      if (active) setCurrentHighlightId(highlightId)
    })
    return () => {
      active = false
    }
  }, [articleSlug, endOffset, highlightText, startOffset])

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

  useEffect(() => {
    if (isAuthLoading || !currentHighlightId) return

    const restored =
      stellarNetwork && isAuthenticated && authUserId
        ? readPendingHighlightTipReceipt(
            articleId,
            currentHighlightId,
            stellarNetwork,
            authUserId
          )
        : null
    if (!restored) {
      if (!pendingTipRecord || receiptMatchesCurrentContext) return
      setPendingTipRecord(null)
      setSubmittedTipId(null)
      setTipFailure(null)
      setTipFormError(null)
      setTipSuccess(null)
      setRequiresStartOver(false)
      setIsLoading(false)
      setTipFlowStep(null)
      setSelectedAmount(null)
      setCustomAmount('')
      setModalStep('appreciation')
      setIsOpen(false)
      return
    }
    if (
      receiptMatchesCurrentContext &&
      pendingTipRecord?.stellarTxId === restored.stellarTxId
    ) {
      return
    }

    setPendingTipRecord(restored)
    setSubmittedTipId(restored.submittedTipId ?? null)
    setSelectedAmount(restored.amountCents)
    setCustomAmount('')
    setModalStep('checkout')
    setRequiresStartOver(false)
    setTipFailure(
      restored.submittedTipId
        ? HIGHLIGHT_TIP_VERIFICATION_DELAYED_MESSAGE
        : HIGHLIGHT_TIP_SYNC_FAILURE_MESSAGE
    )
    setIsOpen(true)
  }, [
    articleId,
    authUserId,
    currentHighlightId,
    isAuthenticated,
    isAuthLoading,
    pendingTipRecord,
    receiptMatchesCurrentContext,
    stellarNetwork,
  ])

  const resetModalState = useCallback(() => {
    setModalStep('appreciation')
    setTipFailure(null)
    setTipFormError(null)
    setTipSuccess(null)
    setRequiresStartOver(false)
  }, [])

  const markTipRecordSynced = useCallback(
    (record: PendingHighlightTipRecord) => {
      clearPendingTipIntent()
      clearPendingHighlightTipReceipt(record)
      setPendingTipRecord(null)
      setSubmittedTipId(null)
      setTipFailure(null)
      setTipFormError(null)
      const successMessage = `Successfully tipped ${authorName} ${formatTipAmount(record.amountCents)} for this highlight!`
      setTipSuccess(successMessage)

      toast.success(successMessage, {
        description: `Transaction: ${record.stellarTxId.slice(0, 8)}...`,
        action: {
          label: 'View',
          onClick: () =>
            window.open(
              `https://stellar.expert/explorer/${stellarExpertNetworkPath(record.stellarNetwork)}/tx/${record.stellarTxId}`,
              '_blank'
            ),
        },
      })

      window.setTimeout(() => {
        setIsOpen(false)
        resetModalState()
        setSelectedAmount(null)
        setCustomAmount('')
        onSuccess?.()
      }, 3000)
    },
    [authorName, onSuccess, resetModalState]
  )

  useEffect(() => {
    if (
      !submittedTipId ||
      !verificationStatus ||
      !pendingTipRecord ||
      !receiptMatchesCurrentContext
    ) {
      return
    }

    if (verificationStatus.status === 'CONFIRMED') {
      setIsLoading(false)
      setTipFlowStep(null)
      markTipRecordSynced(pendingTipRecord)
      return
    }

    if (verificationStatus.status === 'FAILED') {
      setIsLoading(false)
      setTipFlowStep(null)
      setSubmittedTipId(null)
      setPendingTipRecord(null)
      clearPendingHighlightTipReceipt(pendingTipRecord)
      setRequiresStartOver(true)
      const failureReason =
        verificationStatus.failureReason ?? 'verification_failed'
      setTipFailure({
        title: 'Tip could not be verified',
        detail: `Server reason: ${failureReason}. The writer was not credited.`,
      })
      return
    }

    if (verificationStatus.status === 'PENDING') {
      setIsLoading(false)
      setTipFlowStep(null)
      setRequiresStartOver(false)
      setTipFailure(HIGHLIGHT_TIP_VERIFICATION_DELAYED_MESSAGE)
    }
  }, [
    pendingTipRecord,
    markTipRecordSynced,
    receiptMatchesCurrentContext,
    submittedTipId,
    verificationStatus,
  ])

  const retryPendingTipRecord = async (pending: PendingHighlightTipRecord) => {
    setTipFailure(null)
    setTipFormError(null)
    setTipSuccess(null)
    setIsLoading(true)
    setTipFlowStep('confirming')

    let verificationStarted = false
    try {
      const tipId = await submitHighlightTip(toHighlightTipRecordArgs(pending))
      const syncedPending = { ...pending, submittedTipId: tipId }
      writePendingHighlightTipReceipt(syncedPending)
      setPendingTipRecord(syncedPending)
      setSubmittedTipId(tipId)
      verificationStarted = true
    } catch (error) {
      console.error('Highlight tip sync retry error:', error)
      setTipFailure(HIGHLIGHT_TIP_SYNC_FAILURE_MESSAGE)
    } finally {
      if (!verificationStarted) {
        setIsLoading(false)
        setTipFlowStep(null)
      }
    }
  }

  const suspendDialogForWalletRef = useRef(false)

  const handleOpenChange = (open: boolean) => {
    if (!open && isLoading) return
    setIsOpen(open)
    onResumeOpenChange?.(open)
    if (!open) {
      if (!suspendDialogForWalletRef.current) {
        resetModalState()
      }
    } else {
      if (pendingTipRecord) {
        setSelectedAmount(pendingTipRecord.amountCents)
        setCustomAmount('')
        setModalStep('checkout')
      }
      setTipFailure(
        pendingTipRecord
          ? pendingTipRecord.submittedTipId
            ? HIGHLIGHT_TIP_VERIFICATION_DELAYED_MESSAGE
            : HIGHLIGHT_TIP_SYNC_FAILURE_MESSAGE
          : null
      )
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
    if (pendingTipRecord) return
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
    if (requiresStartOver) {
      setRequiresStartOver(false)
      setSubmittedTipId(null)
      setPendingTipRecord(null)
      setTipFailure(null)
      setTipFormError(null)
      setModalStep('appreciation')
      return
    }

    if (submittedTipId) {
      setTipFailure(null)
      setIsLoading(true)
      setTipFlowStep('confirming')
      try {
        await retryHighlightTipVerification({ tipId: submittedTipId })
        setIsLoading(false)
        setTipFlowStep(null)
        setTipFailure(HIGHLIGHT_TIP_VERIFICATION_DELAYED_MESSAGE)
      } catch (error) {
        console.error('Highlight tip verification retry error:', error)
        setIsLoading(false)
        setTipFlowStep(null)
        setTipFailure(formatTipFailureMessage(error))
      }
      return
    }

    if (pendingTipRecord) {
      await retryPendingTipRecord(pendingTipRecord)
      return
    }

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

    if (!user || isAuthLoading) {
      const message = 'Please wait for sign-in to finish before sending a tip'
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

    let submittedTipRecord: PendingHighlightTipRecord | null = null
    let verificationStarted = false
    try {
      stellarFlowEmitter.emit({ flow: 'tip', step: 'awaiting_signature' })
      const quote = await prepareHighlightTip({
        articleId,
        highlightText,
        startOffset,
        endOffset,
        startContainerPath,
        endContainerPath,
        amountCents,
        stellarSourceAccount: publicKey,
      })
      if (quote.stellarNetwork !== STELLAR_CONFIG.NETWORK) {
        throw new Error(
          'Stellar network configuration does not match the payment server. No transaction was submitted.'
        )
      }

      const transactionData = await stellarClient.buildHighlightTipTransaction(
        publicKey,
        {
          highlightId: quote.highlightId,
          articleSymbol: quote.articleSymbol,
          authorAddress: quote.authorAddress,
          amountStroops: quote.amountStroops,
          contractId: quote.contractId,
          timeBounds: quote.timeBounds,
        }
      )

      const signedXDR = await signTransaction(transactionData.xdr)

      const receipt = await stellarClient.submitTipTransaction(signedXDR)
      if (!receipt.transactionHash) {
        throw new Error('Stellar did not return a transaction hash')
      }

      const tipRecord: PendingHighlightTipRecord = {
        articleId: String(articleId),
        highlightId: quote.highlightId,
        tipperId: user._id,
        amountCents,
        stellarNetwork: quote.stellarNetwork,
        stellarSourceAccount: publicKey,
        intentId: quote.intentId,
        stellarTxId: receipt.transactionHash,
        stellarLedger: undefined,
        stellarFeeCharged: undefined,
        contractTipId: receipt.tipId,
      }
      submittedTipRecord = tipRecord
      writePendingHighlightTipReceipt(tipRecord)
      setPendingTipRecord(tipRecord)
      setTipFlowStep('confirming')

      const tipId = await submitHighlightTip(
        toHighlightTipRecordArgs(tipRecord)
      )
      const syncedTipRecord = { ...tipRecord, submittedTipId: tipId }
      writePendingHighlightTipReceipt(syncedTipRecord)
      setPendingTipRecord(syncedTipRecord)
      setSubmittedTipId(tipId)
      verificationStarted = true
    } catch (error) {
      console.error('Highlight tip error:', error)
      if (submittedTipRecord || pendingTipRecord) {
        setTipFailure(HIGHLIGHT_TIP_SYNC_FAILURE_MESSAGE)
      } else {
        setTipFailure(formatTipFailureMessage(error))
      }
    } finally {
      if (!verificationStarted) {
        setIsLoading(false)
        setTipFlowStep(null)
      }
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
          <Button
            type="button"
            size="sm"
            className={cn('w-full gap-2 shadow-md', className)}
            title="Tip this highlight"
          >
            <Coins className="w-4 h-4" />
            <span className="font-medium">Tip Highlight</span>
          </Button>
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
                ? tipHighlightDialogTitle(authorName)
                : 'Send your tip'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {modalStep === 'appreciation'
                ? tipHighlightDialogDescription(authorName)
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
              isConnected={isConnected || Boolean(pendingTipRecord)}
              isWalletLoading={isWalletLoading}
              publicKey={
                publicKey ?? pendingTipRecord?.stellarSourceAccount ?? null
              }
              isLoading={isLoading}
              tipSuccess={tipSuccess}
              tipFailure={tipFailure}
              failureActionLabel={requiresStartOver ? 'Start over' : 'Retry'}
              tipFlowStep={tipFlowStep}
              canGoBack={!pendingTipRecord}
              onBack={handleBackToAppreciation}
              onSignIn={handleSignInToTip}
              onConnectWallet={handleConnectWallet}
              onSendTip={() => void handleTip()}
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
