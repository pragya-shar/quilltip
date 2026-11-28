'use node'
/**
 * The tab settler cron (docs/architecture/v2/05-flows-and-admin.md, section
 * 5.7; 06-app-integration.md, section 6.3). Runs every 10 minutes.
 *
 * Order of checks: `assertBackendTestnet()` (through `readChainEnv`), then
 * `SETTLEMENT_ENABLED=true` and `TAB_CONTRACT_ID`, and only then is
 * `TAB_SETTLER_SECRET` read. It does not call `assertNonProductionBackend`:
 * settlement runs wherever tab tips are accepted.
 */
import { Keypair, StrKey, rpc } from '@stellar/stellar-sdk'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, type ActionCtx } from './_generated/server'
import { readChainEnv } from './lib/chain/env'
import { createBackendRpcClient } from './lib/chain/rpc'
import {
  dueRuleFromEnv,
  runSettlementCycle,
  type DueRule,
  type SettlementLedger,
  type SettlementSubmitter,
} from './lib/chain/settler'
import { MAX_SETTLE_FOLLOW_UPS } from './lib/chain/settleSchedule'
import { localKeySubmitter } from './lib/chain/settlementSubmitter'

type EnvLike = Record<string, string | undefined>

/** The guarded settler settings, or why settlement is off. */
export function settlerConfig(env: EnvLike = process.env):
  | { enabled: false; reason: string }
  | {
      enabled: true
      chain: ReturnType<typeof readChainEnv> & { tabContractId: string }
    } {
  const chain = readChainEnv(env)
  if (env.SETTLEMENT_ENABLED?.trim() !== 'true') {
    return { enabled: false, reason: 'SETTLEMENT_ENABLED is not true' }
  }
  if (!chain.tabContractId) {
    return { enabled: false, reason: 'TAB_CONTRACT_ID is not set' }
  }
  return {
    enabled: true,
    chain: { ...chain, tabContractId: chain.tabContractId },
  }
}

/** Reads `TAB_SETTLER_SECRET`. Call only after `settlerConfig` passed. */
export function settlerKeypair(env: EnvLike = process.env): Keypair {
  const secret = env.TAB_SETTLER_SECRET?.trim()
  if (!secret || !StrKey.isValidEd25519SecretSeed(secret)) {
    throw new ConvexError({
      code: 'TAB_SETTLER_UNAVAILABLE',
      message: 'TAB_SETTLER_SECRET is not a valid Stellar secret.',
    })
  }
  return Keypair.fromSecret(secret)
}

export function convexSettlementLedger(ctx: ActionCtx): SettlementLedger {
  const t = internal.tabSettlement
  return {
    acquireLease: (holder) =>
      ctx.runMutation(t.acquireSettlerLease, { holder }),
    releaseLease: async (holder) => {
      await ctx.runMutation(t.releaseSettlerLease, { holder })
    },
    openSettlements: () => ctx.runQuery(t.listOpenSettlements, {}),
    sweepExpired: (ledger) => ctx.runMutation(t.sweepExpired, { ledger }),
    select: (args) => ctx.runQuery(t.selectCandidates, args),
    reject: async (items) => {
      await ctx.runMutation(t.rejectSettlementVouchers, {
        items: items.map((i) => ({
          voucherId: i.voucherId as Id<'tabVouchers'>,
          reason: i.reason,
        })),
      })
    },
    begin: (args) =>
      ctx.runMutation(t.begin, {
        ...args,
        voucherIds: args.voucherIds as Id<'tabVouchers'>[],
      }),
    recordPrepared: async (settlementId, p) => {
      await ctx.runMutation(t.recordPrepared, {
        settlementId: settlementId as Id<'tabSettlements'>,
        reference: p.reference,
        txHash: p.txHash,
        envelopeXdr: p.envelopeXdr,
      })
    },
    noteAttempt: async (settlementId, error) => {
      await ctx.runMutation(t.noteAttempt, {
        settlementId: settlementId as Id<'tabSettlements'>,
        error,
      })
    },
    finish: async (settlementId, result) => {
      await ctx.runMutation(t.finish, {
        settlementId: settlementId as Id<'tabSettlements'>,
        result,
      })
    },
  }
}

function log(code: string, details: Record<string, unknown>) {
  console.error(JSON.stringify({ code, ...details }))
}

/**
 * The due rule of a run. The cron applies `TAB_SETTLE_DUE_AGE_MS` and
 * `TAB_SETTLE_DUE_AMOUNT` (defaults 6 h and 5 XLM). A run requested by an
 * acceptance (`settleSchedule.requestSettlement`) settles every ready pair.
 */
export function runDueRule(
  requested: boolean,
  env: EnvLike = process.env
): DueRule {
  const rule = dueRuleFromEnv(env)
  return requested ? { ...rule, ageMs: 0 } : rule
}

/**
 * Cron, every 10 minutes, and the run an acceptance schedules when
 * `TAB_SETTLE_AFTER_ACCEPT_MS` is set. Does nothing unless settlement is
 * enabled.
 */
export const settleDue = internalAction({
  args: {
    requested: v.optional(v.boolean()),
    followUp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const config = settlerConfig()
    if (!config.enabled) return { status: 'disabled', reason: config.reason }
    const requested = args.requested === true
    const { chain } = config
    const keypair = settlerKeypair()
    const rpcClient = createBackendRpcClient()
    const server = new rpc.Server(chain.rpcUrl)
    const submitter: SettlementSubmitter = localKeySubmitter({
      keypair,
      passphrase: chain.passphrase,
      tabContractId: chain.tabContractId,
      server,
      rpcClient,
    })
    const result = await runSettlementCycle({
      holder: `settler-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      passphrase: chain.passphrase,
      tabContractId: chain.tabContractId,
      ledger: convexSettlementLedger(ctx),
      latestLedger: async () => {
        const health = await rpcClient.getHealth()
        return {
          sequence: health.latestLedger,
          closeTime: health.latestLedgerCloseTime,
        }
      },
      submitter,
      now: () => Date.now(),
      log,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      due: runDueRule(requested),
    })
    // A requested run that found another run or an open settlement asks
    // again, so the tips that scheduled it do not wait for the cron.
    const followUp = args.followUp ?? 0
    if (
      requested &&
      (result.status === 'busy' || result.status === 'pending') &&
      followUp < MAX_SETTLE_FOLLOW_UPS
    ) {
      await ctx.runMutation(internal.tabSettlement.requestFollowUp, {
        followUp: followUp + 1,
      })
    }
    return result
  },
})
