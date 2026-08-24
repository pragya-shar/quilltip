/**
 * Re-exports app constants for Convex. Convex deployment only bundles convex/,
 * so we define values here to avoid importing from outside the convex folder.
 * Keep in sync with lib/constants.ts.
 */
export const TIP_MIN_CENTS = 1
export const TIP_MIN_USD = 0.01
export const TIP_MAX_CENTS = 10_000
export const TIP_MAX_USD = 100
export const MIN_WITHDRAWAL_USD = 10
export const TIP_MIN_STROOPS = 420_000

// Minimum time between successive tips from the same user, across both
// article tips and highlight tips. Prevents accidental double-submits and
// basic spam during beta.
export const TIP_COOLDOWN_MS = 10_000

// Horizon endpoints for transaction verification. Can be overridden with the
// HORIZON_URL environment variable at deploy time; otherwise the per-network
// default is used based on the tip's stellarNetwork field.
export const HORIZON_URLS = {
  TESTNET: 'https://horizon-testnet.stellar.org',
  MAINNET: 'https://horizon.stellar.org',
} as const

export type StellarNetwork = keyof typeof HORIZON_URLS

export function getStellarNetwork(): StellarNetwork {
  const network = process.env.STELLAR_NETWORK ?? 'TESTNET'
  if (network !== 'TESTNET' && network !== 'MAINNET') {
    throw new Error('STELLAR_NETWORK must be TESTNET or MAINNET')
  }
  return network
}

// First verification attempt runs after this delay so Horizon has time to
// index the transaction we just submitted. Subsequent retries use exponential
// backoff via verifyDelayMs() — long-horizon recovery for stuck PENDING tips
// is delegated to the reconciliation cron, so the in-action retry stays short.
export const HORIZON_VERIFY_INITIAL_DELAY_MS = 2_000
export const HORIZON_VERIFY_RETRY_DELAY_MS = 5_000
export const HORIZON_VERIFY_MAX_ATTEMPTS = 3

// Horizon ledger timestamps can trail the app server clock slightly, and a
// wallet approval can finish just after the quote expires. These narrow grace
// windows bind a transaction to its prepared intent without rejecting a valid
// payment because of normal clock/ledger delay.
export const ARTICLE_TIP_TX_EARLY_GRACE_MS = 60_000
export const ARTICLE_TIP_TX_LATE_GRACE_MS = 2 * 60_000

// Horizon can briefly return 404 while it indexes a transaction accepted by
// the network. Once the signed transaction's maximum time has passed plus
// this grace, however, that specific receipt can no longer become valid.
export const HORIZON_NOT_FOUND_INDEXING_GRACE_MS = 10 * 60_000
export const HORIZON_NOT_FOUND_TERMINAL_REASON =
  'transaction_not_found_after_indexing_grace'

export function isPastHorizonNotFoundIndexingGrace(
  expectedMaxTime: string,
  nowMs = Date.now()
): boolean {
  const maxTimeSeconds = Number(expectedMaxTime)
  const deadlineMs = maxTimeSeconds * 1000 + HORIZON_NOT_FOUND_INDEXING_GRACE_MS
  return (
    Number.isSafeInteger(maxTimeSeconds) &&
    maxTimeSeconds > 0 &&
    Number.isSafeInteger(deadlineMs) &&
    nowMs > deadlineMs
  )
}

// Delay before the (attempt+1)th verification fires, given that `attempt`
// just returned a transient failure. Tripling backoff: 5s, 15s, 45s. Only
// 5s and 15s are reachable today (MAX_ATTEMPTS=3 → at most two reschedules),
// but the formula stays correct if we ever raise the cap.
export function verifyDelayMs(attempt: number): number {
  return HORIZON_VERIFY_RETRY_DELAY_MS * Math.pow(3, attempt - 1)
}

// Allowed Soroban functions on the tipping contract. Any invocation whose
// function name is outside this list fails verification. Arg layouts used
// by the verifier are fixed for these names:
//   tip_article / tip_article_with_arweave:
//     [tipper, article_id, author, amount, (arweave_tx_id)]
//   batch_tip:
//     [tipper, [{ article_id, author, amount }]]
//   tip_highlight_direct / tip_highlight_with_arweave:
//     [tipper, highlight_id, article_id, author, amount, (arweave_tx_id)]
//   batch_tip_highlights:
//     [tipper, [{ highlight_id, article_id, author, amount }]]
export const TIP_ARTICLE_FUNCTIONS = [
  'tip_article',
  'tip_article_with_arweave',
  'batch_tip',
] as const
export const TIP_HIGHLIGHT_FUNCTIONS = [
  'tip_highlight_direct',
  'tip_highlight_with_arweave',
  'batch_tip_highlights',
] as const
export const TIP_HIGHLIGHT_DIRECT_FUNCTION = 'tip_highlight_direct' as const

// Tipping contract ID is deployment-specific, so it is read from env at
// call time rather than baked in. Must match NEXT_PUBLIC_TIPPING_CONTRACT_ID
// used by the client when building transactions.
export function getTippingContractId(): string {
  const id = process.env.TIPPING_CONTRACT_ID
  if (!id) {
    throw new Error(
      'TIPPING_CONTRACT_ID env var is required for tip verification'
    )
  }
  return id
}

// How much the verifier's computed on-chain USD is allowed to fall below the
// claimed tip USD before the tip is rejected. XLM price drift between tx
// build and verification can produce small divergences; 0.25 absorbs that
// comfortably while still catching the "claim $100, pay 0.01 XLM" attack.
export const TIP_AMOUNT_USD_TOLERANCE = 0.25
export const STROOPS_PER_XLM = 10_000_000
