'use client'

export type TipsUnavailableReason =
  | 'unregistered'
  | 'pending'
  | 'payout_outdated'
  | 'paused'

const COPY: Record<TipsUnavailableReason, string> = {
  unregistered: 'Tips aren’t on for this article yet.',
  pending: 'Tips for this article turn on in a moment.',
  payout_outdated: 'Tips are paused while the writer updates their wallet.',
  paused: 'Tips are paused for a short time while payments are updated.',
}

/**
 * Shown in place of the tip button while an article cannot take v2 tips
 * (docs/architecture/v2/06-app-integration.md, section 6.9, migration), or
 * while v1 tips are paused before v2 is on (`paused`).
 */
export function TipsUnavailableNote({
  reason,
}: {
  reason: TipsUnavailableReason
}) {
  return (
    <p className="reader-tips-unavailable" role="status">
      {COPY[reason]}
    </p>
  )
}
