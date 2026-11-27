'use client'

/**
 * The writer's earnings (view only): available (paid out and collectable
 * now) as the figure, pending ("on its way") and collected beside it, and
 * each tip with its state. A tip whose payout failed is in none of the
 * three, and says why.
 */
import { tipsCount } from '@/lib/payments/copy'
import { formatTokenAmount } from '@/lib/payments/money'
import type { ActivityView, EarningsView } from '@/lib/payments/types'
import { ActivityList } from './ActivityList'
import './balance.css'

export function EarningsScreen({
  earnings,
  activity,
  now,
}: {
  earnings: EarningsView
  activity: ActivityView
  now: number
}) {
  const loading = earnings.status === 'loading'
  return (
    <div className="qt-pay qt-screen" data-testid="earnings-screen">
      <h1 className="qt-figure-label">Available</h1>
      {loading ? (
        <span
          className="qt-skeleton"
          style={{ width: '60%', height: 80, marginTop: 8 }}
          aria-label="Loading your earnings"
        />
      ) : (
        <p className="qt-figure" data-testid="earnings-available">
          {earnings.available.display}
        </p>
      )}
      {earnings.exact && earnings.available.cents > 0 ? (
        <p className="qt-figure-note">
          Paid out to you and ready to collect ·{' '}
          {formatTokenAmount(earnings.exact.available)}
        </p>
      ) : null}
      <dl className="qt-pair">
        <div>
          <dt>On its way</dt>
          <dd data-testid="earnings-pending">{earnings.pending.display}</dd>
        </div>
        <div>
          <dt>In your wallet</dt>
          <dd data-testid="earnings-collected">{earnings.collected.display}</dd>
        </div>
      </dl>
      {earnings.lagging ? (
        <p className="qt-notice" role="status" data-testid="earnings-lagging">
          Some tips are taking longer than usual. They are recorded and will be
          ready to collect. Nothing for you to do.
        </p>
      ) : null}
      {earnings.counts.onHold > 0 ? (
        <p
          className="qt-notice"
          data-tone="danger"
          data-testid="earnings-on-hold"
        >
          {tipsCount(earnings.counts.onHold)} on hold ({earnings.onHold.display}
          ). The reader&apos;s balance ran short; they are paid if the reader
          adds money.
        </p>
      ) : null}
      {earnings.counts.notPaid > 0 ? (
        <p
          className="qt-notice"
          data-tone="danger"
          data-testid="earnings-not-paid"
        >
          {tipsCount(earnings.counts.notPaid)} did not complete (
          {earnings.notPaid.display}). No one was charged for them.
        </p>
      ) : null}
      <p className="qt-figure-note">You keep 97.5% of every tip.</p>
      <ActivityList
        activity={activity}
        now={now}
        title="Tips"
        empty="Tips you receive show up here."
      />
    </div>
  )
}
