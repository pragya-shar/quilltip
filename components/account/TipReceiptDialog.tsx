'use client'
import type { TipActivityItem } from '@/lib/account/tipActivity'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import Link from 'next/link'
import { ARTICLE_LINK_PREFETCH } from '@/lib/articles/linkPrefetch'
import {
  RESULT_COPY,
  STATUS_LABEL,
  TAB_TIP_RESULT,
} from '@/lib/copy/payment-states'
import { TAB_HISTORY } from '@/lib/copy/tab'

/**
 * A row's status in words. v1 statuses keep their labels; v2 statuses use
 * the payment state kit's (`STATUS_LABEL`), as the tip flows show them.
 */
export function tipStatusLabel(status: string, mismatchReason?: string) {
  const labels: Record<string, string> = {
    CONFIRMED: 'Confirmed',
    PENDING: 'Pending',
    CONFIRMING: 'Confirming',
    FAILED: 'Failed',
    FRAUDULENT: 'Rejected',
    UNVERIFIED: 'Not verified',
    // v2
    PREPARED: STATUS_LABEL.sending,
    SUBMITTED: STATUS_LABEL.checking,
    MISMATCH:
      mismatchReason === 'author'
        ? STATUS_LABEL['sent-to-registered']
        : STATUS_LABEL['under-review'],
    EXPIRED: STATUS_LABEL.expired,
    // Tab tip receipts (TAB_RECEIPT_STATUSES)
    ACCEPTED: STATUS_LABEL.accepted,
    SETTLED: STATUS_LABEL.settled,
    SHORTFALL: STATUS_LABEL.shortfall,
    UNPAID: STATUS_LABEL.unpaid,
    REJECTED: STATUS_LABEL.rejected,
    VOID_RESET: STATUS_LABEL['void-reset'],
  }
  return labels[status] ?? `Unrecognized status (${status})`
}

/**
 * "Testnet v1" for a row recorded with the earlier contracts
 * (docs/operations/payments-v2-cutover.md, sections 4.1 and 7.1).
 */
export function tipGenerationLabel(
  item: Pick<TipActivityItem, 'contractVersion' | 'stellarNetwork'>
): string | null {
  return item.contractVersion === 'v1' && item.stellarNetwork !== 'MAINNET'
    ? 'Testnet v1'
    : null
}

/** What a receipt says about a row that is not a confirmed payment. */
export function receiptStatusNote(
  item: Pick<TipActivityItem, 'status' | 'mismatchReason'> & {
    direction?: TipActivityItem['direction']
  }
): string | null {
  const audience = item.direction === 'received' ? 'writer' : 'reader'
  switch (item.status) {
    case 'CONFIRMED':
    case 'SETTLED':
      return null
    // Tab tip receipts: accepted without a wallet prompt, settled later.
    case 'ACCEPTED':
      return `Sent from a tab and not settled yet. ${TAB_HISTORY.accepted}.`
    case 'SHORTFALL':
      return RESULT_COPY.shortfall.detail
    case 'UNPAID':
    case 'REJECTED':
      return TAB_TIP_RESULT[item.status === 'UNPAID' ? 'unpaid' : 'rejected'][
        audience
      ].detail
    case 'VOID_RESET':
      return RESULT_COPY['void-reset'].detail
    case 'PENDING':
    case 'CONFIRMING':
    case 'PREPARED':
    case 'SUBMITTED':
      return 'This tip is awaiting verification. It is not a confirmed payment yet.'
    case 'MISMATCH':
      return item.mismatchReason === 'author'
        ? RESULT_COPY['sent-to-registered'].detail
        : RESULT_COPY['under-review'].detail
    case 'EXPIRED':
      return 'Stellar testnet did not include it in time, so nothing was paid.'
    default:
      return 'This record does not represent a confirmed payment.'
  }
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
            {tipStatusLabel(item.status, item.mismatchReason)} ·{' '}
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
              <dd>{tipStatusLabel(item.status, item.mismatchReason)}</dd>
            </div>
            {tipGenerationLabel(item) && (
              <div>
                <dt>Contract</dt>
                <dd>{tipGenerationLabel(item)}</dd>
              </div>
            )}
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
          {receiptStatusNote(item) && (
            <p className="account-muted">{receiptStatusNote(item)}</p>
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
              <Link
                className="account-text-link"
                href={item.articleHref}
                prefetch={ARTICLE_LINK_PREFETCH}
              >
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
