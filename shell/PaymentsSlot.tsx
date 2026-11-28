'use client'

import type { ReactNode } from 'react'
import { PaymentsBoundary } from './PaymentsBoundary'

/**
 * Where the payments shell mounts: once, in the root layout, beside the
 * content (a sibling of <main>, never around it), inside its own boundary,
 * so a payment failure never takes the page down and nothing above reading
 * content can suspend.
 *
 * The root layout mounts `<PaymentsSlot><DeferredPaymentsShell /></PaymentsSlot>`:
 * the money layer's payments shell, loaded after hydration
 * (shell/DeferredPaymentsShell.tsx).
 */
export function PaymentsSlot({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <div className="qt-payments-slot">
      <PaymentsBoundary>{children}</PaymentsBoundary>
    </div>
  )
}
