'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
import { useArticleTipResume } from '@/hooks/useArticleTipResume'
import { TipAppreciationStep } from '@/components/tipping/TipAppreciationStep'
import { TipCheckoutStep } from '@/components/tipping/TipCheckoutStep'
import type { TipModalStep } from '@/components/tipping/tipModalStep'
import { tipDialogDescription, tipDialogTitle } from '@/lib/copy/tipping'

interface TipButtonProps {
  articleId: Id<'articles'>
  authorName: string
  authorStellarAddress?: string | null
  className?: string
}

type ArticleTipRecordArgs = {
  articleId: Id<'articles'>
  amountUsd: number
  message?: string
  stellarTxId: string
  stellarNetwork: 'TESTNET'
  stellarLedger?: number
  stellarFeeCharged?: string
  stellarSourceAccount?: string
  stellarDestinationAccount?: string
  stellarAmountXlm?: string
  contractTipId?: string
  platformFee?: number
  authorShare?: number
}

type PendingArticleTipRecord = {
  args: ArticleTipRecordArgs
  amountCents: number
  transactionHash?: string
}

const TIP_SYNC_FAILURE_MESSAGE: TipFailureMessage = {
  title: 'Tip sent, app sync failed',
  detail:
    'Your Stellar transaction was submitted. Retry will record that same transaction without sending another payment.',
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
  const [modalStep, setModalStep] = useState<TipModalStep>('appreciation')
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
  const [pendingTipRecord, setPendingTipRecord] =
    useState<PendingArticleTipRecord | null>(null)
  const suspendDialogForWalletRef = useRef(false)

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

  const resetModalState = () => {
    setModalStep('appreciation')
    setTipFailure(null)
    setTipFormError(null)
    setTipSuccess(null)
  }

  const markTipRecordSynced = (
    amountCents: number,
    transactionHash?: string
  ) => {
    clearPendingTipIntent()
    setPendingTipRecord(null)
    setTipFailure(null)
    setTipFormError(null)
    const successMessage = `Successfully tipped ${authorName} $${(amountCents / 100).toFixed(2)} via Stellar!`
    setTipSuccess(successMessage)

    toast.success(successMessage, {
      description: transactionHash
        ? `Transaction: ${transactionHash.slice(0, 8)}...`
        : undefined,
      action: transactionHash
        ? {
            label: 'View',
            onClick: () =>
              window.open(
                `https://stellar.expert/explorer/testnet/tx/${transactionHash}`,
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
      setTipMessage('')
    }, 3000)
  }

  const retryPendingTipRecord = async (pending: PendingArticleTipRecord) => {
    setTipFailure(null)
    setTipFormError(null)
    setTipSuccess(null)
    setIsLoading(true)
    setTipFlowStep('confirming')

    try {
      await sendTip(pending.args)
      markTipRecordSynced(pending.amountCents, pending.transactionHash)
    } catch (error) {
      console.error('Tip sync retry error:', error)
      setTipFailure(TIP_SYNC_FAILURE_MESSAGE)
    } finally {
      setIsLoading(false)
      setTipFlowStep(null)
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
      setTipFailure(null)
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
    setModalStep('appreciation')
    setTipFailure(null)
    setTipFormError(null)
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

      const tipRecord: PendingArticleTipRecord = {
        amountCents,
        transactionHash: receipt.transactionHash ?? undefined,
        args: {
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
        },
      }
      submittedTipRecord = tipRecord
      setPendingTipRecord(tipRecord)
      setTipFlowStep('confirming')

      await sendTip(tipRecord.args)

      markTipRecordSynced(amountCents, receipt.transactionHash ?? undefined)
    } catch (error) {
      console.error('Stellar tip error:', error)
      if (submittedTipRecord || pendingTipRecord) {
        setTipFailure(TIP_SYNC_FAILURE_MESSAGE)
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
              publicKey={
                publicKey ?? pendingTipRecord?.args.stellarSourceAccount ?? null
              }
              isLoading={isLoading}
              tipSuccess={tipSuccess}
              tipFailure={tipFailure}
              tipFlowStep={tipFlowStep}
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
