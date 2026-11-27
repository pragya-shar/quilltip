/**
 * Switch for new v1 payment records (docs/architecture/v2/06-app-integration.md,
 * sections 6.8 and 6.9; docs/operations/payments-v2-cutover.md, stage 5).
 *
 * `CHAIN_V1_PREPARES_ENABLED` controls only the functions that start a new v1
 * tip or NFT action. Submit, verification, recovery and read functions do not
 * read it, so v1 records prepared before the switch still complete.
 *
 * - unset, empty or `true`: v1 preparation runs (the behaviour before the
 *   switch existed).
 * - `false`: v1 preparation is refused.
 * - any other value: refused as well, so a mistyped value pauses v1 rather
 *   than leaving it running.
 */
import { ConvexError } from 'convex/values'

type EnvLike = Record<string, string | undefined>

export const V1_PREPARES_PAUSED_MESSAGE =
  'Tips and NFT actions are paused for a short time while payments are updated. Nothing was charged.'

export function v1PreparesEnabled(env: EnvLike = process.env): boolean {
  const value = env.CHAIN_V1_PREPARES_ENABLED?.trim().toLowerCase()
  return value === undefined || value === '' || value === 'true'
}

/** Throws before any v1 tip or NFT record is created while v1 is paused. */
export function requireV1PreparesEnabled(env: EnvLike = process.env): void {
  if (!v1PreparesEnabled(env)) {
    throw new ConvexError(V1_PREPARES_PAUSED_MESSAGE)
  }
}
