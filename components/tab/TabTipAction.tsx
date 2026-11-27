'use client'

import { useId, useState } from 'react'
import {
  PaymentNotice,
  TestnetLabel,
  type NoticeAction,
  TransactionProgress,
  WalletGate,
  XlmAmount,
} from '@/components/payments'
import { NoticeActionButton } from '@/components/payments/NoticeActionButton'
import { useTabTip, type TabTipTarget } from '@/hooks/tab/useTabTip'
import { TAB_ACTIONS, TAB_KEYS, TAB_PAGE, TAB_TIP } from '@/lib/copy/tab'
import { formatUsd } from '@/lib/copy/network-status'

export type TabTipActionProps = TabTipTarget & {
  /** The tip in US cents, when the tip UI picks it; presets otherwise. */
  amountCents?: number
  /** The writer's display name, for the result line. */
  writerName?: string
  /** Opens the wallet tip instead (splits, limits, no tab). */
  onTipFromWallet?: () => void
  /** Where the reader manages the tab. */
  manageHref?: string
  /** Called once Convex accepted the tip. */
  onAccepted?: (receiptId: string) => void
}

const PRESET_CENTS = [25, 50, 100] as const

/**
 * Quick tip from the tab, for the tip dialog. No wallet prompt: this
 * browser's session key signs a voucher; Convex accepts it and the settler
 * settles it later. Accepted shows first, settled when the receipt says so.
 */
export function TabTipAction({
  amountCents,
  writerName,
  onTipFromWallet,
  manageHref = '/dashboard/tab',
  onAccepted,
  ...target
}: TabTipActionProps) {
  const tip = useTabTip(target)
  const id = useId()
  const [picked, setPicked] = useState<number>(PRESET_CENTS[0])
  const cents = amountCents ?? picked
  const { availability, state, outcome, progress, refusal } = tip
  const walletAction = onTipFromWallet
    ? { onClick: onTipFromWallet, label: TAB_TIP.tipFromWallet }
    : undefined
  const manage = { href: manageHref, label: TAB_ACTIONS.manage }

  const body = (() => {
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
        return (
          <>
            <PaymentNotice
              kind="refused"
              copy={{
                title: TAB_TIP.unavailable,
                detail: TAB_TIP.settlementOff,
              }}
            />
            {walletAction ? (
              <div className="tab-actions">
                <NoticeActionButton
                  action={walletAction}
                  label={walletAction.label}
                />
              </div>
            ) : null}
          </>
        )
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
      case 'key': {
        // Each key state with its own cause and next step.
        const d = availability.device
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
            return notice(
              TAB_KEYS.otherDeviceTitle,
              TAB_KEYS.otherDeviceDetail,
              {
                ...manage,
                label: TAB_ACTIONS.setUpKey,
              }
            )
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
      case 'ready':
        return null
    }
  })()

  const ready = availability.kind === 'ready'
  const running = state.phase === 'running'
  const showForm =
    ready && !progress && !(outcome && outcome.kind !== 'accepted')

  return (
    <section className="tab-tip-action" aria-labelledby={`${id}-title`}>
      <div className="tab-tip-action-head">
        <h3 id={`${id}-title`} className="tab-tip-action-title">
          {TAB_TIP.heading}
        </h3>
        {ready ? (
          <span className="tab-subtle">
            <XlmAmount amount={availability.free} /> {TAB_TIP.freeSuffix}
          </span>
        ) : null}
      </div>
      {body}
      {refusal ? (
        refusal.kind === 'notice' ? (
          refusal.notice.kind === 'insufficient-balance' ? (
            <PaymentNotice
              kind="insufficient-balance"
              source="tab"
              available={ready ? availability.free : undefined}
              action={manage}
              announce
            />
          ) : refusal.notice.kind === 'daily-limit' ||
            refusal.notice.kind === 'tab-closing' ? (
            <PaymentNotice
              kind={refusal.notice.kind}
              action={walletAction}
              announce
            />
          ) : (
            <PaymentNotice
              kind={refusal.notice.kind}
              action={manage}
              announce
            />
          )
        ) : refusal.kind === 'refused' ? (
          <PaymentNotice kind="refused" copy={refusal.copy} announce />
        ) : refusal.kind === 'tips-unavailable' ? (
          <PaymentNotice
            kind="tips-unavailable"
            reason={refusal.reason}
            action={walletAction}
            announce
          />
        ) : (
          <WalletGate state={refusal.gate} verifyHref="/dashboard/wallet">
            {null}
          </WalletGate>
        )
      ) : null}
      {outcome?.kind === 'stopped' ? (
        <PaymentNotice
          kind="refused"
          copy={{ title: TAB_TIP.stoppedTitle, detail: outcome.message }}
          announce
        />
      ) : null}
      {outcome?.kind === 'unconfirmed' ? (
        <PaymentNotice
          kind="refused"
          copy={{
            title: TAB_TIP.unconfirmedTitle,
            detail: TAB_TIP.unconfirmedDetail,
          }}
          announce
        />
      ) : null}
      {outcome?.kind === 'unreachable' ? (
        <PaymentNotice
          kind="refused"
          copy={{
            title: TAB_TIP.unreachableTitle,
            detail: TAB_TIP.unreachableDetail,
          }}
          announce
        />
      ) : null}
      {progress ? (
        <TransactionProgress
          flow="tab-tip"
          source={progress}
          txHash={tip.settledTxHash}
          startedByUser
          audience="reader"
          summary={
            outcome?.kind === 'accepted'
              ? { amount: outcome.amount, to: writerName }
              : undefined
          }
          resultPlace="your tab"
          headingLevel={4}
          doneAction={
            outcome?.kind === 'accepted'
              ? {
                  onClick: tip.reset,
                  label: TAB_TIP.another,
                  emphasis: 'secondary',
                }
              : undefined
          }
        />
      ) : null}
      {showForm ? (
        <form
          className="tab-tip-action"
          onSubmit={async (event) => {
            event.preventDefault()
            const result = await tip.send(cents)
            if (result?.kind === 'accepted') onAccepted?.(result.receiptId)
          }}
        >
          {amountCents === undefined ? (
            <fieldset className="tab-presets">
              <legend>{TAB_TIP.amountLabel}</legend>
              {PRESET_CENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="tab-preset"
                  aria-pressed={picked === c}
                  onClick={() => setPicked(c)}
                >
                  {formatUsd(c / 100)}
                </button>
              ))}
            </fieldset>
          ) : null}
          <p className="tab-subtle">{TAB_TIP.noPrompt}</p>
          <div className="tab-actions">
            <button type="submit" className="tab-primary" disabled={running}>
              {running ? TAB_TIP.sending : TAB_TIP.send(formatUsd(cents / 100))}
            </button>
          </div>
          <TestnetLabel detail />
        </form>
      ) : null}
      {(refusal ||
        outcome?.kind === 'stopped' ||
        outcome?.kind === 'unconfirmed' ||
        outcome?.kind === 'unreachable') &&
      ready ? (
        <div className="tab-actions">
          <button type="button" className="tab-secondary" onClick={tip.reset}>
            {TAB_TIP.another}
          </button>
        </div>
      ) : null}
    </section>
  )
}
