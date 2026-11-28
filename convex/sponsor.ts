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
 *   re-simulates with the real signatures, checks the fee cap, signs the
 *   envelope as source and sends it.
 * - `deployAccount` (internal): a passkey account's birth through the
 *   allowlisted deployer and WASM; called after a verified registration.
 *
 * Order of checks: sign-in, then `sponsorConfig` (testnet guard,
 * `SPONSOR_ENABLED`, contracts), then the per-user and global limits, and
 * only then is `SPONSOR_SECRET` read. The checks themselves live in
 * `lib/sponsor/policy.ts`, the network steps in `lib/sponsor/run.ts`.
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
  SUGGESTED_EXPIRY_LEDGERS,
  runDeploy,
  runPrepare,
  runSubmit,
  type SponsorDeps,
} from './lib/sponsor/run'

type SponsorErrorData = { code: string; message: string }

function toConvexError(error: unknown): ConvexError<SponsorErrorData> {
  if (error instanceof ConvexError)
    return error as ConvexError<SponsorErrorData>
  if (error instanceof SponsorRefusal) {
    return new ConvexError({ code: error.code, message: error.message })
  }
  const message = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, 500)
  return new ConvexError({ code: 'SPONSOR_FAILED', message })
}

async function requireUser(ctx: ActionCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (!userId)
    throw new ConvexError({ code: 'NOT_SIGNED_IN', message: 'Sign in first.' })
  return userId
}

/** Reads the guarded settings, then the key. Throws `ConvexError`s. */
function deps(): SponsorDeps {
  try {
    const cfg = sponsorConfig()
    const chain = readChainEnv()
    return {
      cfg,
      passphrase: chain.passphrase,
      server: new rpc.Server(chain.rpcUrl, {
        allowHttp: chain.rpcUrl.startsWith('http://'),
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
  if (!/^(0|[1-9][0-9]{0,30})$/.test(s))
    refuse('SPONSOR_INVALID', 'Invalid amount.')
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
    const d = deps()
    const now = Date.now()
    const { requestId, reader } = await ctx.runMutation(
      internal.sponsorStore.reserve,
      {
        userId,
        call: args.call,
        amount: args.amount,
        key: args.key,
        keyId: args.keyId,
        passphrase: d.passphrase,
        dailyBudgetStroops: d.cfg.dailyBudgetStroops.toString(),
        now,
      }
    )
    try {
      const spec = specFor(d.cfg, reader, args)
      const p = await runPrepare(d, spec, now)
      await ctx.runMutation(internal.sponsorStore.recordPrepared, {
        requestId,
        entries: p.entries,
        maxExpiration: p.maxExpiration,
        feeStroops: p.feeStroops.toString(),
        now: Date.now(),
      })
      return {
        requestId,
        call: spec.call,
        contractId: d.cfg.tabContractId,
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
    const d = deps()
    const row = await ctx.runMutation(internal.sponsorStore.claim, {
      requestId: args.requestId,
      userId,
      now: Date.now(),
    })
    let fee: string | undefined
    try {
      const spec = specFor(d.cfg, row.reader, row)
      const result = await runSubmit(
        d,
        spec,
        row.entries,
        args.signedEntries,
        row.maxExpiration,
        (f) => {
          fee = f
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
      await ctx.runMutation(internal.sponsorStore.fail, {
        requestId: args.requestId,
        error: e.data.code,
        feeStroops: fee && fee !== '0' ? fee : undefined,
        now: Date.now(),
      })
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
    const d = deps()
    await ctx.runMutation(internal.sponsorStore.checkBudget, {
      dailyBudgetStroops: d.cfg.dailyBudgetStroops.toString(),
      now: Date.now(),
    })
    let fee: string | undefined
    try {
      const result = await runDeploy(d, args, (f) => {
        fee = f
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
