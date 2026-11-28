import { formatXlmFromStroops } from '@/lib/copy/network-status'
import { explorerTxUrl } from '@/lib/payments/format'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '@/convex/_generated/api'
import { RUNBOOK_URL, formatAge } from './opsAge'

export type OutsideTabActivity = NonNullable<
  FunctionReturnType<typeof api.chain.tabOutside.getOutsideTabActivity>
>

const KIND_LABELS: Record<string, string> = {
  settled_no_voucher: 'Settled, no voucher here',
  settled_above_accepted: 'Settled above the accepted amount',
  settled_no_account: 'Settled, no account here',
  key_undeclared: 'Key not declared in the app',
}

function signer(byWriter: boolean | null): string {
  if (byWriter === null) return '—'
  return byWriter ? 'Acceptor' : 'Settler'
}

/** The open records of tab activity not accepted here, oldest first. */
export function OutsideTabActivityList({
  outside,
  now,
}: {
  outside: OutsideTabActivity
  now: number
}) {
  return (
    <section className="ops-review" aria-labelledby="ops-outside-title">
      <h2 id="ops-outside-title">Tab activity not accepted here</h2>
      <p className="ops-chain-note ops-review-lead">
        Tab events that this deployment did not originate. Balances already
        include them. Check and close each one by the{' '}
        <a href={`${RUNBOOK_URL}#tab-activity-not-accepted-here`}>
          runbook entry
        </a>
        .
      </p>
      {outside.rows.length === 0 ? (
        <p className="account-muted">No open record.</p>
      ) : (
        <div
          className="ops-review-scroll"
          role="region"
          aria-labelledby="ops-outside-title"
        >
          <table className="ops-review-table ops-outside-table">
            <caption className="sr-only">
              Open records of tab activity not accepted here, oldest first
            </caption>
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Age</th>
                <th scope="col">Account</th>
                <th scope="col">Key</th>
                <th scope="col">Gross</th>
                <th scope="col">Signed by</th>
                <th scope="col">Ledger</th>
                <th scope="col">Event</th>
                <th scope="col">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {outside.rows.map((row) => (
                <tr key={`${row.chainEpoch}:${row.eventId}`}>
                  <td>
                    {KIND_LABELS[row.kind] ?? row.kind}
                    <code className="ops-review-code ops-outside-kind">
                      {row.kind}
                    </code>
                    {row.kind === 'settled_above_accepted' ? (
                      <span className="ops-review-code">
                        {formatXlmFromStroops(row.cumulative ?? '0')} against{' '}
                        {formatXlmFromStroops(row.acceptedCumulative ?? '0')}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <time dateTime={new Date(row.createdAt).toISOString()}>
                      {formatAge(now - row.createdAt)}
                    </time>
                  </td>
                  <td>
                    {row.tabAccountId ? (
                      <code>{row.tabAccountId}</code>
                    ) : (
                      'None'
                    )}
                  </td>
                  <td>{row.keyId}</td>
                  <td>{row.gross ? formatXlmFromStroops(row.gross) : '—'}</td>
                  <td>{signer(row.byWriter)}</td>
                  <td>{row.ledger}</td>
                  <td>
                    <code>{row.eventId}</code>
                  </td>
                  <td>
                    <a
                      href={explorerTxUrl(row.txHash)}
                      title={`${row.txHash} on the testnet explorer`}
                    >
                      <code>
                        {row.txHash.slice(0, 8)}…{row.txHash.slice(-8)}
                      </code>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {outside.more ? (
        <p className="ops-chain-note">
          Showing the oldest {outside.limit}. List the rest with{' '}
          <code>chain/tabOutside:listOpen</code>.
        </p>
      ) : null}
    </section>
  )
}
