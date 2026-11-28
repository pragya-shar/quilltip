/**
 * Settlement soon after acceptance. The settler cron runs every 10 minutes;
 * when `TAB_SETTLE_AFTER_ACCEPT_MS` is set, an acceptance also schedules one
 * settler run that many milliseconds later, so a tip reaches the chain
 * within about a minute instead of waiting for the cron and the due rules.
 *
 * - One scheduled run per window: the `settle-request` lease is held for
 *   the delay, and acceptances inside it schedule nothing more. The run
 *   settles every pair that is ready when it starts (`requested`), whatever
 *   its age, so a tip accepted inside the window is not left behind.
 * - Unset (the default) leaves today's behaviour: only the cron settles, by
 *   the due rules. A test holds settlement back by leaving it unset.
 * - Nothing here touches the network or a secret; the scheduled action runs
 *   the settler's own guards (`settlerConfig`).
 */
import { internal } from '../../_generated/api'
import type { MutationCtx } from '../../_generated/server'
import { readChainEnv } from './env'
import { acquireLease } from './lease'

type EnvLike = Record<string, string | undefined>

export const SETTLE_REQUEST_LEASE = 'settle-request'
/** Shortest and longest delay a deployment may configure. */
export const MIN_SETTLE_AFTER_MS = 1_000
export const MAX_SETTLE_AFTER_MS = 10 * 60 * 1000
/** Follow-up runs when a requested run finds a settlement still open. */
export const MAX_SETTLE_FOLLOW_UPS = 5

/** The configured delay, or null when settlement after acceptance is off. */
export function settleAfterAcceptMs(env: EnvLike = process.env): number | null {
  const raw = env.TAB_SETTLE_AFTER_ACCEPT_MS?.trim()
  if (!raw || !/^[0-9]{1,9}$/.test(raw)) return null
  const ms = Number(raw)
  if (ms < MIN_SETTLE_AFTER_MS || ms > MAX_SETTLE_AFTER_MS) return null
  return ms
}

/**
 * Schedules one settler run `TAB_SETTLE_AFTER_ACCEPT_MS` from now unless one
 * is already scheduled inside that window. Returns whether it scheduled.
 */
export async function requestSettlement(
  ctx: MutationCtx,
  now: number,
  options: { env?: EnvLike; followUp?: number } = {}
): Promise<boolean> {
  const env = options.env ?? process.env
  if (env.SETTLEMENT_ENABLED?.trim() !== 'true') return false
  const delay = settleAfterAcceptMs(env)
  if (delay === null) return false
  const chain = readChainEnv(env)
  const scheduled = await acquireLease(ctx, {
    name: SETTLE_REQUEST_LEASE,
    holder: `request-${now}-${Math.random().toString(36).slice(2)}`,
    ttlMs: delay,
    now,
    network: chain.network,
    chainEpoch: chain.chainEpoch,
  })
  if (!scheduled) return false
  await ctx.scheduler.runAfter(delay, internal.tabSettler.settleDue, {
    requested: true,
    followUp: options.followUp ?? 0,
  })
  return true
}
