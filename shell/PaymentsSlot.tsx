'use client'

import type { ReactNode } from 'react'
import { PaymentsBoundary } from './PaymentsBoundary'

/**
 * Where the payments shell mounts: once, in the root layout, beside the
 * content (a sibling of <main>, never around it), inside its own boundary,
 * so a payment failure never takes the page down and nothing above reading
 * content can suspend.
 *
 * The headless payments shell (`components/payments/PaymentsShell`, with
 * its engine loaded after first paint) arrives with pull request 561.
 * Adopting it is one line in app/(app)/layout.tsx:
 *   <PaymentsSlot><PaymentsShell /></PaymentsSlot>
 */
export function PaymentsSlot({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <div className="qt-payments-slot">
      <PaymentsBoundary>{children}</PaymentsBoundary>
    </div>
  )
}
