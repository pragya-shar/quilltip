'use node'
/**
 * The fee sponsor: the transaction source and fee payer for calls that a
 * passkey account (a contract address, which cannot be a source) authorizes
 * with its own signature. It is never a signer on a reader's account.
 *
 * - `prepare` (signed in): one balance call on the Tab for the caller's own
 *   passkey account, built from typed arguments, simulated and checked;
 *   returns the entries the passkey signs as a `PreparedBalanceCall`
 *   (`lib/balance/signer.ts`).
 * - `submit` (signed in): the signed entries must be the prepared ones; it
 *   re-simulates with the real signatures, checks the fee cap on the
 *   envelope it signs, signs as source and sends.
 * - `deployAccount` (internal): a passkey account's birth through the
 *   allowlisted deployer and WASM; called after a verified registration.
 * - `reconcile` (internal, cron): settles requests whose transaction was sent
 *   but whose result was not seen.
 *
 * Order of checks: sign-in, then `sponsorConfig` (testnet guard,
 * `SPONSOR_ENABLED`, contracts), then the per-user and global limits, and
 * only then is `SPONSOR_SECRET` read. The checks live in
 * `lib/sponsor/policy.ts`, the network steps in `lib/sponsor/run.ts`.
 *
 * Errors reach the client as a code and a fixed sentence; RPC and guard text
 * stays in the server log.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { Keypair, rpc } from '@stellar/stellar-sdk'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { action, internalAction, type ActionCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { readChainEnv } from './lib/chain/env'
import type { PreparedBalanceCall } from '../lib/balance/signer'
import {
  SponsorRefusal,
  refuse,
  sponsorConfig,
  sponsorSecret,
  type BalanceCallSpec,
  type SponsorConfig,
  type SponsoredCall,
} from './lib/sponsor/policy'
import {
  SUBMIT_TIME_BOUND_S,
  SUGGESTED_EXPIRY_LEDGERS,
  lookupSent,
  runDeploy,
  runPrepare,
  runSubmit,
  type SponsorDeps,
} from './lib/sponsor/run'

type SponsorErrorData = { code: string; message: string }

/** The sentence a client sees for a code that is not a refusal of ours. */
const GENERIC = 'That did not go through. Nothing was sent.'

function toConvexError(error: unknown): ConvexError<SponsorErrorData> {
  if (error instanceof ConvexError) {
    return error as ConvexError<SponsorErrorData>
  }
  if (error instanceof SponsorRefusal) {
    // Refusals carrying RPC text (simulation, send, pending) keep it in the log.
    if (
      error.code === 'SPONSOR_SIMULATION_FAILED' ||
      error.code === 'SPONSOR_SEND_REFUSED' ||
      error.code === 'SPONSOR_TX_FAILED' ||
      error.code === 'SPONSOR_PENDING'
    ) {
      console.error(`[sponsor] ${error.code}: ${error.message}`)
      return new ConvexError({ code: error.code, message: GENERIC })
    }
    return new ConvexError({ code: error.code, message: error.message })
  }
  console.error(
    `[sponsor] unclassified: ${(error instanceof Error ? error.message : String(error)).slice(0, 500)}`
  )
  return new ConvexError({ code: 'SPONSOR_FAILED', message: GENERIC })
}

async function requireUser(ctx: ActionCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (!userId) {
    throw new ConvexError({ code: 'NOT_SIGNED_IN', message: 'Sign in first.' })
  }
  return userId
}

type Settings = { cfg: SponsorConfig; passphrase: string; rpcUrl: string }

/** The guarded settings, without the secret. */
function settings(): Settings {
  try {
    const cfg = sponsorConfig()
    const chain = readChainEnv()
    return { cfg, passphrase: chain.passphrase, rpcUrl: chain.rpcUrl }
  } catch (error) {
    throw toConvexError(error)
  }
}

/** Reads the key, after the settings and the limits passed. */
function deps(s: Settings): SponsorDeps {
  try {
    return {
      cfg: s.cfg,
      passphrase: s.passphrase,
      server: new rpc.Server(s.rpcUrl, {
        allowHttp: s.rpcUrl.startsWith('http://'),
      }),
      sponsor: Keypair.fromSecret(sponsorSecret()),
    }
  } catch (error) {
    throw toConvexError(error)
  }
}

