'use client'

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  FileSearch,
  Hourglass,
  RotateCcw,
  Send,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  CANCEL_LABEL,
  CHECKING_SLOW,
  DONE_LABEL,
  FAILED_COPY_BY_FLOW,
  FLOW_COPY,
  HELP_LABEL,
  PROGRESS_HEADING,
  REFERENCE_LABEL,
  RESULT_COPY,
  RESUMING_COPY,
  RETRY_LABEL,
  SIGNING_HELP,
  STEP_COPY,
  TAB_OPERATION_RESULT,
  TAB_TIP_RESULT,
  TAB_TIP_SENDING,
  basketConfirmed,
  tabCloseConfirmed,
  type CopyBlock,
} from '@/lib/copy/payment-states'
import {
  deriveProgress,
  isRunning,
  type ProgressSource,
  type RunningPhase,
} from '@/lib/payments/ui-state'
import type { PaymentFailure } from '@/lib/payments/failures'
import { cn } from '@/lib/utils'
import { focusLost } from './focus'
import { ExplorerLink } from './ExplorerLink'
import { NoticeActionButton } from './NoticeActionButton'
import { PaymentPanel } from './PaymentPanel'
import { PaymentSpinner } from './PaymentSpinner'
import { TestnetLabel } from './TestnetLabel'
import { TransactionSteps } from './TransactionSteps'
import { XlmAmount } from './XlmAmount'
import type {
  BaseUnits,
  NoticeAction,
  PaymentFlow,
  PaymentPhase,
  PaymentTone,
} from './payment-types'
import './payments.css'

interface TransactionProgressProps {
  flow: PaymentFlow
  /**
   * Where the phase comes from: a server record, a tab tip, a tab operation
   * with the indexed tab state, or a client step before a record exists.
   * The view derives the phase, so no flow can pass `confirmed` itself.
   */
  source: ProgressSource
  /** Reader or writer, for tab tip results. */
  audience?: 'reader' | 'writer'
  /** Shown as an explorer link for phases that have a transaction. */
  txHash?: string | null
  /**
   * Shown only when the record allows a retry (`FAILED` or `EXPIRED`, not
   * under review) and `retryAllowed` is not false.
   */
  onRetry?: () => void
  /** `resolvePaymentView().canRetry`: false while a pause or gate blocks it. */
  retryAllowed?: boolean
  /**
   * The view mounted because the user just pressed the start action. Only
   * then may it take focus and announce its first step at mount; a view that
   * renders with the page (a reload, a pending payment) leaves focus alone.
   */
  startedByUser?: boolean
  /** Offered while the wallet prompt is open. Client only: nothing is signed. */
  onCancel?: () => void
  /** Copy for `failed`, from `viewFromTxOutcome` or `failureFromContract`. */
  failure?: PaymentFailure | null
  /** The server has not answered for a while (past `maxTime`). */
  slow?: boolean
  /** "1 XLM to Ada Lovelace" under the result title. */
  summary?: { amount: BaseUnits; to?: string }
  /** Record ID shown with an under-review result. */
  reference?: string
  /** Help page for an under-review or rejected result. */
  helpHref?: string
  /** Where the result shows later, for example "your tab". */
  resultPlace?: string
  /** Formatted unlock date for a confirmed tab close. */
  unlocksAround?: string
  /** The one next step after a result with no retry, for example "Done". */
  doneAction?: NoticeAction
  /** Extra content under a result. */
  resultDetail?: ReactNode
  headingLevel?: 2 | 3 | 4 | 5 | 6
  className?: string
}

type Result = Exclude<PaymentPhase, RunningPhase>

const RESULT_LOOK: Record<Result, { tone: PaymentTone; icon: ReactNode }> = {
  confirmed: { tone: 'success', icon: <CircleCheck className="pay-check" /> },
  settled: { tone: 'success', icon: <CircleCheck className="pay-check" /> },
  'sent-to-registered': { tone: 'info', icon: <CircleCheck /> },
  accepted: { tone: 'info', icon: <Send /> },
  'under-review': { tone: 'warning', icon: <FileSearch /> },
  rejected: { tone: 'warning', icon: <FileSearch /> },
  shortfall: { tone: 'warning', icon: <Hourglass /> },
  expired: { tone: 'warning', icon: <Clock /> },
  declined: { tone: 'warning', icon: <CircleX /> },
  failed: { tone: 'danger', icon: <CircleAlert /> },
  unpaid: { tone: 'danger', icon: <CircleSlash /> },
  'void-reset': { tone: 'neutral', icon: <RotateCcw /> },
}

