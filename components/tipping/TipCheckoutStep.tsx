'use client'

import type { Ref } from 'react'

import { WalletSetupHelp } from '@/components/stellar/WalletSetupHelp'
import { Heart, Loader2, RefreshCw, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TipPassageContext } from './TipPassageContext'
import { TipAmountSummary } from '@/components/tipping/TipAmountSummary'
import { WalletTooltip } from '@/components/stellar/WalletTooltip'
import {
  networkLabelLowercase,
  tipDialogFooterNote,
  practiceFundsNote,
} from '@/lib/copy/network-status'
import type { TipFlowStep } from '@/lib/stellar/stellar-flow-emitter'
import { tipFlowProgressLabel } from '@/lib/stellar/stellar-flow-emitter'
import type { TipFailureMessage } from '@/lib/stellar/tip-error-messages'

interface TipCheckoutStepProps {
  variant: 'article' | 'highlight'
  authorName: string
  amountCents: number
  message?: string
  highlightText?: string
  isAuthenticated: boolean
  isConnected: boolean
  isWalletLoading: boolean
  publicKey: string | null
  recoverySourcePublicKey?: string | null
  isLoading: boolean
  tipSuccess: string | null
  tipFailure: TipFailureMessage | null
  failureActionLabel?: string
  isVerificationPending?: boolean
  verificationDelayed?: boolean
  verificationSettled?: boolean
  tipFlowStep: TipFlowStep | null
  canGoBack?: boolean
  onBack: () => void
  onSignIn: () => void
  connectButtonRef?: Ref<HTMLButtonElement>
  onConnectWallet: () => void
  onSendTip: () => void
}

export function TipCheckoutStep({
  variant,
  authorName,
  amountCents,
  message,
  highlightText,
  isAuthenticated,
  isConnected,
  isWalletLoading,
  publicKey,
  recoverySourcePublicKey,
  isLoading,
  tipSuccess,
  tipFailure,
  failureActionLabel = 'Retry',
  isVerificationPending = false,
  verificationDelayed = false,
  verificationSettled = false,
  tipFlowStep,
  canGoBack = true,
  onBack,
  onSignIn,
  connectButtonRef,
  onConnectWallet,
  onSendTip,
}: TipCheckoutStepProps) {
  const hasRecoverablePayment = Boolean(recoverySourcePublicKey)

  const renderPrimaryButton = () => {
    if (!isAuthenticated) {
      return (
        <Button
          type="button"
          onClick={onSignIn}
          disabled={isLoading}
          className="flex-1 gap-2"
        >
          <Heart className="w-4 h-4" />
          Sign in to tip
        </Button>
      )
    }

    if (!isConnected && !hasRecoverablePayment) {
      return (
        <Button
          type="button"
          ref={connectButtonRef}
          onClick={onConnectWallet}
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
      )
    }

    if (verificationSettled) {
      return (
        <Button type="button" disabled className="flex-1 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Finalizing tip
        </Button>
      )
    }

    if (isVerificationPending) {
      return (
        <Button
          type="button"
          onClick={onSendTip}
          disabled={isLoading || !verificationDelayed}
          className="flex-1 gap-2"
        >
          {isLoading || !verificationDelayed ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {verificationDelayed ? 'Check again' : 'Confirming on-chain'}
        </Button>
      )
    }

    return (
      <Button
        type="button"
        onClick={onSendTip}
        disabled={isLoading || !!tipSuccess}
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
            {tipFailure ? failureActionLabel : 'Send Tip'}
          </>
        )}
      </Button>
    )
  }

  return (
    <>
      {variant === 'highlight' && highlightText ? (
        <TipPassageContext text={highlightText} />
      ) : null}
      <p className="tip-hint">{practiceFundsNote()}</p>
      <TipAmountSummary amountCents={amountCents} message={message} />

      {!isAuthenticated ? (
        <div className="tip-notice">
          <p>
            Sign in to send your {formatTipLabel(variant)} to {authorName}.
          </p>
        </div>
      ) : !isConnected && !hasRecoverablePayment ? (
        <div className="tip-notice">
          <p>
            Connect your Stellar wallet to send your {formatTipLabel(variant)}{' '}
            to {authorName}.
          </p>
          <WalletSetupHelp />
        </div>
      ) : (
        <p className="tip-step-copy">
          Confirm and send your {formatTipLabel(variant)} to {authorName}.
        </p>
      )}

      <div className="tip-actions">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={isLoading || !canGoBack}
          className="flex-1"
        >
          Back
        </Button>
        {renderPrimaryButton()}
      </div>

      {recoverySourcePublicKey ? (
        <div className="tip-wallet-state">
          <p className="flex items-center justify-center gap-1">
            <Wallet className="w-3 h-3" />
            Transaction source: {recoverySourcePublicKey.slice(0, 6)}...
            {recoverySourcePublicKey.slice(-6)}
          </p>
        </div>
      ) : isConnected && publicKey ? (
        <div className="tip-wallet-state">
          <p className="flex items-center justify-center gap-1">
            <Wallet className="w-3 h-3" />
            Connected: {publicKey.slice(0, 6)}...{publicKey.slice(-6)}
          </p>
        </div>
      ) : null}

      <p className="tip-network-note">
        Powered by Stellar {networkLabelLowercase()}{' '}
        <WalletTooltip concept="stellar" />{' '}
        {networkLabelLowercase() === 'testnet' ? (
          <WalletTooltip concept="testnet" />
        ) : null}{' '}
        • {tipDialogFooterNote()}
      </p>
    </>
  )
}

function formatTipLabel(variant: 'article' | 'highlight'): string {
  return variant === 'article' ? 'tip' : 'passage tip'
}
