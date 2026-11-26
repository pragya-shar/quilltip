'use client'

import { useId } from 'react'
import {
  MAX_SPLIT_RECIPIENTS,
  bpsToPercent,
  percentToBps,
} from '@/convex/lib/chain/splits'
import { shortAddress } from './articleTipsState'

export type SplitRow = { key: string; recipient: string; percent: string }

/**
 * Co-author shares for registration. The first row is the author and is
 * fixed; each co-author row has a Stellar address and a percentage.
 */
export function ArticleTipsSplits({
  author,
  rows,
  errors,
  totalError,
  disabled,
  onChange,
  onAdd,
  onRemove,
}: {
  author: string
  rows: SplitRow[]
  /** Error text per row key. */
  errors: Record<string, string>
  totalError: string | null
  disabled: boolean
  onChange: (key: string, field: 'recipient' | 'percent', value: string) => void
  onAdd: () => void
  onRemove: (key: string) => void
}) {
  const id = useId()
  const total = rows.reduce(
    (sum, row) => sum + (percentToBps(row.percent) ?? 0),
    0
  )
  return (
    <fieldset className="tips-splits" disabled={disabled}>
      <legend>Shares of each tip, after the 2.5% fee</legend>
      <ul>
        {rows.map((row, index) => {
          const error = errors[row.key]
          const errorId = `${id}-${row.key}-error`
          const isAuthor = index === 0
          return (
            <li key={row.key} className="tips-split-row">
              <div className="tips-split-who">
                {isAuthor ? (
                  <>
                    <span
                      className="tips-split-label"
                      id={`${id}-${row.key}-who`}
                    >
                      You
                    </span>
                    <span className="tips-split-address" translate="no">
                      {shortAddress(author)}
                    </span>
                  </>
                ) : (
                  <>
                    <label
                      className="tips-split-label"
                      htmlFor={`${id}-${row.key}-address`}
                    >
                      Co-author {index}’s Stellar address
                    </label>
                    <input
                      id={`${id}-${row.key}-address`}
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      data-1p-ignore
                      data-lpignore="true"
                      placeholder="G…"
                      value={row.recipient}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      onChange={(event) =>
                        onChange(
                          row.key,
                          'recipient',
                          event.target.value.trim()
                        )
                      }
                    />
                  </>
                )}
              </div>
              <div className="tips-split-share">
                <label htmlFor={`${id}-${row.key}-percent`} className="sr-only">
                  {isAuthor ? 'Your share' : `Co-author ${index}’s share`},
                  percent
                </label>
                <input
                  id={`${id}-${row.key}-percent`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={row.percent}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(event) =>
                    onChange(row.key, 'percent', event.target.value)
                  }
                />
                <span aria-hidden="true">%</span>
                {!isAuthor && (
                  <button
                    type="button"
                    className="tips-split-remove"
                    aria-label={`Remove co-author ${index}`}
                    onClick={() => onRemove(row.key)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                )}
              </div>
              {error && (
                <p className="tips-field-error" id={errorId}>
                  {error}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <div className="tips-split-footer">
        {rows.length < MAX_SPLIT_RECIPIENTS ? (
          <button type="button" className="tips-text-button" onClick={onAdd}>
            Add a co-author
          </button>
        ) : (
          <span className="tips-muted">Up to 4 co-authors.</span>
        )}
        <span
          className={`tips-split-total${totalError ? ' is-error' : ''}`}
          aria-live="polite"
        >
          Total {bpsToPercent(total)}%
        </span>
      </div>
      {totalError && (
        <p className="tips-field-error" role="alert">
          {totalError}
        </p>
      )}
    </fieldset>
  )
}
