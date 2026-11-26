'use client'

import { shortAddress } from './articleTipsState'

/**
 * Moving an article to the author's new wallet: two approvals, one per
 * wallet (Core `propose_author`, then `accept_author`).
 */
export function ArticleTipsMove({
  step,
  from,
  to,
  busy,
  onApprove,
}: {
  step: 'propose' | 'accept'
  from: string
  to: string | null
  busy: boolean
  onApprove: () => void
}) {
  return (
    <div className="tips-move">
      <p className="tips-move-title">
        Tips for this article still go to{' '}
        <span translate="no">{shortAddress(from)}</span>
      </p>
      <p>
        {to ? (
          <>
            Your receiving wallet is now{' '}
            <span translate="no">{shortAddress(to)}</span>.{' '}
          </>
        ) : null}
        Moving the article takes two approvals, one from each wallet.
      </p>
      <ol className="tips-steps">
        <li aria-current={step === 'propose' ? 'step' : undefined}>
          <span>Approve with the old wallet</span>
          {step === 'accept' && <span className="tips-step-done"> Done</span>}
        </li>
        <li aria-current={step === 'accept' ? 'step' : undefined}>
          <span>Approve with your new wallet within 7 days</span>
        </li>
      </ol>
      <button
        type="button"
        className="tips-primary"
        disabled={busy}
        onClick={onApprove}
      >
        {step === 'propose'
          ? `Approve with ${shortAddress(from)}`
          : `Approve with ${to ? shortAddress(to) : 'your new wallet'}`}
      </button>
    </div>
  )
}
