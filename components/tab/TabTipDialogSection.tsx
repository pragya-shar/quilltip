'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import {
  PaymentNotice,
  TransactionProgress,
  XlmAmount,
} from '@/components/payments'
import { Button } from '@/components/ui/button'
import { useTabServices } from '@/hooks/tab/TabServicesContext'
import { useTabTip, type TabTipTarget } from '@/hooks/tab/useTabTip'
import { TAB_ACTIONS, TAB_TIP, TAB_TIP_DIALOG } from '@/lib/copy/tab'
import { NOTICE_COPY, TAB_REFUSAL_COPY } from '@/lib/copy/payment-states'
import { formatUsd } from '@/lib/copy/network-status'
import { formatXlm } from '@/lib/payments/format'
import {
  checkTabTipAmount,
  nextLimitsChange,
  tabTipLimitsAt,
  type TabTipAmountCheck,
} from '@/lib/tab-ui/tip-limits'
import { TabTipAvailabilityNotice } from './TabTipAvailabilityNotice'
import { TabTipDialogSkeleton } from './TabTipDialogSkeleton'
import { TabTipOutcomeNotice } from './TabTipOutcomeNotice'

/**
 * Where the tab section stands, for the dialog around it:
 * - `unavailable`: no quick tip here (no tab, no key on this device, …);
 *   the wallet tip is the primary action.
 * - `ready`: the tab can send the dialog's amount; its button is primary.
 * - `blocked`: the tab is ready, but a limit stops this amount (explained in
 *   the section); the wallet tip is primary again.
 * - `busy` / `result`: a quick tip is sending or has an answer; the dialog
 *   shows only this section.
 */
export type TabTipDialogPhase =
  | 'unavailable'
  | 'ready'
  | 'blocked'
  | 'busy'
  | 'result'

export type TabTipDialogProps = TabTipTarget & {
  /** The dialog's amount in US cents; null while it is not a valid amount. */
  amountCents: number | null
  writerName?: string
  manageHref?: string
  /**
   * The largest tab tip in whole cents at today's price while a quick tip is
   * on offer, else null. The dialog offers no preset above it.
   */
  onMaxChange?: (maxCents: number | null) => void
  onPhaseChange?: (phase: TabTipDialogPhase) => void
  /** "Send from your tab" was pressed without a valid amount. */
  onInvalidAmount?: () => void
  /** Closes the dialog after a result. */
  onDone?: () => void
  onAccepted?: (receiptId: string) => void
}

function limitCopy(
  check: Exclude<TabTipAmountCheck, { ok: true }>
): { title: string; detail: string } | null {
  switch (check.reason) {
    case 'no-price':
      return TAB_REFUSAL_COPY.noPrice
    case 'below-minimum':
      return TAB_REFUSAL_COPY.belowMinimum
    case 'above-max':
      return TAB_TIP_DIALOG.aboveMax(formatUsd(check.maxCents / 100))
    case 'daily-limit':
      return TAB_TIP_DIALOG.dailyLimit(formatXlm(check.left))
    case 'key-limit':
      return TAB_TIP_DIALOG.keyLimit(formatXlm(check.left))
    case 'balance':
      return null
  }
}

/**
 * The tip dialog's "from your tab" section (issue #546). It sends the
 * dialog's amount with this browser's session key, with no wallet prompt,
 * and says before the reader sends when a limit stands in the way, so an
 * expected refusal never reaches the server.
 */
