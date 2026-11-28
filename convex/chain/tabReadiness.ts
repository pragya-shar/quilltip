/**
 * Tab tip readiness with its causes (`convex/lib/chain/tabReadiness.ts`).
 * Operators and the command line see which check fails; the public reads
 * (`chain/config:getChainConfig`, `tabActivity:getTabSettlement`) see only
 * `tabReady`. What to do for each cause is in
 * docs/operations/chain-runbook.md, "Tab tips not ready".
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { internalQuery, query, type QueryCtx } from '../_generated/server'
import { readChainEnv } from '../lib/chain/env'
import {
  cachedChainConfig,
  evaluateTabReadiness,
} from '../lib/chain/tabReadiness'
import { opsUserIds } from './indexer'

async function detail(ctx: QueryCtx) {
  const config = await cachedChainConfig(ctx)
  return {
    ...evaluateTabReadiness(process.env, config),
    v2Enabled: readChainEnv().v2Enabled,
    refreshedAt: config?.refreshedAt ?? null,
  }
}

/** For the refresh's log lines and the command line. */
export const read = internalQuery({
  args: {},
  handler: async (ctx) => detail(ctx),
})

/** For `app/ops/chain`. Null unless the user is in `OPS_USER_IDS`. */
export const getTabReadiness = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId || !opsUserIds().has(userId)) return null
    return detail(ctx)
  },
})
