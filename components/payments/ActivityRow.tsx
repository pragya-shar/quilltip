'use client'

/**
 * One tip in a list (view only). The row states the tip as the reader sent
 * it, in whole cents, on both screens. A tap opens the detail: what
 * happened to the money in plain words, the writer's exact share (never
 * floored), the exact token amount, and the public record once it is paid.
 */
import { useId, useState } from 'react'
import { ChevronDown, Clock } from 'lucide-react'
import { TX_LINK, statusCopy, whenCopy } from '@/lib/payments/copy'
import { formatMoney, formatTokenAmount } from '@/lib/payments/money'
import type { ActivityItem } from '@/lib/payments/types'

export function ActivityRow({
  item,
  now,
}: {
  item: ActivityItem
  now: number
}) {
  const [open, setOpen] = useState(false)
  const detailId = useId()
  const copy = statusCopy(item)
  const reader = item.role === 'reader'
  const amount = item.amount
  // Grey only for money that did not move: a tip paid in part keeps colour.
  const muted =
    item.status === 'sending' ||
    (item.status === 'not-paid' && item.paid.cents === 0)
  return (
    <li
      className="qt-row"
      data-status={item.status}
      data-lagging={item.lagging || undefined}
      data-request-id={item.requestId ?? undefined}
      data-testid="activity-row"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="qt-row-title">{item.article.title}</span>
        <span className="qt-row-amount" data-muted={muted}>
          {amount.display}
        </span>
        {item.passage ? <q className="qt-row-passage">{item.passage}</q> : null}
        <span className="qt-row-meta">
          <span className="qt-status" data-tone={copy.tone}>
            {item.status === 'sent' || item.status === 'sending' ? (
              <Clock aria-hidden size={13} />
            ) : null}
            {copy.label}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {reader ? `to ${item.counterparty.name}` : item.counterparty.name}
          </span>
          <span aria-hidden="true">·</span>
          <span>{whenCopy(item.at, now)}</span>
          <ChevronDown
            aria-hidden
            size={16}
            style={{
              marginInlineStart: 'auto',
              transform: open ? 'rotate(180deg)' : undefined,
            }}
          />
        </span>
      </button>
      {open ? (
        <div id={detailId} className="qt-row-detail">
          {copy.detail ? (
            <p style={{ margin: '0 0 0.5rem' }}>{copy.detail}</p>
          ) : null}
          <dl>
            <dt>Tip</dt>
            <dd>{item.amount.display}</dd>
            {!reader ? (
              <>
                <dt>Your earnings</dt>
                <dd data-testid="row-share">
                  {formatMoney(item.net.cents)} (you keep 97.5%)
                </dd>
              </>
            ) : null}
            {item.exact ? (
              <>
                <dt>Exact amount</dt>
                <dd>
                  {formatTokenAmount(
                    reader ? item.exact.gross : item.exact.net
                  )}
                </dd>
              </>
            ) : null}
            <dt>When</dt>
            <dd>{new Date(item.at).toLocaleString('en-US')}</dd>
            {item.txHash ? (
              <>
                <dt>Public record</dt>
                <dd>
                  <a
                    href={TX_LINK(item.txHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
                  </a>
                </dd>
              </>
            ) : null}
            {item.article.href ? (
              <>
                <dt>Article</dt>
                <dd>
                  <a href={item.article.href}>Read more</a>
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </li>
  )
}
