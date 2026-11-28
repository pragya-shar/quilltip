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
 *   envelope it signs, records the hash, signs as source and sends.
 * - `deployAccount` (internal): a passkey account's birth through the
 *   allowlisted deployer and WASM; called after a verified registration.
 * - `reconcile` (internal, cron): closes requests from the network's answer.
 * - `checkReadiness` (internal, cron): the readiness check below.
 *
 * Order of checks: sign-in; `sponsorConfig` (testnet guard, `SPONSOR_ENABLED`,
 * contracts, account code, deployer, public address); the arguments; the
 * per-user and global limits; readiness; only then is `SPONSOR_SECRET` read
 * for signing. The checks live in `lib/sponsor/policy.ts`, the network steps
 * in `lib/sponsor/run.ts`.
 *
 * Readiness fails closed: the secret parses and derives `SPONSOR_PUBLIC_KEY`,
 * the account holds more than the floor, the allowlisted account code exists
 * on the network, and a transaction signed by the sponsor simulates against
 * the Tab. Entries refuse (`SPONSOR_NOT_READY`) unless the latest check for
 * the current settings passed within `READINESS_TTL_MS`.
 *
 * Errors reach the client as a code and a fixed sentence chosen by the code;
 * RPC, configuration and guard text stays in the server log. "Nothing was
 * sent" is said only when that is known.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import {
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  BASE_FEE,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import { createHash } from 'node:crypto'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { action, internalAction, type ActionCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { readChainEnv } from './lib/chain/env'
import {
  codeOf,
  toClientError,
  type SponsorErrorData,
} from './lib/sponsor/clientError'
import type { PreparedBalanceCall } from '../lib/balance/signer'
import {
  READINESS_TTL_MS,
  SponsorRefusal,
  commitStroops,
  refuse,
  sponsorConfig,
  sponsorSecret,
  type BalanceCallSpec,
  type SponsorConfig,
  type SponsoredCall,
} from './lib/sponsor/policy'
import {
  SUGGESTED_EXPIRY_LEDGERS,
  knownNotLanded,
  lookupSent,
  runDeploy,
  runPrepare,
  runSubmit,
  type SendHooks,
  type SponsorDeps,
} from './lib/sponsor/run'

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
    // Configuration and guard text stays in the log; the client gets a code.
    const known =
      error instanceof SponsorRefusal || error instanceof ConvexError
    throw toClientError(
      known
        ? error
        : new SponsorRefusal('SPONSOR_CONFIG_INVALID', String(error))
    )
  }
}

function server(rpcUrl: string): rpc.Server {
  return new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') })
}

/** Reads the key for signing, after the settings, limits and readiness passed. */
function deps(s: Settings): SponsorDeps {
  return {
    cfg: s.cfg,
    passphrase: s.passphrase,
    server: server(s.rpcUrl),
    sponsor: Keypair.fromSecret(sponsorSecret()),
  }
}

// ----- Readiness -----

type Readiness = {
  ready: boolean
  failed: string[]
  warnings: string[]
  fingerprint: string
}

/** A hash of the settings and of the secret: a change means "check again". */
function fingerprint(s: Settings): string {
  const secret = process.env.SPONSOR_SECRET?.trim() ?? ''
  return createHash('sha256')
    .update(
      JSON.stringify({
        tab: s.cfg.tabContractId,
        token: s.cfg.tokenContractId,
        wasm: s.cfg.accountWasmHash,
        deployer: s.cfg.accountDeployer,
        publicKey: s.cfg.publicKey,
        floor: s.cfg.minBalanceStroops.toString(),
        rpc: s.rpcUrl,
        secret: createHash('sha256').update(secret).digest('hex'),
      })
    )
    .digest('hex')
}

/**
 * The readiness check itself. Never logs or returns the secret or anything
 * derived from it except the comparison's result.
 */
