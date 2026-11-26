import { ArrowUpRight } from 'lucide-react'
import { VIEW_TRANSACTION } from '@/lib/copy/payment-states'
import { explorerTxUrl } from '@/lib/payments/format'

/** "View the transaction" on the public testnet explorer, in a new tab. */
export function ExplorerLink({ hash }: { hash: string }) {
  return (
    <a
      className="pay-link"
      href={explorerTxUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {VIEW_TRANSACTION}
      <span className="sr-only"> (opens in a new tab)</span>
      <ArrowUpRight aria-hidden="true" />
    </a>
  )
}