/** Results that need the user's attention are announced assertively. */
const ASSERTIVE = new Set<PaymentPhase>(['failed', 'expired', 'declined'])

/** Phases with a transaction of their own, which the explorer can show. */
const HAS_TRANSACTION = new Set<PaymentPhase>([
  'checking',
  'confirmed',
  'sent-to-registered',
  'under-review',
  'failed',
  'expired',
  'settled',
])

function resultCopy(
  flow: PaymentFlow,
  phase: Result,
  options: {
    failure?: PaymentFailure | null
    audience: 'reader' | 'writer'
    redirected: number
    unlocksAround?: string
    tabOperation: boolean
  }
): CopyBlock {
  // Without a failure from the flow, a tab operation's failure is known only
  // from the client's own polling. A failure the flow passes (send refused,
  // network busy) is more specific and wins.
  const flowFailure = phase === 'failed' && !!options.failure
  if (
    options.tabOperation &&
    !flowFailure &&
    (phase === 'failed' || phase === 'expired')
  ) {
    return TAB_OPERATION_RESULT[phase]
  }
  switch (phase) {
    case 'confirmed':
      if (flow === 'tip-basket') return basketConfirmed(options.redirected)
      if (flow === 'tab-close' && options.unlocksAround) {
        return tabCloseConfirmed(options.unlocksAround)
      }
      return FLOW_COPY[flow]
    case 'settled':
      return FLOW_COPY[flow === 'settle-own' ? 'settle-own' : 'tab-tip']
    case 'unpaid':
    case 'rejected':
      return TAB_TIP_RESULT[phase][options.audience]
    case 'failed':
      return (
        options.failure ??
        (flow === 'nft-mint' || flow === 'nft-transfer'
          ? FAILED_COPY_BY_FLOW[flow]
          : RESULT_COPY.failed)
      )
    default:
      return RESULT_COPY[phase]
  }
}

function runningSentence(
  flow: PaymentFlow,
  phase: RunningPhase,
  slow: boolean,
  place?: string
): string {
  if (phase === 'resuming') return RESUMING_COPY
  if (flow === 'tab-tip') return TAB_TIP_SENDING
  if (phase === 'checking') {
    return slow
      ? `${CHECKING_SLOW.title}. ${CHECKING_SLOW.detail}`
      : STEP_COPY.checking(place)
  }
  return STEP_COPY[phase]
}

/**
 * Where a payment stands: the client steps (prepare, approve, send), the
 * server check, and each final state.
 */
