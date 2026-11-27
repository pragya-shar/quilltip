import { shortAddress } from '@/lib/payments/format'
import { cn } from '@/lib/utils'
import './payments.css'

/**
 * A Stellar address shortened in the middle ("GBZX…MADI"), as wallets show
 * it. The full address is in the tooltip and can be copied from the text.
 */
export function ShortAddress({
  address,
  className,
}: {
  address: string
  className?: string
}) {
  return (
    <span className={cn('pay-address', className)} title={address}>
      {shortAddress(address)}
    </span>
  )
}
