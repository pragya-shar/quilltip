'use client'

/**
 * The reader's balance (view only): what a tip can use now, then the tips,
 * newest first. A tip leaves the figure the moment it is sent and returns
 * only when it did not go through.
 */
import type { ActivityView, BalanceView } from '@/lib/payments/types'
import { ActivityList } from './ActivityList'
import './payments.css'

const ADD_MONEY_HREF = '/dashboard/tab'

export function BalanceScreen({
  balance,
  activity,
  now,
}: {
  balance: BalanceView
  activity: ActivityView
  now: number
}) {
  const loading = balance.status === 'loading'
  return (
    <div className="qt-pay qt-screen" data-testid="balance-screen">
      <h1 className="qt-figure-label">Ready to tip</h1>
      {loading ? (
        <span
          className="qt-skeleton"
          style={{ width: '60%', height: 80, marginTop: 8 }}
          aria-label="Loading your balance"
        />
      ) : (
        <p className="qt-figure" data-testid="balance-available">
          {balance.available.display}
        </p>
      )}
      {!balance.online ? (
        <p className="qt-figure-note" role="status">
          You are offline. These figures may be out of date.
        </p>
      ) : null}
      {balance.status === 'ready' && balance.pending.cents > 0 ? (
        <p className="qt-figure-note" data-testid="balance-pending">
          {balance.pending.display} in tips is on its way to writers.
        </p>
      ) : null}
      {balance.status === 'closing' ? (
        <p className="qt-notice">
          Your balance is being withdrawn. New tips start again after you add
          money.
        </p>
      ) : null}
      {balance.status === 'none' ? (
        <p className="qt-notice">Add money once, then tip with one tap.</p>
      ) : null}
      {balance.status === 'ready' && balance.device === 'needs-setup' ? (
        <p className="qt-notice">
          Set up this device once to tip with one tap.
        </p>
      ) : null}
      {!loading ? (
        <div className="qt-actions">
          <a className="qt-button" href={ADD_MONEY_HREF}>
            Add money
          </a>
          <span className="qt-testnet">Testnet. Practice money only.</span>
        </div>
      ) : null}
      <ActivityList
        activity={activity}
        now={now}
        title="Your tips"
        empty="Your tips show up here."
      />
    </div>
  )
}
