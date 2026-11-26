'use client'

import {
  PaymentNotice,
  TransactionProgress,
  WalletGate,
} from '@/components/payments'
import { TAB_FUND_FORM } from '@/lib/copy/tab'
import type { OperationView } from '@/hooks/tab/useTabOperation'

type TabOperationProgressProps = {
  view: Exclude<OperationView, { kind: 'idle' }>
  onRetry: () => void
  onDone: () => void
  /** Formatted unlock date for a confirmed close. */
  unlocksAround?: string
  /** Where the result shows later, for example "your tab". */
  resultPlace?: string
  audience?: 'reader' | 'writer'
}

/**
 * One tab operation through the payment kit: its progress and result, or
 * the gate, notice or refusal that stopped it before anything was signed.
 */
export function TabOperationProgress({
  view,
  onRetry,
  onDone,
  unlocksAround,
  resultPlace = 'your tab',
  audience = 'reader',
}: TabOperationProgressProps) {
  switch (view.kind) {
    case 'gate':
      return (
        <WalletGate state={view.gate} onConnect={onRetry} onRecheck={onRetry}>
          {null}
        </WalletGate>
      )
    case 'notice':
      return view.notice.kind === 'tips-unavailable' ? (
        <PaymentNotice
          kind="tips-unavailable"
          reason={view.notice.reason}
          announce
        />
      ) : view.notice.kind === 'insufficient-balance' ? (
        <PaymentNotice
          kind="insufficient-balance"
          source="wallet"
          announce
          action={{ onClick: onDone, emphasis: 'secondary' }}
        />
      ) : view.notice.kind === 'paused' ? (
        <PaymentNotice kind="paused" audience={audience} announce />
      ) : view.notice.kind === 'withdrawal-pending' ? (
        <PaymentNotice
          kind="withdrawal-pending"
          unlockDate={unlocksAround}
          announce
        />
      ) : view.notice.kind === 'session-key-missing' ? (
        <PaymentNotice
          kind="session-key-missing"
          announce
          action={{ onClick: onRetry }}
        />
      ) : (
        <PaymentNotice kind="basket-item-unavailable" announce />
      )
    case 'refusal': {
      const r = view.refusal
      if (r.kind === 'refused')
        return <PaymentNotice kind="refused" copy={r.copy} announce />
      if (r.kind === 'tips-unavailable')
        return (
          <PaymentNotice kind="tips-unavailable" reason={r.reason} announce />
        )
      if (r.kind === 'gate')
        return (
          <WalletGate state={r.gate} onRecheck={onRetry}>
            {null}
          </WalletGate>
        )
      return r.notice.kind === 'insufficient-balance' ? (
        <PaymentNotice kind="insufficient-balance" source="tab" announce />
      ) : (
        <PaymentNotice kind={r.notice.kind} announce />
      )
    }
    case 'progress':
      return (
        <TransactionProgress
          flow={view.flow}
          source={view.source}
          audience={audience}
          txHash={view.txHash}
          failure={view.failure}
          onRetry={onRetry}
          resultPlace={resultPlace}
          unlocksAround={unlocksAround}
          summary={view.amount ? { amount: view.amount } : undefined}
          doneAction={{ onClick: onDone }}
          headingLevel={3}
          resultDetail={
            view.cancelledWithdrawal ? (
              <p>{TAB_FUND_FORM.cancelledWithdrawal}</p>
            ) : undefined
          }
        />
      )
  }
}
