'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { useAuth } from '@/components/providers/AuthContext'
import { useWallet } from '@/components/providers/WalletProvider'
import { useWalletActivation } from '@/components/providers/WalletActivationContext'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertCircle, Coins, Loader2 } from 'lucide-react'
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
  selectionStartPosition?: number
  selectionEndPosition?: number
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

const HIGHLIGHT_TIP_BROADCAST_RECOVERY_MESSAGE: TipFailureMessage = {
  title: 'Tip transaction saved for recovery',
  detail:
    'Retry will register idempotently and rebroadcast the exact same signed transaction without creating another payment.',
}

const HIGHLIGHT_TIP_PAYMENT_LOCK_PREFIX = 'quilltip:highlight-tip-payment:v1'
const HIGHLIGHT_TIP_VERIFICATION_WARNING_MS = 10_000
const HIGHLIGHT_TIP_PAYMENT_LOCK_FAILURE_MESSAGE =
  'This browser could not safely reserve this highlight payment. No transaction was sent. Use a browser with Web Locks support, then retry.'

type HighlightTipPaymentLockContext = {
  tipperId: string
  articleId: string
  highlightId: string
  stellarNetwork: 'TESTNET' | 'MAINNET'
}

function highlightTipPaymentLockName({
  tipperId,
  articleId,
  highlightId,
  stellarNetwork,
}: HighlightTipPaymentLockContext): string {
  return `${HIGHLIGHT_TIP_PAYMENT_LOCK_PREFIX}:${[
    tipperId,
    articleId,
    highlightId,
    stellarNetwork,
  ]
    .map((part) => encodeURIComponent(part))
    .join(':')}`
}