export function TabTipDialogSection({
  amountCents,
  writerName,
  manageHref = '/dashboard/tab',
  onMaxChange,
  onPhaseChange,
  onInvalidAmount,
  onDone,
  onAccepted,
  ...target
}: TabTipDialogProps) {
  const tip = useTabTip(target)
  const id = useId()
  const { availability, state, outcome, progress, refusal, reader } = tip
  const ready = availability.kind === 'ready'
  const limits = reader.tab?.tipLimits ?? null
  const key =
    ready && reader.tab
      ? (reader.tab.keys.find((k) => k.keyId === availability.keyId) ?? null)
      : null

  // The limits hold until the price turns stale or the UTC day ends; the
  // query does not re-run as time passes, so the page checks again then.
  const services = useTabServices()
  const [now, setNow] = useState(() => services.now())
  useEffect(() => {
    if (!limits) return
    const wait = nextLimitsChange(limits, now) - services.now()
    const timer = setTimeout(
      () => setNow(services.now()),
      Math.min(Math.max(wait, 0), 2 ** 31 - 1)
    )
    return () => clearTimeout(timer)
  }, [limits, now, services])
  const checkAt = (at: number) =>
    ready && limits && amountCents !== null
      ? checkTabTipAmount({
          cents: amountCents,
          limits,
          free: availability.free,
          key,
          now: at,
        })
      : null
  const check = checkAt(now)

  const running = state.phase === 'running'
  const result = outcome?.kind === 'accepted' || outcome?.kind === 'unconfirmed'
  const phase: TabTipDialogPhase = running
    ? 'busy'
    : result
      ? 'result'
      : ready
        ? check && !check.ok
          ? 'blocked'
          : 'ready'
        : 'unavailable'

  // While the tab can send, the dialog's presets follow its maximum at the
  // current price; a stale price offers no tab maximum.
  const maxCents =
    ready && limits ? tabTipLimitsAt(limits, now).tipMaxCents : null
  useEffect(() => onMaxChange?.(maxCents), [maxCents, onMaxChange])
  useEffect(() => onPhaseChange?.(phase), [phase, onPhaseChange])
  useEffect(() => () => onMaxChange?.(null), [onMaxChange])

  // A refusal answered the amount it was sent with; a new amount clears it.
  const sentAmount = useRef<number | null>(null)
  const { reset } = tip
  useEffect(() => {
    if (
      outcome &&
      !result &&
      sentAmount.current !== null &&
      amountCents !== sentAmount.current
    ) {
      sentAmount.current = null
      reset()
    }
  }, [amountCents, outcome, result, reset])

  const send = async () => {
    if (amountCents === null) {
      onInvalidAmount?.()
      return
    }
    if (check && !check.ok) return
    // Check again at the press: the price or the day may have moved since.
    const current = services.now()
    const late = checkAt(current)
    if (late && !late.ok) {
      setNow(current)
      return
    }
    sentAmount.current = amountCents
    // Tell the dialog in this press, so it cannot close before the effect
    // below reports the running tip.
    onPhaseChange?.('busy')
    const sent = await tip.send(amountCents)
    if (sent?.kind === 'accepted') onAccepted?.(sent.receiptId)
  }

  const titleId = `${id}-title`
  const limitId = `${id}-limit`

  // The notice announces itself (the kit's live region); the button's
  // description points at it.
  // States that need no tab section of their own: the wallet gate already
  // asks the reader to sign in or verify, and an off switch says nothing.
  if (availability.kind === 'gate' || availability.kind === 'unavailable') {
    return null
  }
  if (availability.kind === 'loading') {
    return <TabTipDialogSkeleton />
  }
  if (availability.kind === 'tab-none') {
    return (
      <p className="tip-tab-line">
        {TAB_TIP_DIALOG.noTab}{' '}
        <Link href={manageHref} className="tip-tab-link">
          {TAB_ACTIONS.open}
        </Link>
      </p>
    )
  }

  // The button's description: the notice's words once (the notice itself
  // also holds a live copy for the announcement).
  const reasonCopy =
    check && !check.ok
      ? check.reason === 'balance'
        ? NOTICE_COPY.insufficientTab(formatXlm(check.free))
        : limitCopy(check)
      : null
  const explain =
    check && !check.ok ? (
      check.reason === 'balance' ? (
        <PaymentNotice
          kind="insufficient-balance"
          source="tab"
          available={check.free}
          action={{ href: manageHref, label: TAB_ACTIONS.topUp }}
          announce
        />
      ) : (
        <PaymentNotice kind="refused" copy={limitCopy(check)!} announce />
      )
    ) : null

  return (
    <section className="tip-tab" aria-labelledby={titleId} data-phase={phase}>
      <div className="tip-tab-head">
        <h3 id={titleId} className="tip-tab-title">
          {TAB_TIP_DIALOG.heading}
        </h3>
        {ready ? (
          <span className="tip-tab-free">
            <XlmAmount amount={availability.free} /> {TAB_TIP_DIALOG.free}
          </span>
        ) : null}
      </div>

      {ready ? null : (
        <TabTipAvailabilityNotice
          availability={availability}
          manageHref={manageHref}
        />
      )}

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
            outcome?.kind === 'accepted' && onDone
              ? { onClick: onDone, label: TAB_TIP_DIALOG.done }
              : undefined
          }
        />
      ) : null}

      <TabTipOutcomeNotice
        refusal={refusal}
        outcome={outcome}
        free={ready ? availability.free : undefined}
        manageHref={manageHref}
      />

      {phase === 'ready' || phase === 'blocked' ? (
        <>
          <div className="tip-tab-limit">{explain}</div>
          {reasonCopy ? (
            <p id={limitId} hidden>
              {reasonCopy.title}. {reasonCopy.detail}
            </p>
          ) : null}
          <p className="tip-hint">{TAB_TIP.noPrompt}</p>
          <Button
            type="button"
            className="tip-primary"
            aria-disabled={(check !== null && !check.ok) || undefined}
            aria-describedby={reasonCopy ? limitId : undefined}
            onClick={() => void send()}
          >
            {amountCents === null
              ? TAB_TIP_DIALOG.heading
              : TAB_TIP_DIALOG.send(formatUsd(amountCents / 100))}
          </Button>
        </>
      ) : null}

      {phase === 'result' ? (
        <div className="tip-actions">
          {outcome?.kind === 'unconfirmed' && onDone ? (
            <Button type="button" className="tip-primary" onClick={onDone}>
              {TAB_TIP_DIALOG.done}
            </Button>
          ) : null}
          {outcome?.kind === 'unconfirmed' ? (
            <Link href={manageHref} className="tip-tab-link">
              {TAB_ACTIONS.manage}
            </Link>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="tip-v2-secondary"
              onClick={tip.reset}
            >
              {TAB_TIP.another}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  )
}
