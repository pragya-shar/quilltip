import type { ReactNode } from 'react'

/** One ruled line of a receipt: what, then its value. */
export function ReceiptFact({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
