import type { ReactNode } from 'react'
import {
  CircleAlert,
  CircleCheck,
  Clock,
  KeyRound,
  PauseCircle,
  Wallet,
  WifiOff,
} from 'lucide-react'
import {
  NOTICE_ACTION,
  NOTICE_COPY,
  type CopyBlock,
} from '@/lib/copy/payment-states'
import { formatXlm } from '@/lib/payments/format'
import { cn } from '@/lib/utils'
import { NoticeActionButton } from './NoticeActionButton'
import { PaymentPanel } from './PaymentPanel'
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
}

function look(props: PaymentNoticeProps): Look | null {
  switch (props.kind) {
    case 'paused':
      return {
        tone: 'warning',
        icon: <PauseCircle />,
        copy: NOTICE_COPY.paused,
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
          }
        : {
            tone: 'warning',
            icon: <Wallet />,
            copy: NOTICE_COPY.insufficientTab(
              props.available ? formatXlm(props.available) : undefined
            ),
            action: props.action,
            defaultLabel: NOTICE_ACTION.insufficientTab,
          }
    case 'session-key-missing':
      return {
        tone: 'info',
        icon: <KeyRound />,
        copy: NOTICE_COPY.sessionKeyMissing,
        action: props.action,
        defaultLabel: NOTICE_ACTION.sessionKey,
      }
    case 'session-key-expired':
      return {
        tone: 'info',
        icon: <KeyRound />,
        copy: NOTICE_COPY.sessionKeyExpired,
        action: props.action,
        defaultLabel: NOTICE_ACTION.sessionKeyExpired,
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
      }
    case 'network-busy':
      return {
        tone: 'warning',
        icon: <WifiOff />,
        copy: NOTICE_COPY.networkBusy,
      }
    case 'tips-unavailable':
      return null
  }
}

/**
 * Standing conditions around a payment: paused contract, short balance,
 * missing or expired quick-tip key, slow settlement, tips unavailable, and
 * the tab withdrawal wait. Announced politely when they appear.
 */
export function PaymentNotice(props: PaymentNoticeProps) {
  if (props.kind === 'tips-unavailable') {
    const text = NOTICE_COPY.tipsUnavailable[props.reason]
    const label = props.action?.label ?? NOTICE_ACTION.splits
    return (
      <div
        className={cn('pay-note', props.className)}
        data-state={`tips-unavailable-${props.reason}`}
      >
        <p role="status">
          <CircleAlert aria-hidden="true" />
          {text}
        </p>
        {props.action && props.reason === 'splits' ? (
          <NoticeActionButton action={props.action} label={label} />
        ) : null}
      </div>
    )
  }

  const item = look(props)!
  const label = item.action?.label ?? item.defaultLabel
  return (
    <PaymentPanel
      tone={item.tone}
      icon={item.icon}
      title={item.copy.title}
      role="status"
      className={props.className}
      data-state={props.kind}
      actions={
        item.action && label ? (
          <NoticeActionButton action={item.action} label={label} />
        ) : null
      }
    >
      <p>{item.copy.detail}</p>
    </PaymentPanel>
  )
}
