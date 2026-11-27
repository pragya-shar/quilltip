/**
 * Browser storage that the v1 tip dialogs wrote and nothing reads any more:
 * the sign-in tip intent, the signed v1 transactions kept for re-registration,
 * and the cached price hint. After the cutover drain none of these can create
 * a payment (docs/operations/payments-v2-cutover.md, stage 5), so they are
 * removed the next time a tip button renders.
 */
const LEGACY_KEYS = [
  'quilltip:pendingTipIntent',
  'quilltip:pendingArticleTipReceipts',
  'quilltip:xlm_usd_tip_rate_v1',
]
const LEGACY_PREFIXES = [
  'quilltip:pendingArticleTipReceipt:v2:',
  'quilltip:pendingHighlightTipReceipt:v2:',
]

/** Removes the v1 entries; storage that cannot be read is left alone. */
export function clearLegacyTipStorage(storage?: Storage): void {
  try {
    const target = storage ?? window.localStorage
    const stale: string[] = []
    for (let i = 0; i < target.length; i += 1) {
      const key = target.key(i)
      if (
        key &&
        (LEGACY_KEYS.includes(key) ||
          LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix)))
      ) {
        stale.push(key)
      }
    }
    for (const key of stale) target.removeItem(key)
  } catch {
    // Private mode or blocked storage: nothing to clean.
  }
}
