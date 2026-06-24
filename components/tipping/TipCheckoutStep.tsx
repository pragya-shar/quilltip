'use client'

import Link from 'next/link'
import { Heart, Loader2, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TipAmountSummary } from '@/components/tipping/TipAmountSummary'
import { WalletTooltip } from '@/components/guide/WalletTooltip'
import {
  networkLabelLowercase,
  tipDialogFooterNote,
} from '@/lib/copy/network-status'
import type { TipFlowStep } from '@/lib/stellar/stellar-flow-emitter'
import { tipFlowProgressLabel } from '@/lib/stellar/stellar-flow-emitter'
import type { TipFailureMessage } from '@/lib/stellar/tip-error-messages'

interface TipCheckoutStepProps {
  variant: 'article' | 'highlight'
  authorName: string
  amountCents: number
  message?: string
  isAuthenticated: boolean
  isConnected: boolean
  isWalletLoading: boolean
  publicKey: string | null
  isLoading: boolean
  tipSuccess: string | null
  tipFailure: TipFailureMessage | null
  tipFlowStep: TipFlowStep | null
  onBack: () => void
  onSignIn: () => void
  onConnectWallet: () => void
  onSendTip: () => void
}

export function TipCheckoutStep({
  variant,
  authorName,
  amountCents,
  message,
  isAuthenticated,
  isConnected,
  isWalletLoading,
  publicKey,
  isLoading,
  tipSuccess,
  tipFailure,
  tipFlowStep,
  onBack,
  onSignIn,
  onConnectWallet,
  onSendTip,
}: TipCheckoutStepProps) {
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

    if (!isConnected) {
      return (
        <Button
          type="button"
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
            {tipFailure ? 'Retry' : 'Send Tip'}
          </>
        )}
      </Button>
    )
  }

  return (
    <>
      <TipAmountSummary amountCents={amountCents} message={message} />

      {!isAuthenticated ? (
        <div className="p-3 bg-muted border border-border rounded-lg text-sm text-muted-foreground">
          <p>
            Sign in to send your {formatTipLabel(variant)} to {authorName}.
          </p>
        </div>
      ) : !isConnected ? (
        <div className="p-3 bg-warning text-warning-foreground border border-warning/30 rounded-lg text-sm">
          <p>
            Connect your Stellar wallet to send your {formatTipLabel(variant)}{' '}
            to {authorName}.
          </p>
          <p className="mt-1">
            New to crypto?{' '}
            <Link
              href="/guide"
              className="focus-ring rounded underline font-medium hover:opacity-80"
            >
              Follow our setup guide
            </Link>
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Confirm and send your {formatTipLabel(variant)} to {authorName}.
        </p>
      )}

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={isLoading}
          className="flex-1"
        >
          Back
        </Button>
        {renderPrimaryButton()}
      </div>

      {isConnected && publicKey ? (
        <div className="text-xs text-success-foreground text-center">
          <p className="flex items-center justify-center gap-1">
            <Wallet className="w-3 h-3" />
            Connected: {publicKey.slice(0, 6)}...{publicKey.slice(-6)}
          </p>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1 flex-wrap">
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
  return variant === 'article' ? 'tip' : 'highlight tip'
}