async function checkSigner(ctx: ActionCtx, s: Settings): Promise<Readiness> {
  const failed: string[] = []
  const warnings: string[] = []
  const fp = fingerprint(s)
  const raw = process.env.SPONSOR_SECRET?.trim() ?? ''
  if (!StrKey.isValidEd25519SecretSeed(raw)) {
    return {
      ready: false,
      failed: ['secret_invalid'],
      warnings,
      fingerprint: fp,
    }
  }
  const key = Keypair.fromSecret(raw)
  if (key.publicKey() !== s.cfg.publicKey) {
    return {
      ready: false,
      failed: ['secret_mismatch'],
      warnings,
      fingerprint: fp,
    }
  }
  const net = server(s.rpcUrl)
  try {
    const entry = await net.getAccountEntry(s.cfg.publicKey)
    const balance = BigInt(
      String((entry as unknown as { balance: unknown }).balance)
    )
    if (balance < s.cfg.minBalanceStroops) failed.push('below_floor')
  } catch {
    failed.push('account_unreadable')
  }
  try {
    const code = await net.getLedgerEntries(
      xdr.LedgerKey.contractCode(
        new xdr.LedgerKeyContractCode({
          hash: Buffer.from(s.cfg.accountWasmHash ?? '', 'hex'),
        } as never)
      )
    )
    if (code.entries.length === 0) failed.push('account_code_absent')
  } catch {
    failed.push('account_code_unreadable')
  }
  try {
    // A real transaction signed by the sponsor, simulated and never sent:
    // the account loads, the key signs, the Tab answers.
    const account = await net.getAccount(s.cfg.publicKey)
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: s.passphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: s.cfg.tabContractId,
          function: 'config',
          args: [],
        })
      )
      .setTimeout(60)
      .build()
    tx.sign(key)
    const sim = await net.simulateTransaction(tx)
    if (rpc.Api.isSimulationError(sim)) failed.push('simulation_failed')
  } catch {
    failed.push('simulation_failed')
  }
  const last = await ctx.runQuery(internal.sponsorStore.lastGoodSubmit, {})
  if (last === null) warnings.push('no_confirmed_call_yet')
  else if (Date.now() - last > 24 * 60 * 60_000)
    warnings.push('no_confirmed_call_in_24h')
  return { ready: failed.length === 0, failed, warnings, fingerprint: fp }
}

async function runCheck(ctx: ActionCtx, s: Settings): Promise<Readiness> {
  const r = await checkSigner(ctx, s)
  await ctx.runMutation(internal.sponsorStore.recordReadiness, {
    service: 'sponsor',
    ...r,
    now: Date.now(),
  })
  if (!r.ready) {
    console.error(`[sponsor] ALERT not ready: ${r.failed.join(', ')}`)
  } else if (r.warnings.length > 0) {
    console.warn(`[sponsor] ready with warnings: ${r.warnings.join(', ')}`)
  }
  return r
}

/**
 * Refuses unless the latest check for these settings passed recently; runs
 * the check first when it is missing, stale or for other settings.
 */
async function requireReady(ctx: ActionCtx, s: Settings): Promise<void> {
  const row = await ctx.runQuery(internal.sponsorStore.readiness, {
    service: 'sponsor',
  })
  const fresh =
    row &&
    row.fingerprint === fingerprint(s) &&
    Date.now() - row.checkedAt < READINESS_TTL_MS
  const ready = fresh ? row.ready : (await runCheck(ctx, s)).ready
  if (!ready) refuse('SPONSOR_NOT_READY', 'The fee sponsor is not ready.')
}

/** Runs the readiness check (cron, and on demand from the dashboard). */
export const checkReadiness = internalAction({
  args: {},
  handler: async (ctx): Promise<Readiness | null> => {
    let s: Settings
    try {
      s = settings()
    } catch {
      await ctx.runMutation(internal.sponsorStore.recordReadiness, {
        service: 'sponsor',
        ready: false,
        failed: ['config'],
        warnings: [],
        fingerprint: '',
        now: Date.now(),
      })
      return null
    }
    return runCheck(ctx, s)
  },
})

// ----- Calls -----

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

type CallArgs = {
  call: SponsoredCall
  amount: string
  key: { publicKey: string; validUntil: number; spendLimit: string } | null
  keyId: number | null
}

