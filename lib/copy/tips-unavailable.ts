/**
 * Why an article cannot take tips right now. One table for the article
 * page note (components/tipping/TipsUnavailableNote) and the payment kit.
 * A small module of its own, so the article page loads only these lines.
 */
export type TipsUnavailableReason =
  | 'unregistered'
  | 'pending'
  | 'payout_outdated'
  | 'paused'
  | 'splits'
  /** v1 tips are paused before payments v2 is on (cutover step 4). */
  | 'paused'

export const TIPS_UNAVAILABLE_COPY: Record<TipsUnavailableReason, string> = {
  unregistered: 'Tips aren’t on for this article yet.',
  pending: 'Tips for this article turn on in a moment.',
  payout_outdated: 'Tips are paused while the writer updates their wallet.',
  paused: 'Tips are paused for a short time while payments are updated.',
  splits:
    'Quick tips don’t work for this article because it shares tips with co-authors. Tip from your wallet instead.',
  paused: 'Tips are paused for a short time while payments are updated.',
}
