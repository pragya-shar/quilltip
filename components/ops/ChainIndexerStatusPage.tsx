'use client'

import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useAuth } from '@/components/providers/AuthContext'
import { TabReadinessDetail } from './TabReadinessDetail'
import { useRedirectWhenUnauthenticated } from '@/hooks/useRedirectWhenUnauthenticated'
import { AccountSurface } from '@/components/account/AccountSurface'
import { FlaggedTipsReview } from './FlaggedTipsReview'
import { OpsSignalItems } from './OpsSignalItems'
import { OutsideTabActivityReview } from './OutsideTabActivityReview'
import { StaleReservesReview } from './StaleReservesReview'

function formatTime(seconds: number | null | undefined): string {
  if (!seconds) return '—'
  return new Date(seconds * 1000).toISOString().replace('.000Z', 'Z')
}

/**
 * Payments v2 indexer status for operators listed in `OPS_USER_IDS`.
 * Everyone else sees that the page is not available; the query returns
 * nothing to them.
 */
export function ChainIndexerStatusPage() {
  const { isAuthenticated, isLoading } = useAuth()
  useRedirectWhenUnauthenticated(isLoading, isAuthenticated)
  const status = useQuery(
    api.chain.indexer.getIndexerStatus,
    isAuthenticated ? {} : 'skip'
  )
  const outside = useQuery(
    api.chain.tabOutside.getOutsideTabActivity,
    isAuthenticated ? {} : 'skip'
  )
  const settler = useQuery(
    api.chain.settlerStatus.getSettlerFreshness,
    isAuthenticated ? {} : 'skip'
  )
  const now = Date.now()

  if (!isAuthenticated && !isLoading) return null
  // Before the first run that reaches the latest ledger nothing is covered.
  const covered = !!status?.cursor && status.cursor.lastLedger > 0

  return (
    <AccountSurface>
      <section className="ops-chain" aria-labelledby="ops-chain-title">
        <header className="account-heading">
          <h1 id="ops-chain-title">Chain indexer</h1>
          <p>Payments v2 event indexer on Stellar testnet.</p>
        </header>

        {status === undefined ? (
          <p role="status" className="account-muted">
            Loading indexer status.
          </p>
        ) : status === null ? (
          <p className="account-muted">
            This page is available to operators only.
          </p>
        ) : (
          <>
            <dl className="ops-chain-grid">
              <div className="ops-chain-item">
                <dt>Status</dt>
                <dd data-status={status.cursor?.status ?? 'NOT_STARTED'}>
                  {status.cursor?.status ?? 'Not started'}
                </dd>
                {status.cursor?.statusReason ? (
                  <dd className="ops-chain-note">
                    {status.cursor.statusReason}
                  </dd>
                ) : null}
              </div>
              <div className="ops-chain-item">
                <dt>Lag</dt>
                <dd>
                  {covered ? `${status.cursor!.lagLedgers} ledgers` : '—'}
                </dd>
              </div>
              <div className="ops-chain-item">
                <dt>Last indexed ledger</dt>
                <dd>{covered ? status.cursor!.lastLedger : 'None yet'}</dd>
                {covered ? (
                  <dd className="ops-chain-note">
                    {formatTime(status.cursor!.lastLedgerCloseTime)}
                  </dd>
                ) : null}
              </div>
              <div className="ops-chain-item">
                <dt>Latest / oldest ledger</dt>
                <dd>
                  {status.cursor
                    ? `${status.cursor.latestLedger} / ${status.cursor.oldestLedger}`
                    : '—'}
                </dd>
              </div>
              <div className="ops-chain-item">
                <dt>Events pending / orphan / error</dt>
                <dd>
                  {status.events.pending} / {status.events.orphan} /{' '}
                  {status.events.error}
                </dd>
                <dd className="ops-chain-note">
                  Counts stop at {status.events.sampleLimit}.
                </dd>
              </div>
              <div className="ops-chain-item">
                <dt>Open submissions / needs review</dt>
                <dd>
                  {status.submissions.open} / {status.submissions.needsReview}
                </dd>
              </div>
              <OpsSignalItems outside={outside} settler={settler} now={now} />
            </dl>

            <dl className="ops-chain-details">
              <dt>Epoch</dt>
              <dd>{status.chainEpoch}</dd>
              <dt>Start ledger</dt>
              <dd>{status.startLedger ?? 'Not set'}</dd>
              <dt>Core</dt>
              <dd>{status.contracts.core ?? 'Not set'}</dd>
              <dt>Tab</dt>
              <dd>{status.contracts.tab ?? 'Not set'}</dd>
              <TabReadinessDetail />
              <dt>NFT</dt>
              <dd>{status.contracts.nft ?? 'Not set'}</dd>
              <dt>Lease</dt>
              <dd>{status.leaseHeld ? 'A run is active' : 'Idle'}</dd>
              <dt>Last run</dt>
              <dd>
                {status.cursor?.lastRunAt
                  ? new Date(status.cursor.lastRunAt).toISOString()
                  : '—'}
              </dd>
              <dt>Last error</dt>
              <dd>{status.cursor?.lastError ?? 'None'}</dd>
            </dl>
            <OutsideTabActivityReview />
            <FlaggedTipsReview />
            <StaleReservesReview />
          </>
        )}
      </section>
    </AccountSurface>
  )
}
