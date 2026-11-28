import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'
import { SWEEP_RUNS_PER_DAY } from './shares'

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
// beyond the in-action retry budget. Exact verification can confirm or fail
// the tip and update accounting, so this recovery runs unconditionally.
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

// Remove wallet-link challenges a day after they expire.
crons.interval(
  'prune wallet link challenges',
  { hours: 6 },
  internal.walletLink.pruneWalletChallenges
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

// The migration checkpoints each bounded batch and becomes a no-op once complete.
crons.interval(
  'backfill reading room search',
  { minutes: 5 },
  internal.readingRoomIndex.backfill
)

// Payments v2: resolve submissions whose verification window has passed
// (rule (a) through RPC, rule (b) from indexed events, then the expiry rule).
// Does nothing while no v2 submission is open.
crons.interval(
  'recheck pending chain submissions',
  { minutes: 2 },
  internal.chain.submissions.recheckPending
)

// Payments v2: index contract events (section 6.5). Does nothing until the
// contract IDs and INDEXER_START_LEDGER are set; runs under the indexer lease.
crons.interval(
  'poll chain events',
  { minutes: 1 },
  internal.chain.indexer.pollEvents,
  {}
)

// Payments v2: cache Core, Tab and NFT views. Does nothing until
// CORE_CONTRACT_ID is set.
crons.interval(
  'refresh chain config',
  { hours: 1 },
  internal.chain.config.refreshChainConfig
)

// Payments v2: settle due tab vouchers (section 3.8) under the settler lease.
// Does nothing unless SETTLEMENT_ENABLED=true and TAB_CONTRACT_ID is set.
crons.interval(
  'settle due tab vouchers',
  { minutes: 10 },
  internal.tabSettler.settleDue,
  {}
)

// Payments v2: credit CONFIRMED and MISMATCH direct and batch tips to
// authorEarnings (section 6.2). Each row is credited once.
crons.interval(
  'sync v2 tip earnings',
  { minutes: 1 },
  internal.tipEarnings.syncV2TipEarnings
)

// Rebuild earnings rows' lifetime totals from their history (#552). Each run
// advances the rows that waited longest by bounded steps; it does nothing once
// every row is rebuilt.
crons.interval(
  'rebuild lifetime earnings totals',
  { minutes: 1 },
  internal.earningsTotalsBackfill.run
)

// Re-check passage share quotes whose article changed without its reconcile
// call, and delete rows cleared long ago (convex/shares.ts sweep). Hourly, so
// it walks SWEEP_ROWS_PER_DAY (60,000) rows a day. Bounded per step; each step
// that reads a share also writes the sweep's position.
crons.interval(
  'sweep passage share quotes',
  { hours: 24 / SWEEP_RUNS_PER_DAY },
  internal.shares.sweep,
  {}
)

// Fee sponsor: close requests from the network's answer (convex/sponsor.ts
// reconcile). It runs while the sponsor is off too, so no request stays open.
crons.interval(
  'reconcile sponsored calls',
  { minutes: 2 },
  internal.sponsor.reconcile,
  {}
)

// Fee sponsor readiness (convex/sponsor.ts checkReadiness): the secret, the
// floor, the account code and a signed simulation, recorded with a time.
// Entries also run it when the record is stale or the settings changed.
crons.interval(
  'check sponsor readiness',
  { minutes: 10 },
  internal.sponsor.checkReadiness,
  {}
)

export default crons