const keyArg = v.union(
  v.null(),
  v.object({
    publicKey: v.string(),
    validUntil: v.number(),
    spendLimit: v.string(),
  })
)
const callArg = v.union(
  v.literal('open_session'),
  v.literal('deposit'),
  v.literal('register_key'),
  v.literal('revoke_key')
)

function stroops(s: string): bigint {
  if (!/^(0|[1-9][0-9]{0,30})$/.test(s)) {
    refuse('SPONSOR_INVALID', 'Invalid amount.')
  }
  return BigInt(s)
}

function specFor(
  cfg: SponsorConfig,
  reader: string,
  a: {
    call: SponsoredCall
    amount: string
    key: { publicKey: string; validUntil: number; spendLimit: string } | null
    keyId: number | null
  }
): BalanceCallSpec {
  return {
    call: a.call,
    tabContractId: cfg.tabContractId,
    tokenContractId: cfg.tokenContractId,
    reader,
    amount: stroops(a.amount),
    key: a.key ? { ...a.key, spendLimit: stroops(a.key.spendLimit) } : null,
    keyId: a.keyId,
  }
}

/** Prepares one sponsored balance call for the caller's own passkey account. */
export const prepare = action({
  args: {
    call: callArg,
    amount: v.string(),
    key: keyArg,
    keyId: v.union(v.null(), v.number()),
  },
  handler: async (ctx, args): Promise<PreparedBalanceCall> => {
    const userId = await requireUser(ctx)
    const s = settings()
    const now = Date.now()
    const { requestId, reader } = await ctx.runMutation(
      internal.sponsorStore.reserve,
      {
        userId,
        call: args.call,
        amount: args.amount,
        key: args.key,
        keyId: args.keyId,
        passphrase: s.passphrase,
        dailyBudgetStroops: s.cfg.dailyBudgetStroops.toString(),
        now,
      }
    )
    try {
      const d = deps(s)
      const spec = specFor(s.cfg, reader, args)
      const p = await runPrepare(d, spec, now)
      await ctx.runMutation(internal.sponsorStore.recordPrepared, {
        requestId,
        entries: p.entries,
        maxExpiration: p.maxExpiration,
        feeStroops: p.feeStroops.toString(),
        dailyBudgetStroops: s.cfg.dailyBudgetStroops.toString(),
        now: Date.now(),
      })
      return {
        requestId,
        call: spec.call,
        contractId: s.cfg.tabContractId,
        amount: spec.amount.toString(),
        key: args.key,
        clock: { sequence: p.latestLedger, closedAt: Math.floor(now / 1000) },
        fee: { stroops: p.feeStroops.toString(), paidBy: 'quilltip' },
        maxTime: p.maxTime,
        payload: {
          kind: 'auth',
          entries: p.entries.map((b64) => ({
            b64,
            contexts: p.contexts,
            expiration: p.latestLedger + SUGGESTED_EXPIRY_LEDGERS,
          })),
        },
      }
    } catch (error) {
      const e = toConvexError(error)
      await ctx.runMutation(internal.sponsorStore.fail, {
        requestId,
        error: e.data.code,
        now: Date.now(),
      })
      throw e
    }
  },
})

