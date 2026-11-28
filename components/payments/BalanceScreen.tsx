'use client'

/**
 * The reader's balance (view only): what a tip can use now, then the tips,
 * newest first. A tip is final when the server accepts it; when one does
 * not complete, its row says what came back, so the figure never rises
 * without a reason on screen.
 */
import { Plus } from 'lucide-react'
import { formatTokenAmount } from '@/lib/payments/money'
import type { ActivityView, BalanceView } from '@/lib/payments/types'
import { ActivityList } from './ActivityList'
import './balance.css'

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
  const unavailable = balance.status === 'unavailable'
  return (
    <div className="qt-pay qt-screen" data-testid="balance-screen">
      {balance.available ? (
        <p className="qt-figure" data-testid="balance-available">
          {balance.available.display}
        </p>
      ) : loading ? (
        <span
          className="qt-skeleton qt-figure-skeleton"
          aria-label="Loading your balance"
        />
      ) : balance.exact ? (
        <>
          <p className="qt-figure" data-testid="balance-available">
            {formatTokenAmount(balance.exact.available)}
          </p>
          <p className="qt-notice" role="status" data-testid="balance-no-price">
            Dollar amounts are not available right now, so tipping is paused.
          </p>
        </>
      ) : null}
      <h1 className="qt-figure-label">Ready to tip</h1>
      <p className="qt-testnet">Testnet. Practice money only.</p>
      {unavailable ? (
        <p
          className="qt-notice"
          role="status"
          data-testid="balance-unavailable"
        >
          Your balance is unavailable right now. It comes back on its own;
          reading is not affected.
        </p>
      ) : null}
      {!balance.online ? (
        <p className="qt-figure-note" role="status">
          You are offline. These figures may be out of date.
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
      {!loading && !unavailable ? (
        <div className="qt-actions">
          <a className="qt-button" href={ADD_MONEY_HREF}>
            <Plus aria-hidden size={18} className="qt-button-icon" />
            Add money
          </a>
        </div>
      ) : null}
      <ActivityList
        activity={activity}
        now={now}
        title="Activity"
        empty="Your tips show up here."
      />
    </div>
  )
}
