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

export default crons
