'use client'

import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'

const FIELDS = [
  ['tipper', 'Payer'],
  ['author', 'Payee'],
  ['token', 'Token'],
  ['gross', 'Gross'],
  ['fee', 'Fee'],
  ['net', 'Net'],
  ['articleKey', 'Article ID'],
  ['highlightKey', 'Highlight ID'],
  ['clientRef', 'Client ref'],
] as const

function show(value: string | null | undefined): string {
  return value === null || value === undefined ? '—' : value
}

/**
 * Payments flagged for review, with the expected values next to the values
 * decoded from the transaction. Operators only; the query returns null to
 * everyone else.
 */
export function FlaggedTipsReview() {
  const flagged = useQuery(api.chain.review.getFlaggedTips, {})
  if (!flagged) return null

  return (
    <section className="ops-review" aria-labelledby="ops-review-title">
      <h2 id="ops-review-title">Payments flagged for review</h2>
      {flagged.rows.length === 0 ? (
        <p className="account-muted">No payment needs review.</p>
      ) : (
        flagged.rows.map((row) => (
          <article key={row.id} className="ops-review-item">
            <h3>
              {row.mismatchReason ?? 'Flagged'} · {row.status}
            </h3>
            <p className="ops-chain-note">
              {row.table} {row.id}
              {row.txHash ? ` · transaction ${row.txHash}` : ''}
              {row.creditable
                ? ' · can be credited from the decoded values'
                : ''}
            </p>
            <div className="ops-review-scroll">
              <table className="ops-review-table">
                <caption className="sr-only">
                  Expected and on-chain values for {row.id}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Expected</th>
                    <th scope="col">On chain</th>
                  </tr>
                </thead>
                <tbody>
                  {FIELDS.map(([key, label]) => {
                    const expected =
                      key in row.expected
                        ? row.expected[key as keyof typeof row.expected]
                        : undefined
                    const decoded = row.decoded ? row.decoded[key] : undefined
                    const differs = row.differing.includes(key)
                    return (
                      <tr key={key} data-differs={differs || undefined}>
                        <th scope="row">
                          {label}
                          {differs ? (
                            <span className="ops-review-flag"> differs</span>
                          ) : null}
                        </th>
                        <td>{show(expected)}</td>
                        <td>
                          {row.decoded ? show(decoded) : 'No Tipped event'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </article>
        ))
      )}
    </section>
  )
}
