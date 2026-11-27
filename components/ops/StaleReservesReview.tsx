'use client'

import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'

/**
 * Tab accounts whose settlement reserve has stayed above 0 for more than an
 * hour: a `TabSettled` the indexer has not applied. The correction is in
 * docs/operations/chain-runbook.md. Operators only; the query returns null
 * to everyone else.
 */
export function StaleReservesReview() {
  const stale = useQuery(api.chain.tabReconcile.getStaleReserves, {})
  if (!stale) return null
  const hours = Math.round(stale.olderThanMs / 3_600_000)

  return (
    <section className="ops-review" aria-labelledby="ops-reserves-title">
      <h2 id="ops-reserves-title">Settlement reserves without their event</h2>
      {stale.rows.length === 0 ? (
        <p className="account-muted">
          No tab has held a settled amount for more than {hours} hour
          {hours === 1 ? '' : 's'}.
        </p>
      ) : (
        stale.rows.map((row) => (
          <article key={row.tabAccountId} className="ops-review-item">
            <h3>
              {row.readerAddress} · {row.status}
            </h3>
            <p className="ops-chain-note">
              {row.settledUnindexed} base units reserved since{' '}
              {row.since
                ? new Date(row.since).toISOString()
                : 'an unknown time'}
              {` · balance ledger ${row.balanceLedger ?? 'unknown'}`}
            </p>
            <div className="ops-review-scroll">
              <table className="ops-review-table">
                <caption className="sr-only">
                  Pairs with settled amounts not yet indexed for{' '}
                  {row.readerAddress}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">Writer</th>
                    <th scope="col">Paid</th>
                    <th scope="col">Not indexed</th>
                    <th scope="col">Paid by ledger</th>
                  </tr>
                </thead>
                <tbody>
                  {row.pairs.map((pair) => (
                    <tr key={`${pair.keyId}:${pair.writerAddress}`}>
                      <td>{pair.keyId}</td>
                      <td>{pair.writerAddress}</td>
                      <td>{pair.paidOnChain}</td>
                      <td>{pair.unindexed}</td>
                      <td>{pair.paidLedger ?? 'Unknown'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))
      )}
    </section>
  )
}
