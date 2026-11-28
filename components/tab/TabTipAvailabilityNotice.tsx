'use client'

import {
  PaymentNotice,
  type NoticeAction,
  WalletGate,
} from '@/components/payments'
import { NoticeActionButton } from '@/components/payments/NoticeActionButton'
import type { TabTipAvailability } from '@/lib/tab-ui/tip-availability'
import { TAB_ACTIONS, TAB_KEYS, TAB_PAGE, TAB_TIP } from '@/lib/copy/tab'

/**
 * Why the reader cannot tip from the tab here, with its own next step. Shared
 * by the standalone quick tip and the tip dialog's tab section.
 */
export function TabTipAvailabilityNotice({
  availability,
  manageHref,
  walletAction,
}: {
  availability: Exclude<TabTipAvailability, { kind: 'ready' }>
  manageHref: string
  /** "Tip from wallet", where the wallet tip is somewhere else. */
  walletAction?: NoticeAction & { label: string }
}) {
  const manage = { href: manageHref, label: TAB_ACTIONS.manage }
  const notice = (
    title: string,
    detail: string,
    action: NoticeAction | undefined
  ) => (
    <>
      <PaymentNotice kind="refused" copy={{ title, detail }} />
      {action?.label ? (
        <div className="tab-actions">
          <NoticeActionButton action={action} label={action.label} />
        </div>
      ) : null}
    </>
  )

  switch (availability.kind) {
    case 'loading':
      return (
        <p className="tab-subtle" role="status">
          {TAB_TIP.heading}…
        </p>
      )
    case 'splits':
      return (
        <PaymentNotice
          kind="tips-unavailable"
          reason="splits"
          action={walletAction}
        />
      )
    case 'unavailable':
      return (
        <PaymentNotice
          kind="refused"
          copy={{
            title: TAB_TIP.unavailable,
            detail: TAB_PAGE.unavailableDetail,
          }}
        />
      )
    case 'settlement-off':
      return notice(TAB_TIP.unavailable, TAB_TIP.settlementOff, walletAction)
    case 'gate':
      return (
        <WalletGate state={availability.gate} verifyHref="/dashboard/wallet">
          {null}
        </WalletGate>
      )
    case 'tab-none':
      return (
        <PaymentNotice
          kind="tab-none"
          action={{ ...manage, label: TAB_ACTIONS.open }}
        />
      )
    case 'tab-closing':
      return <PaymentNotice kind="tab-closing" action={walletAction} />
    case 'tab-short':
      return (
        <PaymentNotice
          kind="insufficient-balance"
          source="tab"
          short={availability.short}
          action={{ href: manageHref, label: TAB_ACTIONS.topUp }}
        />
      )
    case 'key': {
      const d = availability.device
      switch (d.kind) {
        case 'gone':
          return <PaymentNotice kind="session-key-missing" action={manage} />
        case 'expired':
          return <PaymentNotice kind="session-key-expired" action={manage} />
        case 'none':
          return (
            <PaymentNotice
              kind="session-key-none"
              action={{ ...manage, label: TAB_ACTIONS.setUpKey }}
            />
          )
        case 'other-device':
          return notice(TAB_KEYS.otherDeviceTitle, TAB_KEYS.otherDeviceDetail, {
            ...manage,
            label: TAB_ACTIONS.setUpKey,
          })
        case 'pending':
          return notice(TAB_KEYS.pendingTitle, TAB_KEYS.pendingDetail, {
            ...manage,
            label: TAB_KEYS.pendingAction,
          })
        case 'revoked':
          return notice(TAB_KEYS.revokedTitle, TAB_KEYS.revokedDetail, {
            ...manage,
            label: TAB_ACTIONS.setUpKey,
          })
        case 'stopped':
          return notice(TAB_KEYS.stoppedTitle, TAB_KEYS.stoppedDetail, {
            ...manage,
            label: TAB_ACTIONS.setUpKey,
          })
        case 'storage-unavailable':
          // No key can live in this browser: the wallet is the way.
          return notice(
            TAB_KEYS.storageTitle,
            TAB_KEYS.storageDetail,
            walletAction
          )
        case 'unchecked':
          return notice(
            TAB_KEYS.uncheckedTitle,
            TAB_KEYS.uncheckedDetail,
            walletAction
          )
      }
    }
  }
}