/** Submits a prepared call with the passkey's signed entries. */
export const submit = action({
  args: { requestId: v.string(), signedEntries: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ txHash: string; ledger: number }> => {
    const userId = await requireUser(ctx)
    const s = settings()
    const row = await ctx.runMutation(internal.sponsorStore.claim, {
      requestId: args.requestId,
      userId,
      now: Date.now(),
    })
    let sentHash: string | null = null
    let fee: string | undefined
    try {
      const d = deps(s)
      const spec = specFor(s.cfg, row.reader, row)
      const result = await runSubmit(
        d,
        spec,
        row.entries,
        args.signedEntries,
        row.maxExpiration,
        {
          onSent: async (hash, envelopeFee) => {
            sentHash = hash
            await ctx.runMutation(internal.sponsorStore.markSent, {
              requestId: args.requestId,
              txHash: hash,
              envelopeFee,
              now: Date.now(),
            })
          },
          onFee: (f) => {
            fee = f
          },
        }
      )
      await ctx.runMutation(internal.sponsorStore.finish, {
        requestId: args.requestId,
        txHash: result.hash,
        feeStroops: result.fee,
        now: Date.now(),
      })
      // Index the deposit and the key now rather than at the next minute.
      await ctx.scheduler.runAfter(0, internal.chain.indexer.pollEvents, {})
      return { txHash: result.hash, ledger: result.ledger }
    } catch (error) {
      const e = toConvexError(error)
      // A transaction that reached the network is never closed here: a
      // FAILED result is closed with its fee; anything else stays pending
      // for the reconciler (`fail` ignores pending rows without `force`).
      await ctx.runMutation(internal.sponsorStore.fail, {
        requestId: args.requestId,
        error: e.data.code,
        ...(e.data.code === 'SPONSOR_TX_FAILED' && fee
          ? { feeStroops: fee, force: true }
          : {}),
        now: Date.now(),
      })
      if (sentHash && e.data.code !== 'SPONSOR_TX_FAILED') {
        throw new ConvexError({
          code: 'SPONSOR_PENDING',
          message: 'Sent. Waiting for Stellar testnet to confirm it.',
        })
      }
      throw e
    }
  },
})

/**
 * Deploys a passkey account from the kit's `{ func, auth }` payload.
 * Internal: the caller has verified the passkey registration behind it.
 */
export const deployAccount = internalAction({
  args: { func: v.string(), auth: v.array(v.string()), contractId: v.string() },
  handler: async (ctx, args): Promise<{ txHash: string; ledger: number }> => {
    const s = settings()
    await ctx.runMutation(internal.sponsorStore.checkBudget, {
      dailyBudgetStroops: s.cfg.dailyBudgetStroops.toString(),
      now: Date.now(),
    })
    let fee: string | undefined
    try {
      const result = await runDeploy(deps(s), args, {
        onFee: (f) => {
          fee = f
        },
      })
      return { txHash: result.hash, ledger: result.ledger }
    } catch (error) {
      throw toConvexError(error)
    } finally {
      if (fee && fee !== '0') {
        await ctx.runMutation(internal.sponsorStore.recordFee, {
          feeStroops: fee,
          now: Date.now(),
        })
      }
    }
  },
})

/**
 * Closes pending requests: the network's answer when there is one, failed
 * with no fee once the transaction's time bound has passed with no answer.
 */
export const reconcile = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number }> => {
    let s: Settings
    try {
      s = settings()
    } catch {
      return { checked: 0 }
    }
    const now = Date.now()
    const stale = await ctx.runQuery(internal.sponsorStore.stalePending, {
      now,
      olderThanMs: 30_000,
    })
    if (stale.length === 0) return { checked: 0 }
    const server = new rpc.Server(s.rpcUrl, {
      allowHttp: s.rpcUrl.startsWith('http://'),
    })
    for (const p of stale) {
      let r: Awaited<ReturnType<typeof lookupSent>>
      try {
        r = await lookupSent(server, p.txHash)
      } catch {
        continue
      }
      if (r.status === 'SUCCESS') {
        await ctx.runMutation(internal.sponsorStore.finish, {
          requestId: p.requestId,
          txHash: p.txHash,
          feeStroops: r.fee,
          now: Date.now(),
        })
      } else if (r.status === 'FAILED') {
        await ctx.runMutation(internal.sponsorStore.fail, {
          requestId: p.requestId,
          error: 'SPONSOR_TX_FAILED',
          feeStroops: r.fee,
          force: true,
          now: Date.now(),
        })
      } else if (now - p.updatedAt > (SUBMIT_TIME_BOUND_S + 60) * 1000) {
        await ctx.runMutation(internal.sponsorStore.fail, {
          requestId: p.requestId,
          error: 'SPONSOR_EXPIRED_UNSEEN',
          force: true,
          now: Date.now(),
        })
      }
    }
    return { checked: stale.length }
  },
})
