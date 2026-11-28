'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  CircleAlert,
  CircleCheck,
  Clock,
  Gauge,
  KeyRound,
  PauseCircle,
  Milestone,
  Wallet,
  WifiOff,
} from 'lucide-react'
import { TipsUnavailableNote } from '@/components/tipping/TipsUnavailableNote'
import {
  NOTICE_ACTION,
  NOTICE_COPY,
  type CopyBlock,
} from '@/lib/copy/payment-states'
import { formatXlm } from '@/lib/payments/format'
import { cn } from '@/lib/utils'
import { focusLost } from './focus'
import { NoticeActionButton } from './NoticeActionButton'
import { PaymentPanel } from './PaymentPanel'
import { TestnetLabel } from './TestnetLabel'
import { useAnnouncement } from './useAnnouncement'
import type {
  NoticeAction,
  PaymentNoticeProps,
  PaymentTone,
} from './payment-types'
import './payments.css'

type Look = {
  tone: PaymentTone
  icon: ReactNode
  copy: CopyBlock
  action?: NoticeAction
  defaultLabel?: string
  /** The action is the one next step on its surface. */
  primary?: boolean
  /** The notice shows an amount, so it carries the testnet label. */
  amount?: boolean
}

type PanelNotice = Exclude<PaymentNoticeProps, { kind: 'tips-unavailable' }>

function look(props: PanelNotice): Look {
  switch (props.kind) {
    case 'paused':
      return {
        tone: 'warning',
        icon: <PauseCircle />,
        copy: props.copy ?? NOTICE_COPY.paused[props.audience ?? 'reader'],
      }
    case 'insufficient-balance':
      return props.source === 'wallet'
        ? {
            tone: 'warning',
            icon: <Wallet />,
            copy: NOTICE_COPY.insufficientWallet(
              props.needed ? formatXlm(props.needed) : undefined,
              props.available ? formatXlm(props.available) : undefined
            ),
            action: props.action,
            defaultLabel: NOTICE_ACTION.insufficientWallet,
            amount: !!(props.needed && props.available),
          }
        : {
            tone: 'warning',
            icon: <Wallet />,
            copy: props.short
              ? NOTICE_COPY.tabShort(formatXlm(props.short))
              : NOTICE_COPY.insufficientTab(
                  props.available ? formatXlm(props.available) : undefined
                ),
            action: props.action,
            defaultLabel: NOTICE_ACTION.insufficientTab,
            primary: true,
            amount: !!(props.available || props.short),
          }
    case 'session-key-none':
      return {
        tone: 'info',
        icon: <KeyRound />,
        copy: NOTICE_COPY.sessionKeyNone,
        action: props.action,
        defaultLabel: NOTICE_ACTION.sessionKey,
        primary: true,
      }
    case 'session-key-missing':
      return {
        tone: 'info',
        icon: <KeyRound />,
        copy: NOTICE_COPY.sessionKeyMissing,
        action: props.action,
        defaultLabel: NOTICE_ACTION.sessionKey,
        primary: true,
      }
    case 'session-key-expired':
      return {
        tone: 'info',
        icon: <KeyRound />,
        copy: NOTICE_COPY.sessionKeyExpired,
        action: props.action,
        defaultLabel: NOTICE_ACTION.sessionKeyExpired,
        primary: true,
      }
    case 'key-limit':
      return {
        tone: 'info',
        icon: <Gauge />,
        copy: NOTICE_COPY.keyLimit,
        action: props.action,
        defaultLabel: NOTICE_ACTION.sessionKey,
      }
    case 'daily-limit':
      return {
        tone: 'info',
        icon: <Gauge />,
        copy: NOTICE_COPY.dailyLimit,
        action: props.action,
        defaultLabel: NOTICE_ACTION.tipFromWallet,
      }
    case 'tab-none':
      return {
        tone: 'info',
        icon: <Wallet />,
        copy: NOTICE_COPY.tabNone,
        action: props.action,
        defaultLabel: NOTICE_ACTION.openTab,
      }
    case 'tab-closing':
      return {
        tone: 'info',
        icon: <Clock />,
        copy: NOTICE_COPY.tabClosing,
        action: props.action,
        defaultLabel: NOTICE_ACTION.tipFromWallet,
      }
    case 'settlement-delayed':
      return {
        tone: 'info',
        icon: <Clock />,
        copy:
          props.audience === 'writer'
            ? NOTICE_COPY.settlementDelayedWriter
            : NOTICE_COPY.settlementDelayedReader,
        // Only writers hold a voucher they can settle themselves.
        action: props.audience === 'writer' ? props.action : undefined,
        defaultLabel: NOTICE_ACTION.settleOwn,
      }
    case 'basket-item-unavailable':
      return {
        tone: 'warning',
        icon: <CircleAlert />,
        copy: NOTICE_COPY.basketItemUnavailable,
        action: props.action,
        defaultLabel: NOTICE_ACTION.removeItem,
      }
    case 'withdrawal-pending':
      return {
        tone: 'info',
        icon: <Clock />,
        copy: NOTICE_COPY.withdrawalPending(props.unlockDate),
      }
    case 'withdrawal-ready':
      return {
        tone: 'success',
        icon: <CircleCheck />,
        copy: NOTICE_COPY.withdrawalReady,
        action: props.action,
        defaultLabel: props.amount
          ? `${NOTICE_ACTION.withdraw} ${formatXlm(props.amount)}`
          : NOTICE_ACTION.withdraw,
        primary: true,
        amount: !!props.amount,
      }
    case 'close-tab-warning':
      return {
        tone: 'info',
        icon: <Clock />,
        copy: NOTICE_COPY.closeTabWarning,
        action: props.action,
      }
    case 'nft-threshold':
      return {
        tone: 'neutral',
        icon: <Milestone />,
        copy: NOTICE_COPY.nftThreshold(
          formatXlm(props.tipped),
          formatXlm(props.threshold)
        ),
        amount: true,
      }
    case 'network-busy':
      return {
        tone: 'warning',
        icon: <WifiOff />,
        copy: NOTICE_COPY.networkBusy,
      }
    case 'refused':
      return {
        tone: 'warning',
        icon: <CircleAlert />,
        copy: props.copy,
      }
  }
}

