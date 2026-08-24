import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Reconcile recent CONFIRMED article tips against the Stellar blockchain.
// Runs every 6 hours. The action respects the RECONCILE_TIPS_ENABLED env
// var — default off means dry-run logs only (no mutations). See
// convex/reconcileTips.ts for details.
crons.interval(
  'reconcile article tips',
  { hours: 6 },
  internal.reconcileTips.reconcileArticleTips
)

// Re-kick highlight tip verification for rows stuck in PENDING past the
// retry window — covers process crashes mid-chain and indexing delays
// beyond the in-action retry budget. Non-destructive (only reschedules
// the verify action), so this runs unconditionally.
crons.interval(
  'recover stuck pending highlight tips',
  { hours: 6 },
  internal.reconcileTips.recoverStuckPendingHighlightTips
)

// Whole-article tips use the same recovery principle, but run more frequently
// so a reader does not need to keep the confirmation dialog open for a stuck
// verification attempt to be recovered.
crons.interval(
  'recover stuck pending article tips',
  { minutes: 10 },
  internal.reconcileTips.recoverStuckPendingArticleTips
)

// Expired unsigned intents have no accounting value. Linked intent rows stay
// as an audit trail; the action deletes only a bounded unlinked batch.
crons.interval(
  'cleanup expired tip intents',
  { hours: 1 },
  internal.reconcileTips.cleanupExpiredTipIntents
)

// Refresh the XLM/USD price cache. The browser reads the cached value via
// xlmPrice.getCachedXlmPrice rather than calling Coingecko/Coincap/Binance/
// Kraken directly, which collapses the CSP allowlist and amortises oracle
// hits across all users to one fetch per interval.
crons.interval(
  'refresh xlm price cache',
  { minutes: 5 },
  internal.xlmPrice.refreshXlmPriceCache
)

export default crons
