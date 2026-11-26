'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Clock,
  FileSearch,
  Hourglass,
  RotateCcw,
  Send,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  CHECKING_SLOW,
  FLOW_COPY,
  RESULT_COPY,
  RETRY_LABEL,
  STEP_COPY,
  TAB_TIP_SENDING,
  type CopyBlock,
} from '@/lib/copy/payment-states'
import { canRetry } from '@/lib/payments/ui-state'
import { cn } from '@/lib/utils'
import { ExplorerLink } from './ExplorerLink'
import { PaymentPanel } from './PaymentPanel'
import { PaymentSpinner } from './PaymentSpinner'
import { TransactionSteps } from './TransactionSteps'
import type {
  PaymentFailure,
  PaymentFlow,
  PaymentPhase,
  PaymentTone,
} from './payment-types'
import './payments.css'

interface TransactionProgressProps {
  flow: PaymentFlow
  phase: PaymentPhase
  /** Shown as an explorer link once known. */
  txHash?: string | null
  /** Shown only for `failed` and `expired`, never for any other phase. */
  onRetry?: () => void
  /** Copy for `failed`, from `failureFromWalletError` or `failureFromContract`. */
  failure?: PaymentFailure | null
  /** The server has not answered for a while (past `maxTime`). */
  slow?: boolean
  /** Extra content under a result, for example an unlock date. */
  resultDetail?: ReactNode
  headingLevel?: 2 | 3 | 4
  className?: string
}

type Running = 'simulating' | 'signing' | 'sending' | 'checking'
type Result = Exclude<PaymentPhase, Running>

const RUNNING = new Set<PaymentPhase>([
  'simulating',
  'signing',
  'sending',
  'checking',
])

const RESULT_LOOK: Record<Result, { tone: PaymentTone; icon: ReactNode }> = {
  confirmed: { tone: 'success', icon: <CircleCheck className="pay-check" /> },
  settled: { tone: 'success', icon: <CircleCheck className="pay-check" /> },
  'sent-to-registered': { tone: 'info', icon: <CircleCheck /> },
  accepted: { tone: 'info', icon: <Send /> },
  'under-review': { tone: 'warning', icon: <FileSearch /> },
  shortfall: { tone: 'warning', icon: <Hourglass /> },
  expired: { tone: 'warning', icon: <Clock /> },
  failed: { tone: 'danger', icon: <CircleAlert /> },
  unpaid: { tone: 'danger', icon: <CircleSlash /> },
  'void-reset': { tone: 'neutral', icon: <RotateCcw /> },
}

/** Results that need the user's attention are announced assertively. */
const ASSERTIVE = new Set<PaymentPhase>(['failed', 'expired'])

function resultCopy(
  flow: PaymentFlow,
  phase: Result,
  failure?: PaymentFailure | null
): CopyBlock {
  if (phase === 'confirmed' || phase === 'settled') {
    return FLOW_COPY[flow].confirmed
  }
  if (phase === 'failed' && failure) {
    return {
      title: failure.title,
      detail: failure.detail ?? RESULT_COPY.failed.detail,
    }
  }
  return RESULT_COPY[phase]
}

/**
 * Where a payment stands: the client steps (check, approve, send), the
 * server check, and each final state. Driven only by props; the caller maps
 * server statuses with `phaseFromRecord` or `phaseFromTabTip`.
 */
export function TransactionProgress({
  flow,
  phase,
  txHash,
  onRetry,
  failure,
  slow = false,
  resultDetail,
  headingLevel = 3,
  className,
}: TransactionProgressProps) {
  const running = RUNNING.has(phase)
  const result = running ? null : resultCopy(flow, phase as Result, failure)

  const sentence = running
    ? phase === 'checking' && slow
      ? `${CHECKING_SLOW.title}. ${CHECKING_SLOW.detail}`
      : flow === 'tab-tip'
        ? TAB_TIP_SENDING
        : STEP_COPY[phase as Running]
    : `${result!.title}. ${result!.detail}`

  // Two live regions, mounted from the start, so each change is read once:
  // polite for steps and good news, assertive for failed and expired.
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  // A result reached after mount gets the entrance. When focus would
  // otherwise be lost (the button that started the payment is gone), the
  // result title takes focus; the screen reader then reads the title and its
  // description, so the live regions stay quiet to avoid reading it twice.
  const root = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement & HTMLParagraphElement>(null)
  const previous = useRef<PaymentPhase | null>(null)
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const was = previous.current
    previous.current = phase
    let focused = false
    if (was !== null && was !== phase && !running) {
      setEntered(true)
      const active = document.activeElement
      const node = root.current
      if (!active || active === document.body || node?.contains(active)) {
        heading.current?.focus({ preventScroll: true })
        focused = document.activeElement === heading.current
      }
    }
    const text = focused ? '' : sentence
    if (ASSERTIVE.has(phase)) {
      setPolite('')
      setAssertive(text)
    } else {
      setAssertive('')
      setPolite(text)
    }
  }, [phase, sentence, running])

  const retry =
    canRetry(phase) && onRetry ? (
      <Button type="button" className="pay-action" onClick={onRetry}>
        {RETRY_LABEL}
      </Button>
    ) : null
  const link = txHash && !running ? <ExplorerLink hash={txHash} /> : null

  return (
    <div
      ref={root}
      className={cn('pay-progress', className)}
      data-phase={phase}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {polite}
      </p>
      <p className="sr-only" role="alert" aria-live="assertive">
        {assertive}
      </p>

      {running ? (
        flow === 'tab-tip' ? (
          <p className="pay-inline-status">
            <PaymentSpinner />
            {sentence}
          </p>
        ) : (
          <>
            <TransactionSteps current={phase as Running} />
            <p
              className="pay-progress-sentence"
              data-slow={slow && phase === 'checking' ? '' : undefined}
            >
              {phase === 'checking' && slow ? (
                <>
                  <strong>{CHECKING_SLOW.title}.</strong> {CHECKING_SLOW.detail}
                </>
              ) : (
                STEP_COPY[phase as Running]
              )}
            </p>
            {txHash ? <ExplorerLink hash={txHash} /> : null}
          </>
        )
      ) : (
        <PaymentPanel
          tone={RESULT_LOOK[phase as Result].tone}
          icon={RESULT_LOOK[phase as Result].icon}
          title={result!.title}
          headingLevel={headingLevel}
          titleRef={heading}
          enter={entered}
          data-state={phase}
          actions={
            retry || link ? (
              <>
                {retry}
                {link}
              </>
            ) : null
          }
        >
          <p>{result!.detail}</p>
          {resultDetail}
        </PaymentPanel>
      )}
    </div>
  )
}
