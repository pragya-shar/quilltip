import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SESSION_KEY_COPY } from '@/lib/copy/payment-states'
import { formatXlm } from '@/lib/payments/format'
import { cn } from '@/lib/utils'
import { TestnetLabel } from './TestnetLabel'
import type { BaseUnits } from './payment-types'
import './payments.css'

interface SessionKeyRowProps {
  /** Device label, for example "This browser" or "Firefox on Linux". */
  label?: string
  /** Formatted with `formatDay(estimateLedgerTime(validUntilLedger, …))`. */
  expiresAround?: string
  expired?: boolean
  revoked?: boolean
  /** `acceptedTotal` and `spendLimit` from `getMyTab().keys`. */
  used: BaseUnits
  limit: BaseUnits
  /** Revoke needs one wallet approval; it stays open under a pause (I-27). */
  onRevoke?: () => void
  /** Shown when the key expired: registers a new key. */
  onRenew?: () => void
  className?: string
}

/** One quick-tip key on the tab page: device, expiry, spend and actions. */
export function SessionKeyRow({
  label = SESSION_KEY_COPY.label,
  expiresAround,
  expired = false,
  revoked = false,
  used,
  limit,
  onRevoke,
  onRenew,
  className,
}: SessionKeyRowProps) {
  const status = revoked
    ? SESSION_KEY_COPY.revoked
    : expired
      ? SESSION_KEY_COPY.expired
      : expiresAround
        ? SESSION_KEY_COPY.expires(expiresAround)
        : null
  return (
    <div
      className={cn('pay-key', className)}
      data-state={revoked ? 'revoked' : expired ? 'expired' : 'active'}
    >
      <KeyRound className="pay-key-icon" aria-hidden="true" />
      <div className="pay-key-body">
        <p className="pay-key-label">{label}</p>
        <p className="pay-key-meta">
          {status ? <span>{status}</span> : null}
          <span className="pay-key-spend">
            {SESSION_KEY_COPY.used(formatXlm(used), formatXlm(limit))}
          </span>
          <TestnetLabel />
        </p>
      </div>
      <div className="pay-key-actions">
        {expired && !revoked && onRenew ? (
          <Button type="button" className="pay-action" onClick={onRenew}>
            {SESSION_KEY_COPY.renew}
          </Button>
        ) : null}
        {!revoked && onRevoke ? (
          <Button
            type="button"
            variant="outline"
            className="pay-action"
            onClick={onRevoke}
          >
            {SESSION_KEY_COPY.revoke}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