/**
 * Standing conditions around a payment: paused contract, short balance,
 * quick-tip key states and limits, slow settlement, tips unavailable, the
 * tab withdrawal wait and Convex refusals.
 */
export function PaymentNotice(props: PaymentNoticeProps) {
  const item = props.kind === 'tips-unavailable' ? null : look(props)
  const message = item ? `${item.copy.title}. ${item.copy.detail}` : ''
  const root = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLHeadingElement & HTMLParagraphElement>(null)
  // An announced notice appears because of the reader's action. Its title
  // takes focus when nothing more specific holds it, for example after the
  // progress it replaced had focus; the focused title then reads the notice,
  // so the live region stays empty. Only at mount: later changes are read by
  // the live region.
  const [titleFocused, setTitleFocused] = useState(false)
  useLayoutEffect(() => {
    if (!props.announce || !title.current) return
    if (!focusLost(root.current)) return
    title.current.focus({ preventScroll: true })
    if (document.activeElement === title.current) setTitleFocused(true)
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const live = useAnnouncement(message, {
    announceOnMount: props.announce && !titleFocused,
  })

  if (props.kind === 'tips-unavailable') {
    const label = props.action?.label ?? NOTICE_ACTION.tipFromWallet
    return (
      <div
        className={cn('pay-note', props.className)}
        data-state={`tips-unavailable-${props.reason}`}
      >
        <TipsUnavailableNote reason={props.reason} />
        {props.action && props.reason === 'splits' ? (
          <NoticeActionButton action={props.action} label={label} />
        ) : null}
      </div>
    )
  }

  const label = item!.action?.label ?? item!.defaultLabel
  return (
    <div
      ref={root}
      className={cn('pay-notice', props.className)}
      data-state={props.kind}
    >
      {/* Mounted empty: a region created with its text is often not read. */}
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
      <PaymentPanel
        tone={item!.tone}
        icon={item!.icon}
        title={item!.copy.title}
        // An announced notice is a heading wherever focus was.
        headingLevel={props.announce ? (props.headingLevel ?? 3) : undefined}
        titleRef={title}
        actions={
          item!.action && label ? (
            <NoticeActionButton
              action={item!.action}
              label={label}
              emphasis={item!.primary ? 'primary' : 'secondary'}
            />
          ) : null
        }
      >
        {item!.amount ? (
          <p className="pay-result-meta">
            <TestnetLabel />
          </p>
        ) : null}
        <p>{item!.copy.detail}</p>
      </PaymentPanel>
    </div>
  )
}
