'use client'

import type { Ref } from 'react'
import type { TipXlmPreset } from '@/lib/constants'

import { WalletSetupHelp } from '@/components/stellar/WalletSetupHelp'
import { Heart, Loader2, RefreshCw, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TipPassageContext } from './TipPassageContext'
import { TipAmountSummary } from '@/components/tipping/TipAmountSummary'
import { WalletTooltip } from '@/components/stellar/WalletTooltip'
import {
  networkLabelLowercase,
  practiceFundsNote,
} from '@/lib/copy/network-status'
import type { TipFlowStep } from '@/lib/stellar/stellar-flow-emitter'
import { tipFlowProgressLabel } from '@/lib/stellar/stellar-flow-emitter'
import type { TipFailureMessage } from '@/lib/stellar/tip-error-messages'

interface TipCheckoutStepProps {
  variant: 'article' | 'highlight'
  authorName: string
  amountCents: number
  amountXlm?: TipXlmPreset
  articleTitle?: string
  message?: string
  highlightText?: string
  isAuthenticated: boolean
  isConnected: boolean
  isWalletLoading: boolean
  wrongWalletNetwork?: boolean
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
  amountXlm,
  articleTitle,
  message,
  highlightText,
  isAuthenticated,
  isConnected,
  isWalletLoading,
  wrongWalletNetwork = false,
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
          className="tip-primary"
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
          className="tip-primary"
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

    if (wrongWalletNetwork) return null

    if (verificationSettled) {
      return (
        <Button type="button" disabled className="tip-primary">
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
          className="tip-primary"
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
        className="tip-primary"
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
            {tipFailure ? failureActionLabel : 'Review in wallet'}
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
      {variant === 'article' && articleTitle ? (
        <p className="tip-passage">{articleTitle}</p>
      ) : null}
      {amountXlm !== undefined ? (
        <div className="tip-summary">
          <p className="tip-summary-total">
            <span>Tip amount</span>
            <strong>
              {amountXlm}{' '}
              {networkLabelLowercase() === 'testnet' ? 'test XLM' : 'XLM'}
            </strong>
          </p>
          <dl className="tip-breakdown">
            <div>
              <dt>To the author · 97.5%</dt>
              <dd>{amountXlm * 0.975} XLM</dd>
            </div>
            <div>
              <dt>Platform fee · 2.5%</dt>
              <dd>{amountXlm * 0.025} XLM</dd>
            </div>
          </dl>
          {message ? <p className="tip-message">Your note: {message}</p> : null}
        </div>
      ) : (
        <TipAmountSummary amountCents={amountCents} message={message} />
      )}

      {!isAuthenticated ? (
        <div className="tip-notice">
          <p>
            Sign in to send your {formatTipLabel(variant)} to {authorName}.
          </p>
        </div>
      ) : !isConnected && !hasRecoverablePayment ? (
        <div className="tip-notice">
          <p>Connecting shares your address. It does not send a payment.</p>
          <WalletSetupHelp />
        </div>
      ) : wrongWalletNetwork ? (
        <p role="alert" className="tip-notice tip-notice-error">
          Switch your wallet to Stellar {networkLabelLowercase()} to review this
          tip.
        </p>
      ) : hasRecoverablePayment || !canGoBack || verificationSettled ? (
        <p className="tip-step-copy">
          The signed transaction is saved. Checking it again will not create a
          second tip.
        </p>
      ) : (
        <p className="tip-step-copy">
          Review and approve the tip in your wallet. Network fees are shown
          there.
        </p>
      )}

      <div className="tip-actions">
        {renderPrimaryButton()}
        {canGoBack ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={isLoading}
          >
            Back
          </Button>
        ) : null}
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
        Stellar {networkLabelLowercase()} <WalletTooltip concept="stellar" />{' '}
        {networkLabelLowercase() === 'testnet' ? (
          <WalletTooltip concept="testnet" />
        ) : null}{' '}
      </p>
      <p className="tip-network-note">{practiceFundsNote()}</p>
    </>
  )
}

function formatTipLabel(variant: 'article' | 'highlight'): string {
  return variant === 'article' ? 'tip' : 'passage tip'
}