export function TransactionProgress({
  flow,
  source,
  audience = 'reader',
  txHash,
  onRetry,
  retryAllowed = true,
  startedByUser = false,
  onCancel,
  failure,
  slow = false,
  summary,
  reference,
  helpHref,
  resultPlace,
  unlocksAround,
  doneAction,
  resultDetail,
  headingLevel = 3,
  className,
}: TransactionProgressProps) {
  const { phase, retry, redirected } = deriveProgress(source)
  const running = isRunning(phase)
  const result = running
    ? null
    : resultCopy(flow, phase as Result, {
        failure,
        audience,
        redirected,
        unlocksAround,
        tabOperation: 'tabOperation' in source,
      })
  const sentence = running
    ? runningSentence(flow, phase as RunningPhase, slow, resultPlace)
    : `${result!.title}. ${result!.detail}`

  const root = useRef<HTMLDivElement>(null)
  const progressHeading = useRef<HTMLHeadingElement>(null)
  const resultHeading = useRef<HTMLHeadingElement & HTMLParagraphElement>(null)
  const sentenceId = useId()
  const previous = useRef<PaymentPhase | null>(null)
  /** The phase whose text a focused heading already reads. */
  const quiet = useRef<PaymentPhase | null>(null)
  const [entered, setEntered] = useState(false)
  // Read once: only the first render can be a start the user just made.
  const startedAtMount = useRef(startedByUser)

  // Focus. While a payment runs, focus a hidden heading at the top when it
  // would otherwise fall to the page (the start or "Try again" button is
  // gone). When a result arrives, focus its title the same way. A focused
  // heading reads its text as the description, so the live regions skip it.
  useLayoutEffect(() => {
    const was = previous.current
    previous.current = phase
    if (was === phase) return
    const node = root.current
    let target: HTMLElement | null = null
    // At mount, only a step the user just started takes focus; a payment
    // already running when the page loads (a reload, a pending tab
    // operation) leaves focus where it is.
    const started = was === null ? startedAtMount.current : !isRunning(was)
    if (running && started) {
      target = progressHeading.current
    } else if (!running && was !== null) {
      setEntered(true)
      target = resultHeading.current
    }
    if (target && focusLost(node)) {
      target.focus({ preventScroll: true })
      if (document.activeElement === target) quiet.current = phase
    }
  }, [phase, running])

  // Two live regions, mounted empty, so each change is read once: polite
  // for steps and good news, assertive for failures. A state already there
  // at load is not announced (it is read with the page).
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  const baseline = useRef<string | null>(sentence)
  useEffect(() => {
    const atMount = baseline.current !== null && sentence === baseline.current
    if (atMount && !(startedAtMount.current && isRunning(phase))) return
    baseline.current = null
    const text = quiet.current === phase ? '' : sentence
    const apply = () => {
      if (ASSERTIVE.has(phase)) {
        setPolite('')
        setAssertive(text)
      } else {
        setAssertive('')
        setPolite(text)
      }
    }
    if (!atMount) return apply()
    const timer = setTimeout(apply, 120)
    return () => clearTimeout(timer)
  }, [phase, sentence])

  const showRetry = retry && retryAllowed && !!onRetry
  const link =
    txHash && HAS_TRANSACTION.has(phase) ? <ExplorerLink hash={txHash} /> : null

  const meta =
    summary || link ? (
      <p className="pay-result-meta">
        {summary ? (
          <span className="pay-result-summary">
            <XlmAmount amount={summary.amount} />
            {summary.to ? <> to {summary.to}</> : null}
          </span>
        ) : null}
        <TestnetLabel />
      </p>
    ) : null

  const inReview = phase === 'under-review' || phase === 'rejected'
  const review =
    inReview && reference ? (
      <p className="pay-result-reference">
        {REFERENCE_LABEL}: <code>{reference}</code>
      </p>
    ) : null
  const help =
    inReview && helpHref ? (
      <a className="pay-link" href={helpHref}>
        {HELP_LABEL}
      </a>
    ) : null

  const ProgressHeading = `h${headingLevel}` as const
  const actions = showRetry ? (
    <Button type="button" className="pay-action" onClick={onRetry}>
      {RETRY_LABEL}
    </Button>
  ) : doneAction ? (
    <NoticeActionButton
      action={doneAction}
      label={doneAction.label ?? DONE_LABEL}
      emphasis="primary"
    />
  ) : null

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
        <>
          <ProgressHeading
            ref={progressHeading}
            className="sr-only pay-progress-heading"
            tabIndex={-1}
            aria-describedby={sentenceId}
          >
            {PROGRESS_HEADING}
          </ProgressHeading>
          {flow === 'tab-tip' || phase === 'resuming' ? (
            <p className="pay-inline-status" id={sentenceId}>
              <PaymentSpinner />
              {sentence}
            </p>
          ) : (
            <>
              <TransactionSteps
                current={phase as Exclude<RunningPhase, 'resuming'>}
              />
              <p
                className="pay-progress-sentence"
                id={sentenceId}
                data-slow={slow && phase === 'checking' ? '' : undefined}
              >
                {phase === 'checking' && slow ? (
                  <>
                    <strong>{CHECKING_SLOW.title}.</strong>{' '}
                    {CHECKING_SLOW.detail}
                  </>
                ) : (
                  sentence
                )}
              </p>
              {phase === 'signing' ? (
                <div className="pay-signing">
                  <p className="pay-signing-help">{SIGNING_HELP}</p>
                  {onCancel ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="pay-action"
                      onClick={onCancel}
                    >
                      {CANCEL_LABEL}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {link ? (
                <p className="pay-result-meta">
                  {link}
                  <TestnetLabel />
                </p>
              ) : null}
            </>
          )}
        </>
      ) : (
        <PaymentPanel
          tone={RESULT_LOOK[phase as Result].tone}
          icon={RESULT_LOOK[phase as Result].icon}
          title={result!.title}
          headingLevel={headingLevel}
          titleRef={resultHeading}
          enter={entered}
          data-state={phase}
          actions={
            actions || link || help ? (
              <>
                {actions}
                {help}
                {link}
              </>
            ) : null
          }
        >
          {meta}
          <p>{result!.detail}</p>
          {review}
          {resultDetail}
        </PaymentPanel>
      )}
    </div>
  )
}
