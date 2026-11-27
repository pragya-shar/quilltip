'use client'

/**
 * The writer's earnings (view only): ready to withdraw (paid out and
 * collectable now) as the figure, what is on its way beside it, and what
 * was already paid to the wallet as history. A tip whose payout did not
 * complete is in none of them; its row says what arrived and what did not.
 */
import { Clock } from 'lucide-react'
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
  const unavailable = earnings.status === 'unavailable'
  return (
    <div className="qt-pay qt-screen" data-testid="earnings-screen">
      {loading ? (
        <span
          className="qt-skeleton"
          style={{ width: '60%', height: 80 }}
          aria-label="Loading your earnings"
        />
      ) : unavailable ? null : (
        <p className="qt-figure" data-testid="earnings-available">
          {earnings.available.display}
        </p>
      )}
      <h1 className="qt-figure-label">Ready to withdraw</h1>
      <p className="qt-testnet">Testnet. Practice money only.</p>
      {unavailable ? (
        <p
          className="qt-notice"
          role="status"
          data-testid="earnings-unavailable"
        >
          Your earnings are unavailable right now. They come back on their own;
          nothing is lost.
        </p>
      ) : null}
      {earnings.exact && earnings.available.cents > 0 ? (
        <p className="qt-figure-note">
          Exact amount {formatTokenAmount(earnings.exact.available)}
        </p>
      ) : null}
      <dl className="qt-lines">
        <div>
          <dt>On its way</dt>
          <dd data-testid="earnings-pending">{earnings.pending.display}</dd>
        </div>
        <div className="qt-history">
          <dt>Paid to your wallet</dt>
          <dd data-testid="earnings-collected">{earnings.collected.display}</dd>
        </div>
      </dl>
      {earnings.lagging ? (
        <p
          className="qt-notice qt-neutral"
          role="status"
          data-testid="earnings-lagging"
        >
          <Clock aria-hidden size={16} />
          Some tips are taking longer than usual. They stay On its way until
          they arrive.
        </p>
      ) : null}
      {earnings.counts.onHold > 0 ? (
        <p className="qt-notice qt-neutral" data-testid="earnings-on-hold">
          {tipsCount(earnings.counts.onHold)} on hold, waiting on a
          reader&apos;s balance.
        </p>
      ) : null}
      {earnings.counts.notPaid > 0 ? (
        <p className="qt-notice qt-neutral" data-testid="earnings-not-paid">
          {tipsCount(earnings.counts.notPaid)} did not complete. Each row says
          what arrived.
        </p>
      ) : null}
      <p className="qt-figure-note">You keep 97.5% of every tip.</p>
      <ActivityList
        activity={activity}
        now={now}
        title="Recent tips"
        empty="Tips you receive show up here."
      />
    </div>
  )
}
