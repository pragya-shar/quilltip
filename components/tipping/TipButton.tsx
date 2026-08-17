'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
import { useTipDialogXlmUsdRate } from '@/hooks/useTipDialogXlmUsdRate'
import { TIP_PRESETS_ARTICLE } from '@/lib/constants'
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
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { signInToTip, validateTipAmountForm } from '@/lib/tip/signInToTip'
import { connectWalletFromOverlay } from '@/lib/wallet/connectWalletFromOverlay'
import { applyPendingAmountFields } from '@/lib/tip/applyPendingTipFormState'
import { clearPendingTipIntent } from '@/lib/tip/pendingTipIntent'
import type { ArticlePendingTipIntent } from '@/lib/tip/pendingTipIntent'
import {
  clearPendingArticleTipReceipt,
  readPendingArticleTipReceipt,
  writePendingArticleTipReceipt,
  type PendingArticleTipReceipt,
} from '@/lib/tip/pendingArticleTipReceipt'
import { useArticleTipResume } from '@/hooks/useArticleTipResume'
import { TipAppreciationStep } from '@/components/tipping/TipAppreciationStep'
import { TipCheckoutStep } from '@/components/tipping/TipCheckoutStep'
import type { TipModalStep } from '@/components/tipping/tipModalStep'
import { tipDialogDescription, tipDialogTitle } from '@/lib/copy/tipping'
import { STELLAR_CONFIG } from '@/lib/stellar/config'

interface TipButtonProps {
  articleId: Id<'articles'>
  authorName: string
  authorStellarAddress?: string | null
  className?: string
}

type ArticleTipRecordArgs = {
  intentId: Id<'articleTipIntents'>
  stellarTxId: string
  stellarLedger?: number
  stellarFeeCharged?: string
  contractTipId?: string
}

type PendingArticleTipRecord = PendingArticleTipReceipt

function toArticleTipRecordArgs(
  pending: PendingArticleTipRecord
): ArticleTipRecordArgs {
  return {
    intentId: pending.intentId,
    stellarTxId: pending.stellarTxId,
    stellarLedger: pending.stellarLedger,
    stellarFeeCharged: pending.stellarFeeCharged,
    contractTipId: pending.contractTipId,
  }
}

const TIP_SYNC_FAILURE_MESSAGE: TipFailureMessage = {
  title: 'Tip sent, app sync failed',
  detail:
    'Your Stellar transaction was submitted. Retry will record that same transaction without sending another payment.',
}

function configuredStellarNetwork(): 'TESTNET' | 'MAINNET' | null {
  return STELLAR_CONFIG.NETWORK === 'TESTNET' ||
    STELLAR_CONFIG.NETWORK === 'MAINNET'
    ? STELLAR_CONFIG.NETWORK
    : null
}

export function stellarExpertNetworkPath(
  network: 'TESTNET' | 'MAINNET'
): 'testnet' | 'public' {
  return network === 'MAINNET' ? 'public' : 'testnet'
}

