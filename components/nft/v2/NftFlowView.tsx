'use client'

import { Button } from '@/components/ui/button'
import {
  PaymentNotice,
  TransactionProgress,
  WalletGate,
} from '@/components/payments'
import {
  canRetry,
  isSlow,
  progressStep,
  type NftFlowState,
  type NftSubmissionStatusLike,
} from '@/lib/nft/v2-flow'
import type { ProgressSource } from '@/lib/payments/ui-state'
import { useNow } from './useNow'

const HELP_HREF = '/support'
const WALLET_HELP = '/wallet/practice#wallet-help'

// ---------------------------------------------------------------------------
// Progress of one action
// ---------------------------------------------------------------------------

/** The kit's progress source for the flow and the server record. */
export function sourceFor(
  flow: NftFlowState,
  status: NftSubmissionStatusLike | null | undefined
): ProgressSource | null {
  if (flow.kind === 'preparing') return { clientStep: 'simulating' }
  if (flow.kind === 'running') {
    return status
      ? { record: status, step: progressStep(flow.step) }
      : { clientStep: progressStep(flow.step) }
  }
  if (flow.kind === 'tracking') {
    if (!status) {
      // Before the first answer: the client step it last saw.
      return flow.declined || flow.failure
        ? { record: { status: 'PREPARED' }, declined: flow.declined }
        : flow.txHash
          ? { record: { status: 'SUBMITTED' } }
          : { record: { status: 'PREPARED' } }
    }
    return { record: status, declined: flow.declined }
  }
  return null
}

export function FlowView({
  flow,
  status,
  onRetry,
  onDone,
  ownerUpdating,
  headingLevel = 3,
}: {
  flow: NftFlowState
  status: NftSubmissionStatusLike | null | undefined
  onRetry: () => void
  onDone: () => void
  ownerUpdating: string
  headingLevel?: 2 | 3 | 4
}) {
  const now = useNow(flow.kind === 'tracking' ? 5_000 : null)
  if (flow.kind === 'idle' || flow.kind === 'review') return null
  if (flow.kind === 'refused') {
    return (
      <div className="nft-v2-flow">
        <PaymentNotice kind="refused" copy={flow.copy} announce />
        <Button
          type="button"
          variant="outline"
          className="nft-button nft-button-secondary"
          onClick={onDone}
        >
          Close
        </Button>
      </div>
    )
  }
  if (flow.kind === 'gate') {
    return (
      <div className="nft-v2-flow">
        <WalletGate
          state={flow.gate}
          onConnect={onRetry}
          onRecheck={onRetry}
          onSignIn={() => window.location.assign('/login')}
          onInstall={() => window.location.assign(WALLET_HELP)}
        >
          {null}
        </WalletGate>
      </div>
    )
  }
  if (flow.kind === 'notice') {
    return (
      <div className="nft-v2-flow">
        {flow.notice === 'paused' ? (
          <PaymentNotice kind="paused" audience="writer" announce />
        ) : (
          <PaymentNotice kind="insufficient-balance" source="wallet" announce />
        )}
        <Button
          type="button"
          variant="outline"
          className="nft-button nft-button-secondary"
          onClick={onDone}
        >
          Close
        </Button>
      </div>
    )
  }
  const source = sourceFor(flow, status)
  if (!source) return null
  const tracking = flow.kind === 'tracking' ? flow : null
  const confirmedNotIndexed =
    status?.status === 'CONFIRMED' && status.indexed !== true
  return (
    <div className="nft-v2-flow">
      <TransactionProgress
        flow={flow.action === 'mint' ? 'nft-mint' : 'nft-transfer'}
        source={source}
        txHash={status?.txHash ?? tracking?.txHash ?? null}
        failure={tracking?.failure ?? null}
        onRetry={onRetry}
        retryAllowed={canRetry(status ?? null)}
        slow={isSlow(status ?? null, now)}
        resultPlace="this panel"
        reference={status?.needsReview ? status.submissionId : undefined}
        helpHref={HELP_HREF}
        doneAction={{ label: 'Done', onClick: onDone }}
        resultDetail={
          confirmedNotIndexed ? (
            <p className="pay-inline-status" role="status">
              {ownerUpdating}
            </p>
          ) : undefined
        }
        headingLevel={headingLevel}
      />
    </div>
  )
}
