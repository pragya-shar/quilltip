'use client'

import {
  TIPS_UNAVAILABLE_COPY,
  type TipsUnavailableReason,
} from '@/lib/copy/tips-unavailable'

export type { TipsUnavailableReason }

/**
 * Shown in place of the tip button while an article cannot take v2 tips
 * (docs/architecture/v2/06-app-integration.md, section 6.9, migration).
 * The payment kit's `PaymentNotice kind="tips-unavailable"` renders this too.
 */
export function TipsUnavailableNote({
  reason,
}: {
  reason: TipsUnavailableReason
}) {
  return (
    <p className="reader-tips-unavailable" role="status">
      {TIPS_UNAVAILABLE_COPY[reason]}
    </p>
  )
}
