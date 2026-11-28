'use client'

import {
  PaymentNotice,
  type NoticeAction,
  WalletGate,
} from '@/components/payments'
import type { TabRefusal } from '@/lib/payments/failures'
import type { TabTipOutcome } from '@/lib/tab-ui/tip-flow'
import { TAB_ACTIONS, TAB_TIP } from '@/lib/copy/tab'

/**
 * A quick tip that was sent and not accepted: the server's refusal, or why
 * nothing (or nothing known) was accepted. Announced, since it answers the
 * reader's press. Renders nothing for an accepted tip.
 */
export function TabTipOutcomeNotice({
  refusal,
  outcome,
  free,
  manageHref,
  walletAction,
  headingLevel = 4,
}: {
  refusal: TabRefusal | null
  outcome: TabTipOutcome | null
  /** Free tab balance, for "not enough in your tab". */
  free?: string
  manageHref: string
  walletAction?: NoticeAction & { label: string }
  /** The notice title's level: under the tab tip's own heading. */
  headingLevel?: 2 | 3 | 4 | 5 | 6
}) {
  const manage = { href: manageHref, label: TAB_ACTIONS.manage }
  if (refusal) {
    if (refusal.kind === 'notice') {
      const kind = refusal.notice.kind
      if (kind === 'insufficient-balance') {
        return (
          <PaymentNotice
            kind="insufficient-balance"
            source="tab"
            available={free}
            action={manage}
            announce
            headingLevel={headingLevel}
          />
        )
      }
      if (kind === 'daily-limit' || kind === 'tab-closing') {
        return (
          <PaymentNotice
            kind={kind}
            action={walletAction}
            announce
            headingLevel={headingLevel}
          />
        )
      }
      return (
        <PaymentNotice
          kind={kind}
          action={manage}
          announce
          headingLevel={headingLevel}
        />
      )
    }
    if (refusal.kind === 'refused') {
      return (
        <PaymentNotice
          kind="refused"
          copy={refusal.copy}
          announce
          headingLevel={headingLevel}
        />
      )
    }
    if (refusal.kind === 'tips-unavailable') {
      return (
        <PaymentNotice
          kind="tips-unavailable"
          reason={refusal.reason}
          action={walletAction}
          announce
          headingLevel={headingLevel}
        />
      )
    }
    return (
      <WalletGate state={refusal.gate} verifyHref="/dashboard/wallet">
        {null}
      </WalletGate>
    )
  }
  switch (outcome?.kind) {
    case 'stopped':
      return (
        <PaymentNotice
          kind="refused"
          copy={{ title: TAB_TIP.stoppedTitle, detail: outcome.message }}
          announce
          headingLevel={headingLevel}
        />
      )
    case 'unconfirmed':
      return (
        <PaymentNotice
          kind="refused"
          copy={{
            title: TAB_TIP.unconfirmedTitle,
            detail: TAB_TIP.unconfirmedDetail,
          }}
          announce
          headingLevel={headingLevel}
        />
      )
    case 'unreachable':
      return (
        <PaymentNotice
          kind="refused"
          copy={{
            title: TAB_TIP.unreachableTitle,
            detail: TAB_TIP.unreachableDetail,
          }}
          announce
          headingLevel={headingLevel}
        />
      )
    default:
      return null
  }
}
