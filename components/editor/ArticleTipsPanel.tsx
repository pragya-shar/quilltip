'use client'

import Link from 'next/link'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import type { Id } from '@/convex/_generated/dataModel'
import {
  useArticleChainActions,
  type ArticleAction,
} from '@/hooks/useArticleChainActions'
import type { ArticleActionPhase } from '@/lib/stellar/v2/article-actions'
import {
  bpsToPercent,
  percentToBps,
  splitProblems,
  type Split,
} from '@/convex/lib/chain/splits'
import { ArticleTipsFailure } from './ArticleTipsFailure'
import { ArticleTipsMove } from './ArticleTipsMove'
import { ArticleTipsSplits, type SplitRow } from './ArticleTipsSplits'
import {
  articleTipsView,
  shortAddress,
  type PendingAction,
} from './articleTipsState'
import './article-tips.css'

const PHASE_COPY: Record<ArticleActionPhase, string> = {
  preparing: 'Preparing…',
  connecting: 'Connect your wallet to continue…',
  simulating: 'Checking with Stellar testnet…',
  signing: 'Approve the request in your wallet…',
  sending: 'Sending to Stellar testnet…',
  recording: 'Sending to Stellar testnet…',
}

const PENDING_COPY: Record<PendingAction, string> = {
  register: 'Enabling tips. Waiting for Stellar testnet to confirm.',
  content_update:
    'Updating the anchor. Waiting for Stellar testnet to confirm.',
  author_propose:
    'Recording the old wallet’s approval. Waiting for Stellar testnet to confirm.',
  author_accept: 'Finishing the move. Waiting for Stellar testnet to confirm.',
}

const RETRY_LABEL: Record<ArticleAction, string> = {
  register: 'Try again',
  content_update: 'Try the update again',
  author_propose: 'Try again',
  author_accept: 'Try again',
}

const EXPLORER = 'https://stellar.expert/explorer/testnet/tx/'

/**
 * Failures a second attempt cannot fix: the article is already registered,
 * or this site's settings do not match. Retrying would only fail again.
 */
const NO_RETRY_CODES = new Set(['AlreadyRegistered', 'CHECK', 'CONFIG'])

/** Announced when the panel reaches a state after an action. */
const ANNOUNCE: Record<string, string> = {
  'registered:none': 'Tips enabled for this article.',
  'registered:accept':
    'Old wallet approved. Approve with your new wallet next.',
  'registered:propose': 'Tips paused for the move to your new wallet.',
  review: 'The transaction needs a check before tips turn on.',
  not_registered: 'Tips are off for this article.',
}

const PERCENT_PROBLEMS = new Set(['NOT_POSITIVE', 'NOT_INTEGER'])

let rowCounter = 0
const newRow = (percent = ''): SplitRow => ({
  key: `row-${++rowCounter}`,
  recipient: '',
  percent,
})

/**
 * Tips on Stellar for one published article: enable tips (Core
 * registration, with optional co-author shares), update the content anchor,
 * and move the article to the author's new wallet. Renders nothing unless
 * payments v2 is enabled and the viewer is the author.
 */