function specFor(
  cfg: SponsorConfig,
  reader: string,
  a: CallArgs
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

/**
 * Closes a request after an error and gives the client its sentence:
 * - the node refused the envelope: failed, nothing was sent;
 * - the network answered FAILED: failed with the fee charged;
 * - a signed envelope may have reached the node: left pending for the
 *   reconciler;
 * - nothing was signed yet: failed, nothing was sent.
 */
async function closeAfterError(
  ctx: ActionCtx,
  requestId: string,
  error: unknown,
  signed: boolean,
  fee: string | undefined
): Promise<ConvexError<SponsorErrorData>> {
  const code = codeOf(error)
  if (code === 'SPONSOR_SEND_REFUSED') {
    await ctx.runMutation(internal.sponsorStore.fail, {
      requestId,
      error: code,
      force: true,
      now: Date.now(),
    })
  } else if (code === 'SPONSOR_TX_FAILED') {
    await ctx.runMutation(internal.sponsorStore.fail, {
      requestId,
      error: code,
      force: true,
      ...(fee ? { feeStroops: fee } : {}),
      now: Date.now(),
    })
  } else if (!signed) {
    await ctx.runMutation(internal.sponsorStore.fail, {
      requestId,
      error: code ?? 'SPONSOR_FAILED',
      now: Date.now(),
    })
  }
  return toClientError(error, signed)
}

/** Hooks that store the hash before the send and keep the fee charged. */
function hooksFor(ctx: ActionCtx, requestId: string) {
  const state: { signed: boolean; fee?: string } = { signed: false }
  const hooks: SendHooks = {
    onSigned: async (hash, envelopeFee, maxTime) => {
      await ctx.runMutation(internal.sponsorStore.markSigned, {
        requestId,
        txHash: hash,
        envelopeFee,
        maxTime,
        now: Date.now(),
      })
      state.signed = true
    },
    onFee: (f) => {
      state.fee = f
    },
  }
  return { state, hooks }
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
    // The arguments before any limit slot or the secret.
    try {
      specFor(s.cfg, s.cfg.tabContractId, args)
    } catch (error) {
      throw toClientError(error)
    }
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
      await requireReady(ctx, s)
      const d = deps(s)
      const spec = specFor(s.cfg, reader, args)
      const p = await runPrepare(d, spec, now)
      await ctx.runMutation(internal.sponsorStore.recordPrepared, {
        requestId,
        entries: p.entries,
        maxExpiration: p.maxExpiration,
        commitStroops: commitStroops(spec.call).toString(),
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
      throw await closeAfterError(ctx, requestId, error, false, undefined)
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
    const { state, hooks } = hooksFor(ctx, args.requestId)
    try {
      await requireReady(ctx, s)
      const d = deps(s)
      const spec = specFor(s.cfg, row.reader, row as CallArgs)
      const result = await runSubmit(
        d,
        spec,
        row.entries,
        args.signedEntries,
        row.maxExpiration,
        hooks
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
      throw await closeAfterError(
        ctx,
        args.requestId,
        error,
        state.signed,
        state.fee
      )
    }
  },
})

/**
 * Deploys a passkey account from the kit's `{ func, auth }` payload.
 * Internal: the caller has verified the passkey registration behind it.
 * The same commitment, record and pending path as a balance call.
 */
export const deployAccount = internalAction({
  args: { func: v.string(), auth: v.array(v.string()), contractId: v.string() },
  handler: async (ctx, args): Promise<{ txHash: string; ledger: number }> => {
    const s = settings()
    const { requestId } = await ctx.runMutation(
      internal.sponsorStore.reserveDeploy,
      {
        reader: args.contractId,
        commitStroops: commitStroops('deploy').toString(),
        dailyBudgetStroops: s.cfg.dailyBudgetStroops.toString(),
        now: Date.now(),
      }
    )
    const { state, hooks } = hooksFor(ctx, requestId)
    try {
      await requireReady(ctx, s)
      const result = await runDeploy(deps(s), args, hooks)
      await ctx.runMutation(internal.sponsorStore.finish, {
        requestId,
        txHash: result.hash,
        feeStroops: result.fee,
        now: Date.now(),
      })
      return { txHash: result.hash, ledger: result.ledger }
    } catch (error) {
      throw await closeAfterError(
        ctx,
        requestId,
        error,
        state.signed,
        state.fee
      )
    }
  },
})

/**
 * Closes open requests from the network's answer: SUCCESS books the fee
 * charged; FAILED closes with it; not found closes as failed only once the
 * node's latest ledger closed after the transaction's upper time bound. Rows
 * left in `submitting` past their lifetime had nothing signed and close as
 * failed. It runs while the sponsor is off too, so no row stays open.
 */
export const reconcile = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number }> => {
    let rpcUrl: string
    try {
      rpcUrl = readChainEnv().rpcUrl
    } catch {
      return { checked: 0 }
    }
    const now = Date.now()
    const open = await ctx.runQuery(internal.sponsorStore.openRows, {
      now,
      olderThanMs: 30_000,
    })
    for (const requestId of open.abandoned) {
      await ctx.runMutation(internal.sponsorStore.fail, {
        requestId,
        error: 'SPONSOR_ABANDONED',
        now: Date.now(),
      })
    }
    if (open.pending.length === 0) return { checked: open.abandoned.length }
    const net = server(rpcUrl)
    for (const p of open.pending) {
      if (!p.txHash) continue
      let r: Awaited<ReturnType<typeof lookupSent>>
      try {
        r = await lookupSent(net, p.txHash)
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
      } else if (
        r.status === 'NOT_FOUND' &&
        knownNotLanded(r.latestLedgerCloseTime, p.maxTime)
      ) {
        await ctx.runMutation(internal.sponsorStore.fail, {
          requestId: p.requestId,
          error: 'SPONSOR_NOT_LANDED',
          force: true,
          now: Date.now(),
        })
      }
    }
    return { checked: open.pending.length + open.abandoned.length }
  },
})
