'use client'

import { useId, useState } from 'react'
import {
  TestnetLabel,
  TransactionProgress,
  XlmAmount,
} from '@/components/payments'
import { useTabTip, type TabTipTarget } from '@/hooks/tab/useTabTip'
import { TAB_TIP } from '@/lib/copy/tab'
import { formatUsd } from '@/lib/copy/network-status'
import { TabTipAvailabilityNotice } from './TabTipAvailabilityNotice'
import { TabTipOutcomeNotice } from './TabTipOutcomeNotice'

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

  const body =
    availability.kind === 'ready' ? null : (
      <TabTipAvailabilityNotice
        availability={availability}
        manageHref={manageHref}
        walletAction={walletAction}
      />
    )

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
      <TabTipOutcomeNotice
        refusal={refusal}
        outcome={outcome}
        free={ready ? availability.free : undefined}
        manageHref={manageHref}
        walletAction={walletAction}
      />
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
