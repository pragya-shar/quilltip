'use client'

import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { PaymentNotice } from '@/components/payments'
import { TAB_ACTIONS, TAB_CLOSE } from '@/lib/copy/tab'
import {
  closeUnlockEstimate,
  type TabStatusView,
} from '@/lib/tab-ui/tab-status'
import type { LedgerClock } from '@/lib/tab-ui/types'

type TabCloseSectionProps = {
  status: Extract<TabStatusView, { kind: 'open' | 'closing' }>
  /** Confirmed tab balance, what a withdrawal pays out. */
  balance: string
  clock: LedgerClock | null
  busy: boolean
  onClose: () => void
  onWithdraw: () => void
}

/**
 * Close the tab and withdraw (05-flows-and-admin.md, section 5.9). Before
 * the reader commits, it states the waiting period and the date it ends,
 * estimated from ledgers and labelled as an estimate.
 */
export function TabCloseSection({
  status,
  balance,
  clock,
  busy,
  onClose,
  onWithdraw,
}: TabCloseSectionProps) {
  const [confirming, setConfirming] = useState(false)
  const confirmRef = useRef<HTMLHeadingElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const opened = useRef(false)
  useEffect(() => {
    if (confirming) {
      opened.current = true
      confirmRef.current?.focus()
    } else if (opened.current) {
      // Back from the confirmation: focus returns to "Close tab".
      opened.current = false
      closeRef.current?.focus()
    }
  }, [confirming])

  if (status.kind === 'open') {
    const estimate = closeUnlockEstimate(clock)
    return (
      <section className="tab-section" aria-labelledby="tab-close-title">
        <header>
          <h2 id="tab-close-title" className="tab-section-title">
            {TAB_CLOSE.heading}
          </h2>
          <p>{TAB_CLOSE.intro}</p>
        </header>
        {confirming ? (
          <div
            className="tab-form"
            role="group"
            aria-labelledby="tab-close-confirm"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setConfirming(false)
            }}
          >
            <h3
              id="tab-close-confirm"
              ref={confirmRef}
              tabIndex={-1}
              className="tab-form-title"
            >
              {TAB_CLOSE.confirmTitle}
            </h3>
            <p>{TAB_CLOSE.confirmDetail(estimate?.day ?? null)}</p>
            <p className="tab-subtle">{TAB_CLOSE.estimate}</p>
            <div className="tab-actions">
              <button
                type="button"
                className="tab-primary"
                disabled={busy}
                onClick={() => {
                  // The payment view takes focus from here, not "Close tab".
                  opened.current = false
                  setConfirming(false)
                  onClose()
                }}
              >
                {TAB_ACTIONS.confirmClose}
              </button>
              <button
                type="button"
                className="tab-secondary"
                onClick={() => setConfirming(false)}
              >
                {TAB_ACTIONS.keepOpen}
              </button>
            </div>
          </div>
        ) : (
          <div className="tab-actions">
            <button
              ref={closeRef}
              type="button"
              className="tab-secondary"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              {TAB_ACTIONS.closeTab}
            </button>
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="tab-section" aria-labelledby="tab-close-title">
      <header>
        <h2 id="tab-close-title" className="tab-section-title">
          {TAB_CLOSE.heading}
        </h2>
      </header>
      <ol className="tab-timeline" aria-label={TAB_CLOSE.timelineLabel}>
        <li data-done="">
          <span className="tab-timeline-mark" aria-hidden="true">
            <Check />
          </span>
          <div>
            <strong>{TAB_CLOSE.started}</strong>
          </div>
        </li>
        <li {...(status.ready ? { 'data-done': '' } : {})}>
          <span className="tab-timeline-mark" aria-hidden="true">
            {status.ready ? <Check /> : null}
          </span>
          <div>
            <strong>
              {status.ready
                ? TAB_CLOSE.ready
                : TAB_CLOSE.unlocks(status.unlocksAround)}
            </strong>
            {status.ready ? null : (
              <p className="tab-subtle">{TAB_CLOSE.estimate}</p>
            )}
          </div>
        </li>
      </ol>
      {status.ready ? (
        BigInt(balance) > BigInt(0) ? (
          <PaymentNotice
            kind="withdrawal-ready"
            amount={balance}
            action={busy ? undefined : { onClick: onWithdraw }}
          />
        ) : (
          <p className="tab-subtle">{TAB_CLOSE.nothingLeft}</p>
        )
      ) : (
        <PaymentNotice
          kind="withdrawal-pending"
          unlockDate={status.unlocksAround ?? undefined}
        />
      )}
    </section>
  )
}
