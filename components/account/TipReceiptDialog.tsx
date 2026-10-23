'use client'
import type { TipActivityItem } from '@/lib/account/tipActivity'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import Link from 'next/link'

export function tipStatusLabel(status: string) {
  const labels: Record<string, string> = {
    CONFIRMED: 'Confirmed',
    PENDING: 'Pending',
    CONFIRMING: 'Confirming',
    FAILED: 'Failed',
    FRAUDULENT: 'Rejected',
  }
  return labels[status] ?? `Unrecognized status (${status})`
}
export function recordedUsd(cents: number) {
  return Number.isSafeInteger(cents)
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(cents / 100)
    : 'Amount unavailable'
}
export function TipReceiptDialog({
  item,
  onClose,
  returnFocusTo,
}: {
  item: TipActivityItem | null
  onClose: () => void
  returnFocusTo?: HTMLElement | null
}) {
  const network =
    item?.stellarNetwork === 'MAINNET'
      ? 'public'
      : item?.stellarNetwork === 'TESTNET'
        ? 'testnet'
        : null
  return (
    <Dialog
      open={!!item}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {item && (
        <DialogContent
          className="account-dialog account-receipt"
          onCloseAutoFocus={(event) => {
            if (returnFocusTo?.isConnected) {
              event.preventDefault()
              returnFocusTo.focus()
            }
          }}
        >
          <DialogTitle>Tip receipt</DialogTitle>
          <DialogDescription className="account-muted">
            {tipStatusLabel(item.status)} ·{' '}
            {new Date(item.createdAt).toLocaleDateString('en-US', {
              dateStyle: 'long',
            })}
          </DialogDescription>
          <h3>{item.articleTitle}</h3>
          {item.kind === 'passage' && (
            <blockquote>{item.highlightText}</blockquote>
          )}
          <dl>
            <div>
              <dt>{item.direction === 'sent' ? 'To' : 'From'}</dt>
              <dd>{item.counterpart}</dd>
            </div>
            <div>
              <dt>Recorded tip</dt>
              <dd>{recordedUsd(item.amountCents)} USD equivalent</dd>
            </div>
            {item.amountUsdSuspicious && (
              <div>
                <dt>Amount check</dt>
                <dd>USD amount needs review</dd>
              </div>
            )}
            {item.stellarAmountXlm && (
              <div>
                <dt>XLM</dt>
                <dd>{item.stellarAmountXlm}</dd>
              </div>
            )}
            <div>
              <dt>Status</dt>
              <dd>{tipStatusLabel(item.status)}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>
                {item.stellarNetwork || 'Unavailable'}
                {item.stellarNetwork === 'TESTNET' && ' · Test funds'}
              </dd>
            </div>
            {item.stellarTxId && (
              <div>
                <dt>Transaction</dt>
                <dd>{item.stellarTxId}</dd>
              </div>
            )}
          </dl>
          {item.status !== 'CONFIRMED' && (
            <p className="account-muted">
              {item.status === 'PENDING' || item.status === 'CONFIRMING'
                ? 'This tip is awaiting verification. It is not a confirmed payment yet.'
                : 'This record does not represent a confirmed payment.'}
            </p>
          )}
          {item.failureReason && (
            <p className="account-notice">{item.failureReason}</p>
          )}
          {item.message && (
            <div className="account-receipt-note">
              <h4>A note with the tip</h4>
              <p>{item.message}</p>
            </div>
          )}
          <div className="account-address-actions">
            {network && item.stellarTxId && (
              <a
                className="account-text-link"
                href={`https://stellar.expert/explorer/${network}/tx/${encodeURIComponent(item.stellarTxId)}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
            )}
            {item.articleHref && (
              <Link className="account-text-link" href={item.articleHref}>
                Read article
              </Link>
            )}
            <button className="account-text-link" onClick={onClose}>
              Back to tip history
            </button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
