import { cn } from '@/lib/utils'
import { TESTNET_LABEL, TESTNET_LABEL_DETAIL } from '@/lib/copy/payment-states'
import './payments.css'

/**
 * "Stellar testnet" beside a payment heading or amount. One per surface;
 * `detail` adds "Practice funds, no real value" where a reader first meets
 * an amount.
 */
export function TestnetLabel({
  detail = false,
  className,
}: {
  detail?: boolean
  className?: string
}) {
  return (
    <span className={cn('pay-network', className)}>
      <span className="pay-network-name">{TESTNET_LABEL}</span>
      {detail ? (
        <span className="pay-network-detail">{TESTNET_LABEL_DETAIL}</span>
      ) : null}
    </span>
  )
}