async function withHighlightTipPaymentLock<T>(
  context: HighlightTipPaymentLockContext,
  operation: () => Promise<T>
): Promise<T> {
  const lockManager =
    typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!lockManager?.request) {
    throw new Error(HIGHLIGHT_TIP_PAYMENT_LOCK_FAILURE_MESSAGE)
  }

  let acquired = false
  try {
    return await lockManager.request(
      highlightTipPaymentLockName(context),
      { mode: 'exclusive' },
      async (lock: Lock | null) => {
        if (!lock) {
          throw new Error(HIGHLIGHT_TIP_PAYMENT_LOCK_FAILURE_MESSAGE)
        }
        acquired = true
        return await operation()
      }
    )
  } catch (error) {
    if (acquired) throw error
    throw new Error(HIGHLIGHT_TIP_PAYMENT_LOCK_FAILURE_MESSAGE)
  }
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
  selectionStartPosition,
  selectionEndPosition,
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
  const [submittedTipId, setSubmittedTipId] = useState<string | null>(null)
  const [verificationWarningVisible, setVerificationWarningVisible] =
    useState(false)
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
    api.highlightTips.getHighlightTipRecoveryStatus,
    submittedTipId &&
      isAuthenticated &&
      !isAuthLoading &&
      authUserId &&
      receiptMatchesCurrentContext
      ? { tipId: submittedTipId }
      : 'skip'
  )
  const verificationStatusRef = useRef(verificationStatus)
  verificationStatusRef.current = verificationStatus
  const isVerificationPending = Boolean(
    submittedTipId &&
    pendingTipRecord?.broadcastAcceptedAt &&
    receiptMatchesCurrentContext &&
    verificationStatus !== null &&
    verificationStatus?.status !== 'CONFIRMED' &&
    verificationStatus?.status !== 'FAILED'
  )
  const { priceUsd: displayXlmUsdRate } = useTipDialogXlmUsdRate(isOpen)

  useEffect(() => {
    setVerificationWarningVisible(false)
    if (!isVerificationPending) return

    const timeoutId = window.setTimeout(() => {
      setVerificationWarningVisible(true)
    }, HIGHLIGHT_TIP_VERIFICATION_WARNING_MS)
    return () => window.clearTimeout(timeoutId)
  }, [isVerificationPending, submittedTipId])

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
      restored.submittedTipId && restored.broadcastAcceptedAt
        ? null
        : HIGHLIGHT_TIP_BROADCAST_RECOVERY_MESSAGE
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
      verificationStatus === undefined ||
      !pendingTipRecord ||
      !receiptMatchesCurrentContext
    ) {
      return
    }

    if (verificationStatus === null) {
      const recoverableRecord = {
        ...pendingTipRecord,
        submittedTipId: undefined,
      }
      try {
        writePendingHighlightTipReceipt(recoverableRecord)
      } catch (error) {
        console.error('Highlight tip recovery receipt update error:', error)
      }
      setSubmittedTipId(null)
      setPendingTipRecord(recoverableRecord)
      setIsLoading(false)
      setTipFlowStep(null)
      setTipFailure(HIGHLIGHT_TIP_BROADCAST_RECOVERY_MESSAGE)
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
      setTipFailure(
        pendingTipRecord.broadcastAcceptedAt
          ? null
          : HIGHLIGHT_TIP_BROADCAST_RECOVERY_MESSAGE
      )
    }
  }, [
    pendingTipRecord,
    markTipRecordSynced,
    receiptMatchesCurrentContext,
    submittedTipId,
    verificationStatus,
  ])

  const retryPendingTipRecord = async (pending: PendingHighlightTipRecord) => {
    setTipFormError(null)
    setTipSuccess(null)
    setIsLoading(true)
    setTipFlowStep('submitting')

    let registered = false
    try {
      const tipId = await submitHighlightTip(toHighlightTipRecordArgs(pending))
      registered = true
      const syncedPending = { ...pending, submittedTipId: tipId }
      try {
        writePendingHighlightTipReceipt(syncedPending)
      } catch (error) {
        console.error('Highlight tip registered receipt update error:', error)
      }
      setPendingTipRecord(syncedPending)
      setSubmittedTipId(tipId)

      const receipt = await stellarClient.submitTipTransaction(
        syncedPending.signedXdr
      )
      if (
        receipt.transactionHash &&
        receipt.transactionHash.toLowerCase() !==
          syncedPending.stellarTxId.toLowerCase()
      ) {
        throw new Error(
          'Stellar returned a different transaction hash for the saved signed transaction.'
        )
      }
      const acceptedPending = {
        ...syncedPending,
        contractTipId: receipt.tipId ?? syncedPending.contractTipId,
        broadcastAcceptedAt: Date.now(),
      }
      try {
        writePendingHighlightTipReceipt(acceptedPending)
      } catch (error) {
        console.error('Highlight tip broadcast receipt update error:', error)
      }
      setPendingTipRecord(acceptedPending)
      setTipFlowStep('confirming')
      setTipFailure(null)
      try {
        await retryHighlightTipVerification({ tipId })
      } catch (error) {
        console.error('Highlight tip verification nudge error:', error)
      }
    } catch (error) {
      console.error('Highlight tip sync retry error:', error)
      setTipFailure(HIGHLIGHT_TIP_BROADCAST_RECOVERY_MESSAGE)
      if (!registered) setSubmittedTipId(null)
    } finally {
      setIsLoading(false)
      setTipFlowStep(null)
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
          ? pendingTipRecord.submittedTipId &&
            pendingTipRecord.broadcastAcceptedAt
            ? null
            : HIGHLIGHT_TIP_BROADCAST_RECOVERY_MESSAGE
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
      startOffset: selectionStartPosition ?? startOffset,
      endOffset: selectionEndPosition ?? endOffset,
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

    if (
      submittedTipId &&
      pendingTipRecord?.broadcastAcceptedAt &&
      verificationStatusRef.current?.status !== 'CONFIRMED' &&
      verificationStatusRef.current?.status !== 'FAILED'
    ) {
      setIsLoading(true)
      setTipFlowStep('confirming')
      try {
        await retryHighlightTipVerification({
          tipId: submittedTipId as Id<'highlightTips'>,
        })
      } catch (error) {
        console.error('Highlight tip verification retry error:', error)
      } finally {
        setIsLoading(false)
        setTipFlowStep(null)
      }
      return
    }

    if (submittedTipId && pendingTipRecord) {
      await retryPendingTipRecord(pendingTipRecord)
      return
    }

    if (submittedTipId) {
      if (verificationStatusRef.current?.status !== 'PENDING') {
        return
      }
      setIsLoading(true)
      setTipFlowStep('confirming')
      try {
        await retryHighlightTipVerification({
          tipId: submittedTipId as Id<'highlightTips'>,
        })
      } catch (error) {
        console.error('Highlight tip verification retry error:', error)
        const liveStatus = verificationStatusRef.current
        if (
          liveStatus?.status !== 'CONFIRMED' &&
          liveStatus?.status !== 'FAILED'
        ) {
          setTipFailure(formatTipFailureMessage(error))
        }
      } finally {
        setIsLoading(false)
        setTipFlowStep(null)
      }
      return
    }

    if (pendingTipRecord) {
      await retryPendingTipRecord(pendingTipRecord)
      return
    }

    const durableReceipt =
      currentHighlightId && stellarNetwork && authUserId
        ? readPendingHighlightTipReceipt(
            articleId,
            currentHighlightId,
            stellarNetwork,
            authUserId
          )
        : null
    if (durableReceipt) {
      setPendingTipRecord(durableReceipt)
      setSelectedAmount(durableReceipt.amountCents)
      if (durableReceipt.submittedTipId) {
        setSubmittedTipId(durableReceipt.submittedTipId)
        setTipFailure(
          durableReceipt.broadcastAcceptedAt
            ? null
            : HIGHLIGHT_TIP_BROADCAST_RECOVERY_MESSAGE
        )
      } else {
        await retryPendingTipRecord(durableReceipt)
      }
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

    if (!currentHighlightId || !stellarNetwork) {
      const message =
        'The highlight payment context is not ready. No transaction was sent. Please retry.'
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

    let durableTipRecord: PendingHighlightTipRecord | null = null
    try {
      const lockedResult = await withHighlightTipPaymentLock(
        {
          tipperId: String(user._id),
          articleId: String(articleId),
          highlightId: currentHighlightId,
          stellarNetwork,
        },
        async () => {
          const competingReceipt = readPendingHighlightTipReceipt(
            articleId,
            currentHighlightId,
            stellarNetwork,
            user._id
          )
          if (competingReceipt) {
            return {
              kind: 'existing' as const,
              tipRecord: competingReceipt,
            }
          }

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

          const transactionData =
            await stellarClient.buildHighlightTipTransaction(publicKey, {
              highlightId: quote.highlightId,
              articleSymbol: quote.articleSymbol,
              authorAddress: quote.authorAddress,
              amountStroops: quote.amountStroops,
              contractId: quote.contractId,
              timeBounds: quote.timeBounds,
            })

          const signedXDR = await signTransaction(transactionData.xdr)
          const deterministicHash =
            await stellarClient.deriveTipTransactionHash(signedXDR)

          const tipRecord: PendingHighlightTipRecord = {
            articleId: String(articleId),
            highlightId: quote.highlightId,
            tipperId: user._id,
            amountCents,
            stellarNetwork: quote.stellarNetwork,
            stellarSourceAccount: publicKey,
            intentId: quote.intentId,
            signedXdr: signedXDR,
            stellarTxId: deterministicHash,
            stellarLedger: undefined,
            stellarFeeCharged: undefined,
          }
          writePendingHighlightTipReceipt(tipRecord)
          durableTipRecord = tipRecord
          setPendingTipRecord(tipRecord)

          const tipId = await submitHighlightTip(
            toHighlightTipRecordArgs(tipRecord)
          )
          const syncedTipRecord = { ...tipRecord, submittedTipId: tipId }
          try {
            writePendingHighlightTipReceipt(syncedTipRecord)
          } catch (error) {
            console.error(
              'Highlight tip registered receipt update error:',
              error
            )
          }
          setPendingTipRecord(syncedTipRecord)
          setSubmittedTipId(tipId)
          setTipFlowStep('submitting')

          const receipt = await stellarClient.submitTipTransaction(signedXDR)
          if (
            receipt.transactionHash &&
            receipt.transactionHash.toLowerCase() !==
              deterministicHash.toLowerCase()
          ) {
            throw new Error(
              'Stellar returned a different transaction hash for the saved signed transaction.'
            )
          }
          const acceptedTipRecord = {
            ...syncedTipRecord,
            contractTipId: receipt.tipId,
            broadcastAcceptedAt: Date.now(),
          }
          writePendingHighlightTipReceipt(acceptedTipRecord)
          setPendingTipRecord(acceptedTipRecord)

          return {
            kind: 'broadcast' as const,
            tipRecord: acceptedTipRecord,
          }
        }
      )

      if (lockedResult.kind === 'existing') {
        setPendingTipRecord(lockedResult.tipRecord)
        setSelectedAmount(lockedResult.tipRecord.amountCents)
        if (lockedResult.tipRecord.submittedTipId) {
          setSubmittedTipId(lockedResult.tipRecord.submittedTipId)
          setTipFailure(
            lockedResult.tipRecord.broadcastAcceptedAt
              ? null
              : HIGHLIGHT_TIP_BROADCAST_RECOVERY_MESSAGE
          )
        } else {
          setTipFailure(HIGHLIGHT_TIP_BROADCAST_RECOVERY_MESSAGE)
        }
        return
      }

      setTipFlowStep('confirming')
      setTipFailure(null)
      try {
        await retryHighlightTipVerification({
          tipId: lockedResult.tipRecord.submittedTipId as Id<'highlightTips'>,
        })
      } catch (error) {
        console.error('Highlight tip verification nudge error:', error)
      }
    } catch (error) {
      console.error('Highlight tip error:', error)
      if (durableTipRecord) {
        setTipFailure(HIGHLIGHT_TIP_BROADCAST_RECOVERY_MESSAGE)
      } else {
        setTipFailure(formatTipFailureMessage(error))
      }
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
  ) : isVerificationPending ? (
    <Alert variant={verificationWarningVisible ? 'warning' : 'info'}>
      <Loader2 className="h-4 w-4 animate-spin" />
      <AlertTitle>
        {verificationWarningVisible
          ? 'Still confirming'
          : 'Confirming on Stellar'}
      </AlertTitle>
      <AlertDescription>
        {verificationWarningVisible
          ? 'Stellar is taking longer than usual. Check again without creating another payment.'
          : 'Your tip was submitted. This normally takes a few seconds.'}
      </AlertDescription>
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
              isConnected={isConnected}
              isWalletLoading={isWalletLoading}
              publicKey={publicKey}
              recoverySourcePublicKey={
                pendingTipRecord?.stellarSourceAccount ?? null
              }
              isLoading={isLoading}
              tipSuccess={tipSuccess}
              tipFailure={tipFailure}
              failureActionLabel={requiresStartOver ? 'Start over' : 'Retry'}
              isVerificationPending={isVerificationPending}
              verificationDelayed={verificationWarningVisible}
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