export function TipButton({
  articleId,
  authorName,
  authorStellarAddress,
  className = '',
}: TipButtonProps) {
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
  const [isOpen, setIsOpen] = useState(false)
  const [modalStep, setModalStep] = useState<TipModalStep>('appreciation')
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [tipFlowStep, setTipFlowStep] = useState<TipFlowStep | null>(null)
  const [tipFailure, setTipFailure] = useState<TipFailureMessage | null>(null)
  const [requiresStartOver, setRequiresStartOver] = useState(false)
  const [tipFormError, setTipFormError] = useState<TipFailureMessage | null>(
    null
  )
  const [tipSuccess, setTipSuccess] = useState<string | null>(null)
  const [tipMessage, setTipMessage] = useState('')
  const [pendingTipRecord, setPendingTipRecord] =
    useState<PendingArticleTipRecord | null>(null)
  const [submittedTipId, setSubmittedTipId] = useState<Id<'tips'> | null>(null)
  const suspendDialogForWalletRef = useRef(false)
  const stellarNetwork = configuredStellarNetwork()
  const receiptMatchesCurrentContext = Boolean(
    pendingTipRecord &&
    stellarNetwork &&
    pendingTipRecord.articleId === String(articleId) &&
    pendingTipRecord.tipperId === authUserId &&
    pendingTipRecord.stellarNetwork === stellarNetwork
  )

  const convex = useConvex()
  const prepareArticleTip = useMutation(api.tips.prepareArticleTip)
  const submitArticleTip = useMutation(api.tips.submitArticleTip)
  const retryArticleTipVerification = useMutation(
    api.tips.retryArticleTipVerification
  )
  const verificationStatus = useQuery(
    api.tips.getArticleTipStatus,
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

  const applyResumeIntent = useCallback(
    (intent: ArticlePendingTipIntent) => {
      applyPendingAmountFields(intent, setSelectedAmount, setCustomAmount)
      if (intent.message) setTipMessage(intent.message)
      setModalStep('checkout')
      activateWallet()
      setIsOpen(true)
    },
    [activateWallet]
  )

  useArticleTipResume({
    articleId,
    isOpen,
    onResume: applyResumeIntent,
  })

  useEffect(() => {
    if (isAuthLoading) return

    const restored =
      stellarNetwork && isAuthenticated && authUserId
        ? readPendingArticleTipReceipt(articleId, stellarNetwork, authUserId)
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
      setTipMessage('')
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
    setTipMessage(restored.message ?? '')
    setModalStep('checkout')
    setRequiresStartOver(false)
    setTipFailure(
      restored.submittedTipId
        ? {
            title: 'Tip sent, verification delayed',
            detail:
              'Your Stellar transaction was submitted. Retry will check that same transaction without sending another payment.',
          }
        : TIP_SYNC_FAILURE_MESSAGE
    )
    setIsOpen(true)
  }, [
    articleId,
    authUserId,
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
    (record: PendingArticleTipRecord) => {
      clearPendingTipIntent()
      clearPendingArticleTipReceipt(
        record.articleId,
        record.stellarNetwork,
        record.tipperId
      )
      setPendingTipRecord(null)
      setSubmittedTipId(null)
      setTipFailure(null)
      setTipFormError(null)
      const successMessage = `Successfully tipped ${authorName} $${(record.amountCents / 100).toFixed(2)} via Stellar!`
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
        setTipMessage('')
      }, 3000)
    },
    [authorName, resetModalState]
  )

  useEffect(() => {
    if (
      !submittedTipId ||
      !verificationStatus ||
      !pendingTipRecord ||
      !receiptMatchesCurrentContext
    )
      return

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
      clearPendingArticleTipReceipt(
        pendingTipRecord.articleId,
        pendingTipRecord.stellarNetwork,
        pendingTipRecord.tipperId
      )
      setRequiresStartOver(true)
      setTipFailure({
        title: 'Tip could not be verified',
        detail:
          'The submitted Stellar transaction did not match the prepared tip. No verified tip was recorded.',
      })
      return
    }

    if (
      verificationStatus.status === 'PENDING' &&
      verificationStatus.failureReason ===
        'verification_temporarily_unavailable'
    ) {
      setIsLoading(false)
      setTipFlowStep(null)
      setRequiresStartOver(false)
      setTipFailure({
        title: 'Tip sent, verification delayed',
        detail:
          'Your Stellar transaction was submitted. Retry will check that same transaction without sending another payment.',
      })
    }
  }, [
    markTipRecordSynced,
    pendingTipRecord,
    submittedTipId,
    verificationStatus,
    receiptMatchesCurrentContext,
  ])

  const retryPendingTipRecord = async (pending: PendingArticleTipRecord) => {
    setTipFailure(null)
    setTipFormError(null)
    setTipSuccess(null)
    setIsLoading(true)
    setTipFlowStep('confirming')

    let verificationStarted = false
    try {
      const tipId = await submitArticleTip(toArticleTipRecordArgs(pending))
      const syncedPending = { ...pending, submittedTipId: tipId }
      writePendingArticleTipReceipt(syncedPending)
      setPendingTipRecord(syncedPending)
      setSubmittedTipId(tipId)
      verificationStarted = true
    } catch (error) {
      console.error('Tip sync retry error:', error)
      setTipFailure(TIP_SYNC_FAILURE_MESSAGE)
    } finally {
      if (!verificationStarted) {
        setIsLoading(false)
        setTipFlowStep(null)
      }
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && isLoading) return
    setIsOpen(open)
    if (!open) {
      if (!suspendDialogForWalletRef.current) {
        resetModalState()
      }
    } else {
      if (pendingTipRecord) {
        setSelectedAmount(pendingTipRecord.amountCents)
        setCustomAmount('')
        setTipMessage(pendingTipRecord.message ?? '')
        setModalStep('checkout')
      }
      setTipFailure(
        pendingTipRecord
          ? pendingTipRecord.submittedTipId
            ? {
                title: 'Tip sent, verification delayed',
                detail:
                  'Your Stellar transaction was submitted. Retry will check that same transaction without sending another payment.',
              }
            : TIP_SYNC_FAILURE_MESSAGE
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
      message: tipMessage,
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
    setRequiresStartOver(false)
    setSubmittedTipId(null)
    setPendingTipRecord(null)
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
        await retryArticleTipVerification({ tipId: submittedTipId })
      } catch (error) {
        console.error('Tip verification retry error:', error)
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

    if (!user || isAuthLoading) {
      const message = 'Please wait for sign-in to finish before sending a tip'
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

    try {
      const cooldown = await convex.query(api.tips.canTip, {})
      if (!cooldown.allowed) {
        const detail = `Please wait ${cooldown.waitSec}s before tipping again.`
        setTipFormError({ title: 'Slow down', detail })
        toast.error('Slow down', { description: detail })
        return
      }
    } catch (err) {
      console.error('[TipButton] canTip pre-flight failed', err)
    }

    setTipFailure(null)
    setTipFormError(null)
    setTipSuccess(null)
    setIsLoading(true)

    let submittedTipRecord: PendingArticleTipRecord | null = null
    let verificationStarted = false
    try {
      stellarFlowEmitter.emit({ flow: 'tip', step: 'awaiting_signature' })
      const quote = await prepareArticleTip({
        articleId,
        amountCents,
        message: tipMessage.trim() ? tipMessage.trim() : undefined,
        stellarSourceAccount: publicKey,
      })
      if (quote.stellarNetwork !== STELLAR_CONFIG.NETWORK) {
        throw new Error(
          'Stellar network configuration does not match the payment server. No transaction was submitted.'
        )
      }
      const transactionData = await stellarClient.buildTipTransaction(
        publicKey,
        {
          tipper: publicKey,
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

      const tipRecord: PendingArticleTipRecord = {
        articleId: String(articleId),
        tipperId: user._id,
        amountCents,
        message: tipMessage.trim() ? tipMessage.trim() : undefined,
        stellarNetwork: quote.stellarNetwork,
        stellarSourceAccount: publicKey,
        intentId: quote.intentId,
        stellarTxId: receipt.transactionHash,
        stellarLedger: undefined,
        stellarFeeCharged: undefined,
        contractTipId: receipt.tipId,
      }
      submittedTipRecord = tipRecord
      writePendingArticleTipReceipt(tipRecord)
      setPendingTipRecord(tipRecord)
      setTipFlowStep('confirming')

      const tipId = await submitArticleTip(toArticleTipRecordArgs(tipRecord))
      const syncedTipRecord = { ...tipRecord, submittedTipId: tipId }
      writePendingArticleTipReceipt(syncedTipRecord)
      setPendingTipRecord(syncedTipRecord)
      setSubmittedTipId(tipId)
      verificationStarted = true
    } catch (error) {
      console.error('Stellar tip error:', error)
      if (submittedTipRecord || pendingTipRecord) {
        setTipFailure(TIP_SYNC_FAILURE_MESSAGE)
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
    message: tipMessage,
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
          <Button variant="outline" className={cn('gap-2', className)}>
            <Coins className="w-4 h-4" />
            Tip Author
          </Button>
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
              {modalStep === 'appreciation'
                ? tipDialogTitle(authorName)
                : 'Send your tip'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {modalStep === 'appreciation'
                ? tipDialogDescription()
                : `Complete your tip to ${authorName}.`}
            </DialogDescription>
          </DialogHeader>

          {inlineTipAlert}

          {modalStep === 'appreciation' ? (
            <TipAppreciationStep
              variant="article"
              authorName={authorName}
              presets={TIP_PRESETS_ARTICLE}
              selectedAmount={selectedAmount}
              customAmount={customAmount}
              tipMessage={tipMessage}
              onSelectedAmountChange={setSelectedAmount}
              onCustomAmountChange={setCustomAmount}
              onTipMessageChange={setTipMessage}
              onContinue={handleContinue}
              onCancel={() => handleOpenChange(false)}
              isLoading={isLoading}
              canContinue={!!selectedAmount || !!customAmount}
              priceUsd={displayXlmUsdRate}
              idPrefix="tip"
            />
          ) : (
            <TipCheckoutStep
              variant="article"
              authorName={authorName}
              amountCents={checkoutAmountCents}
              message={tipMessage.trim() || undefined}
              isAuthenticated={isAuthenticated}
              isConnected={isConnected || Boolean(pendingTipRecord)}
              isWalletLoading={isWalletLoading}
              publicKey={publicKey ?? null}
              isLoading={isLoading}
              tipSuccess={tipSuccess}
              tipFailure={tipFailure}
              failureActionLabel={requiresStartOver ? 'Start over' : 'Retry'}
              tipFlowStep={tipFlowStep}
              canGoBack={!pendingTipRecord}
              onBack={handleBackToAppreciation}
              onSignIn={handleSignInToTip}
              onConnectWallet={handleConnectWallet}
              onSendTip={handleTip}
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
