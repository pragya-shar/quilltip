'use client'
import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { TipActivityItem } from '@/lib/account/tipActivity'
import {
  recordedUsd,
  TipReceiptDialog,
  tipStatusLabel,
} from './TipReceiptDialog'

type Filter = 'all' | 'received' | 'sent'
export function WalletTipHistory({ items }: { items: TipActivityItem[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(20)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [returnFocusTo, setReturnFocusTo] = useState<HTMLElement | null>(null)
  const sentIds = new Set(
    items
      .filter((item) => item.direction === 'sent')
      .map((item) => `${item.kind}:${item.id}`)
  )
  const rows =
    filter === 'all'
      ? items.filter(
          (item) =>
            item.direction === 'sent' || !sentIds.has(`${item.kind}:${item.id}`)
        )
      : items.filter((item) => item.direction === filter)
  const selected = items.find((item) => item.key === selectedKey) ?? null
  return (
    <section
      className="account-tip-history"
      aria-labelledby="tip-history-title"
    >
      <h2 id="tip-history-title">Tip history</h2>
      <div
        className="account-history-filters"
        role="group"
        aria-label="Tip direction"
      >
        {(['all', 'received', 'sent'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value)
              setLimit(20)
            }}
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      {rows.length ? (
        <ul className="account-tip-list">
          {rows.slice(0, limit).map((item) => (
            <li className="account-tip-row" key={item.key}>
              <div className="account-tip-person">
                <h3>
                  {item.direction === 'sent' ? 'To' : 'From'} {item.counterpart}
                </h3>
                <p>{item.articleTitle}</p>
                {item.amountUsdSuspicious && (
                  <p className="account-amount-notice">
                    USD amount needs review
                  </p>
                )}
              </div>
              <time dateTime={new Date(item.createdAt).toISOString()}>
                {new Date(item.createdAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </time>
              <div className="account-tip-amount">
                <strong>{recordedUsd(item.amountCents)}</strong>
                <span>
                  {item.status === 'CONFIRMED'
                    ? item.direction === 'sent'
                      ? 'Sent'
                      : 'Received'
                    : tipStatusLabel(item.status)}
                </span>
                {item.stellarNetwork === 'TESTNET' && <span>Testnet</span>}
              </div>
              <button
                className="account-text-link"
                aria-label={`Receipt for ${item.articleTitle}, ${item.direction === 'sent' ? 'to' : 'from'} ${item.counterpart}`}
                onClick={(event) => {
                  setReturnFocusTo(event.currentTarget)
                  setSelectedKey(item.key)
                }}
              >
                Receipt <ArrowRight size={22} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="account-empty">
          <h3>
            {filter === 'all' ? 'No tips yet.' : `No ${filter} tips yet.`}
          </h3>
          <p>
            {filter === 'received'
              ? 'Tips to your writing will appear here once confirmed.'
              : 'Your tip activity will appear here.'}
          </p>
        </div>
      )}
      {rows.length > 0 && (
        <div className="account-history-bottom">
          <p>
            {Math.min(limit, rows.length)} of {rows.length} tips · Amounts are
            recorded USD equivalents.
          </p>
          {rows.length > limit && (
            <button
              className="account-text-link"
              onClick={() => setLimit((value) => value + 20)}
            >
              Show more
            </button>
          )}
        </div>
      )}
      <TipReceiptDialog
        item={selected}
        onClose={() => setSelectedKey(null)}
        returnFocusTo={returnFocusTo}
      />
    </section>
  )
}