export function ArticleTipsPanel({
  articleId,
  variant = 'page',
}: {
  articleId: Id<'articles'>
  variant?: 'page' | 'dialog'
}) {
  const headingId = useId()
  const actions = useArticleChainActions(articleId)
  const view = articleTipsView(actions.registration)
  const [sharing, setSharing] = useState(false)
  const [rows, setRows] = useState<SplitRow[]>(() => [newRow('100')])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [totalError, setTotalError] = useState<string | null>(null)
  const [validated, setValidated] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const failureRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // After an action the panel's content is replaced and the focused button
  // disappears. Move focus to the heading so keyboard and screen-reader
  // users keep their place, except on the first load.
  const stateKey =
    view.kind === 'registered' ? `registered:${view.move}` : view.kind
  const lastStateKey = useRef(stateKey)
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    const previous = lastStateKey.current
    lastStateKey.current = stateKey
    if (previous !== stateKey && previous !== 'loading') {
      headingRef.current?.focus()
      setAnnouncement(ANNOUNCE[stateKey] ?? '')
    }
  }, [stateKey])
  useEffect(() => {
    if (actions.failure) failureRef.current?.focus()
  }, [actions.failure])

  if (view.kind === 'hidden') return null

  const author = actions.registration?.wallet.address ?? ''
  const busy = actions.running !== null

  const toSplits = (list: SplitRow[] = rows): Split[] =>
    list.map((row, index) => ({
      recipient: index === 0 ? author : row.recipient,
      bps: percentToBps(row.percent) ?? Number.NaN,
    }))

  const validate = (list: SplitRow[] = rows): boolean => {
    if (!sharing) return true
    // Keys are `<row key>.recipient` or `<row key>.percent`.
    const nextErrors: Record<string, string> = {}
    let nextTotal: string | null = null
    list.forEach((row, index) => {
      if (index > 0 && !row.recipient) {
        nextErrors[`${row.key}.recipient`] =
          'Enter the co-author’s Stellar address.'
      }
      if (percentToBps(row.percent) === null) {
        nextErrors[`${row.key}.percent`] =
          'Enter a percentage, such as 25 or 12.5.'
      }
    })
    // Report every field problem in one pass. A total that cannot be
    // computed yet (a share is not a number) is left until the shares parse.
    const unparsedShare = Object.keys(nextErrors).some((key) =>
      key.endsWith('.percent')
    )
    for (const problem of splitProblems(toSplits(list), { author })) {
      const row = problem.index === undefined ? null : list[problem.index]
      const field = PERCENT_PROBLEMS.has(problem.code) ? 'percent' : 'recipient'
      const key = row ? `${row.key}.${field}` : null
      if (key && !nextErrors[key]) nextErrors[key] = problem.message
      else if (!row && !nextTotal && !unparsedShare) {
        nextTotal = problem.message
      }
    }
    setErrors(nextErrors)
    setTotalError(nextTotal)
    return Object.keys(nextErrors).length === 0 && !nextTotal
  }

  const start = (action: ArticleAction) => {
    void actions.run(action, {
      splits: action === 'register' && sharing ? toSplits() : undefined,
    })
  }

  const onEnable = (event: FormEvent) => {
    event.preventDefault()
    setValidated(true)
    if (!validate()) {
      // Take the user to the first field that needs a fix.
      const form = formRef.current
      requestAnimationFrame(() =>
        form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      )
      return
    }
    start('register')
  }

  const progress = actions.phase ? (
    <p className="tips-progress" role="status">
      <span className="tips-spinner" aria-hidden="true" />
      {PHASE_COPY[actions.phase]}
    </p>
  ) : null

  const failure = actions.failure ? (
    <ArticleTipsFailure
      focusRef={failureRef}
      message={actions.failure.message}
      retryLabel={
        NO_RETRY_CODES.has(actions.failure.code ?? '')
          ? null
          : RETRY_LABEL[actions.failure.action]
      }
      onRetry={() => {
        actions.dismissFailure()
        if (actions.failure!.action === 'register') {
          setValidated(true)
          if (!validate()) return
        }
        start(actions.failure!.action)
      }}
      onDismiss={actions.dismissFailure}
    />
  ) : null

  let body: ReactNode
  switch (view.kind) {
    case 'loading':
      body = (
        <p className="tips-muted" role="status">
          Checking tips for this article…
        </p>
      )
      break
    case 'no_wallet':
      body = (
        <>
          <p>
            Readers tip in XLM on Stellar testnet. Connect a receiving wallet
            first, then come back to enable tips.
          </p>
          <Link className="tips-link" href="/dashboard/wallet">
            Set up your receiving wallet
          </Link>
        </>
      )
      break
    case 'unverified':
      body = (
        <>
          <p>
            Verify your receiving wallet before you enable tips. It takes one
            signature and sends nothing.
          </p>
          <Link className="tips-link" href="/dashboard/wallet">
            Verify your wallet
          </Link>
        </>
      )
      break
    case 'not_registered':
      body = (
        <form
          ref={formRef}
          className="tips-form"
          onSubmit={onEnable}
          noValidate
        >
          <p>
            Register this article on Stellar testnet so readers can tip it. Tips
            go to <span translate="no">{shortAddress(author)}</span>
            {sharing ? ' and your co-authors' : ''}; Quilltip keeps 2.5%. You
            approve one transaction in your wallet.
          </p>
          {view.retry && !actions.failure && (
            <p className="tips-note">
              The last attempt did not finish. Nothing changed on Stellar.
            </p>
          )}
          <label className="tips-toggle">
            <input
              type="checkbox"
              checked={sharing}
              disabled={busy}
              onChange={(event) => {
                setSharing(event.target.checked)
                setErrors({})
                setTotalError(null)
                setValidated(false)
                if (event.target.checked && rows.length === 1) {
                  setRows([newRow('50'), newRow('50')])
                }
              }}
            />
            <span>Share tips with co-authors</span>
          </label>
          {sharing && (
            <ArticleTipsSplits
              author={author}
              rows={rows}
              errors={errors}
              totalError={totalError}
              disabled={busy}
              onChange={(key, field, value) => {
                const next = rows.map((row) =>
                  row.key === key ? { ...row, [field]: value } : row
                )
                setRows(next)
                // Once errors show, they clear as soon as the input is fixed.
                if (validated) validate(next)
              }}
              onAdd={() => setRows([...rows, newRow()])}
              onRemove={(key) => {
                const next = rows.filter((row) => row.key !== key)
                setRows(next)
                if (validated) validate(next)
              }}
            />
          )}
          <div className="tips-actions">
            <button
              type="submit"
              className={
                variant === 'dialog' ? 'tips-secondary' : 'tips-primary'
              }
              disabled={busy}
            >
              {actions.running === 'register'
                ? 'Enabling tips…'
                : 'Enable tips'}
            </button>
          </div>
        </form>
      )
      break
    case 'pending':
      body = (
        <>
          <p className="tips-progress" role="status">
            <span className="tips-spinner" aria-hidden="true" />
            {PENDING_COPY[view.action]}
          </p>
          <p className="tips-muted">
            This usually takes a few seconds. You can leave this page; it
            finishes without you.
          </p>
          {view.txHash && (
            <a
              className="tips-link"
              href={`${EXPLORER}${view.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View the transaction
              <span className="sr-only"> (opens in a new tab)</span>
              <span aria-hidden="true">&nbsp;↗</span>
            </a>
          )}
        </>
      )
      break
    case 'review':
      body = (
        <>
          <p className="tips-note">
            The transaction finished on Stellar testnet, but not as Quilltip
            expected. We are checking it, so there is nothing to retry. Tips
            stay off until the check is done.
          </p>
          {view.txHash && (
            <a
              className="tips-link"
              href={`${EXPLORER}${view.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View the transaction
              <span className="sr-only"> (opens in a new tab)</span>
              <span aria-hidden="true">&nbsp;↗</span>
            </a>
          )}
        </>
      )
      break
    case 'registered':
      body = (
        <>
          {view.move === 'none' ? (
            <p className="tips-on">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              Readers can tip this article.
            </p>
          ) : (
            <p className="tips-on tips-paused">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6v12M15 6v12" />
              </svg>
              Tips are paused until the move to your new wallet finishes.
            </p>
          )}
          {view.lastFailed && !actions.failure && (
            <p className="tips-note">
              The last change did not finish. Nothing changed on Stellar
              testnet.
            </p>
          )}
          <dl className="tips-facts">
            <div>
              <dt>Pays</dt>
              <dd translate="no">{shortAddress(view.authorAddress)}</dd>
            </div>
            {view.splits.length > 0 && (
              <div>
                <dt>Shares</dt>
                <dd>
                  {view.splits
                    .map(
                      (s, i) =>
                        `${i === 0 ? 'Author' : shortAddress(s.recipient)} ${bpsToPercent(s.bps)}%`
                    )
                    .join(', ')}
                </dd>
              </div>
            )}
            <div>
              <dt>Anchor</dt>
              <dd>Version {view.contentVersion}</dd>
            </div>
          </dl>
          {view.contentOutdated && view.move === 'none' && (
            <div className="tips-update">
              <p>
                This article changed after it was anchored. Update the anchor so
                tips record the current version.
              </p>
              <button
                type="button"
                className="tips-secondary"
                disabled={busy}
                onClick={() => start('content_update')}
              >
                {actions.running === 'content_update'
                  ? 'Updating…'
                  : 'Update the anchor'}
              </button>
            </div>
          )}
          {view.move !== 'none' && (
            <ArticleTipsMove
              step={view.move}
              from={view.authorAddress}
              to={actions.registration?.wallet.address ?? null}
              busy={busy}
              onApprove={() =>
                start(
                  view.move === 'propose' ? 'author_propose' : 'author_accept'
                )
              }
            />
          )}
          {view.txHash && (
            <a
              className="tips-link"
              href={`${EXPLORER}${view.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View the registration
              <span className="sr-only"> (opens in a new tab)</span>
              <span aria-hidden="true">&nbsp;↗</span>
            </a>
          )}
        </>
      )
      break
  }

  return (
    <section
      className={`article-tips article-tips--${variant}`}
      aria-labelledby={headingId}
      data-state={view.kind}
    >
      <h2 id={headingId} ref={headingRef} tabIndex={-1}>
        Tips <span className="tips-network">Stellar testnet</span>
      </h2>
      {/* Stays mounted, empty until an action changes the state, so the
          result is announced once and not read twice on a normal load. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {body}
      {progress}
      {failure}
    </section>
  )
}
