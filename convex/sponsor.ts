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
 * per-user and global limits; readiness (the first point where the secret is
 * read); then signing.
 *
 * Readiness fails closed: the secret parses and derives `SPONSOR_PUBLIC_KEY`;
 * the deployer is the account kit's; the account holds more than the floor;
 * the allowlisted account code exists on the network; and a transaction
 * signed by the sponsor simulates the Tab's `config`, whose token must be
 * `TOKEN_CONTRACT_ID`. Entries refuse (`SPONSOR_NOT_READY`) unless the latest
 * check for the current settings and key passed within `READINESS_TTL_MS`.
 * One caller at a time runs a stale check (a lease); others wait for it.
 *
 * What a public caller can see: a code and a fixed sentence per code
 * (`lib/sponsor/clientError.ts`). The public entries log codes only; the
 * detail of an error goes to a scheduled internal function
 * (`sponsorStore.logDetail`), because a development deployment returns a
 * function's log lines to its caller.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import {
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  BASE_FEE,
  rpc,
  scValToNative,
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
  errorDetail,
  toClientError,
  type SponsorErrorData,
} from './lib/sponsor/clientError'
import type { PreparedBalanceCall } from '../lib/balance/signer'
import {
  READINESS_TTL_MS,
  SponsorRefusal,
  commitStroops,
  kitDefaultDeployer,
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

/** Codes whose own sentences were written for the client (store refusals). */
const STORE_CODES = new Set([
  'NOT_SIGNED_IN',
  'SPONSOR_BUDGET_REACHED',
  'SPONSOR_RATE_LIMITED',
  'SPONSOR_EXPIRED',
  'SPONSOR_UNKNOWN_REQUEST',
  'SPONSOR_BAD_STATE',
  'SPONSOR_READER_NOT_PASSKEY',
])

/**
 * The one way a public entry reports an error: the code alone in its own
 * log line, the detail to the scheduled operator log, and a code with a
 * fixed sentence to the caller.
 */
async function report(
  ctx: ActionCtx,
  error: unknown,
  signed: boolean
): Promise<ConvexError<SponsorErrorData>> {
  const client = toClientError(error, signed)
  const code = codeOf(error)
  if (!code || !STORE_CODES.has(code)) {
    const { detail } = errorDetail(error)
    console.error(`[sponsor] ${client.data.code}`)
    try {
      await ctx.scheduler.runAfter(0, internal.sponsorStore.logDetail, {
        source: 'sponsor',
        code: code ?? 'unclassified',
        detail,
      })
    } catch {
      // The caller's answer does not depend on the operator log.
    }
  }
  return client
}

async function requireUser(ctx: ActionCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (!userId) {
    throw new ConvexError({ code: 'NOT_SIGNED_IN', message: 'Sign in first.' })
  }
  return userId
}

type Settings = { cfg: SponsorConfig; passphrase: string; rpcUrl: string }

/** The guarded settings, without the secret. Throws raw; callers report. */
function settings(): Settings {
  try {
    const cfg = sponsorConfig()
    const chain = readChainEnv()
    return { cfg, passphrase: chain.passphrase, rpcUrl: chain.rpcUrl }
  } catch (error) {
    if (error instanceof SponsorRefusal || error instanceof ConvexError)
      throw error
    throw new SponsorRefusal('SPONSOR_CONFIG_INVALID', String(error))
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

/** The public address the configured secret derives, or null when it does not parse. */
function derivedPublicKey(): string | null {
  const raw = process.env.SPONSOR_SECRET?.trim() ?? ''
  return StrKey.isValidEd25519SecretSeed(raw)
    ? Keypair.fromSecret(raw).publicKey()
    : null
}

/**
 * A hash of the settings and of the key the secret derives (its public
 * address). No digest of the secret itself is stored anywhere.
 */
function fingerprint(s: Settings, derived: string | null): string {
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
        key: derived ?? 'invalid',
      })
    )
    .digest('hex')
}

/**
 * The readiness check itself. Records causes by name only; never the
 * secret, anything derived from it, a balance or an RPC answer.
 */
async function checkSigner(
  ctx: ActionCtx,
  s: Settings,
  derived: string | null
): Promise<Readiness> {
  const failed: string[] = []
  const warnings: string[] = []
  const fp = fingerprint(s, derived)
  if (derived === null) {
    return {
      ready: false,
      failed: ['secret_invalid'],
      warnings,
      fingerprint: fp,
    }
  }
  if (derived !== s.cfg.publicKey) {
    return {
      ready: false,
      failed: ['secret_mismatch'],
      warnings,
      fingerprint: fp,
    }
  }
  if (s.cfg.accountDeployer !== kitDefaultDeployer())
    failed.push('deployer_mismatch')
  const key = Keypair.fromSecret(sponsorSecret())
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
    // the account loads, the key signs, the Tab answers with its token.
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
    else {
      const retval = (sim as rpc.Api.SimulateTransactionSuccessResponse).result
        ?.retval
      const config = retval
        ? (scValToNative(retval) as { token?: unknown } | null)
        : null
      if (!config || typeof config.token !== 'string')
        failed.push('config_unreadable')
      else if (config.token !== s.cfg.tokenContractId)
        failed.push('token_mismatch')
    }
  } catch {
    failed.push('simulation_failed')
  }
  const last = await ctx.runQuery(internal.sponsorStore.lastGoodSubmit, {})
  if (last === null) warnings.push('no_confirmed_call_yet')
  else if (Date.now() - last > 24 * 60 * 60_000)
    warnings.push('no_confirmed_call_in_24h')
  return { ready: failed.length === 0, failed, warnings, fingerprint: fp }
}

async function runCheck(
  ctx: ActionCtx,
  s: Settings,
  derived: string | null
): Promise<Readiness> {
  const r = await checkSigner(ctx, s, derived)
  await ctx.runMutation(internal.sponsorStore.recordReadiness, {
    service: 'sponsor',
    ...r,
  })
  if (!r.ready || r.warnings.length > 0) {
    await ctx.scheduler.runAfter(0, internal.sponsorStore.logDetail, {
      source: 'sponsor',
      code: r.ready ? 'SPONSOR_READY_WITH_WARNINGS' : 'SPONSOR_NOT_READY',
      detail: [...r.failed, ...r.warnings].join(', '),
    })
  }
  return r
}

const WAIT_STEP_MS = 250
const WAIT_LIMIT_MS = 10_000

/**
 * Refuses unless the latest check for these settings and key passed
 * recently. When the record is missing, stale or for other settings, one
 * caller takes the lease and runs the check; the others wait for its result.
 */
async function requireReady(ctx: ActionCtx, s: Settings): Promise<void> {
  const derived = derivedPublicKey()
  const fp = fingerprint(s, derived)
  const current = async () => {
    const row = await ctx.runQuery(internal.sponsorStore.readiness, {
      service: 'sponsor',
    })
    return row &&
      row.fingerprint === fp &&
      Date.now() - row.checkedAt < READINESS_TTL_MS
      ? row
      : null
  }
  let row = await current()
  if (!row) {
    if (
      await ctx.runMutation(internal.sponsorStore.leaseReadinessCheck, {
        service: 'sponsor',
      })
    ) {
      const r = await runCheck(ctx, s, derived)
      if (!r.ready) refuse('SPONSOR_NOT_READY', 'The fee sponsor is not ready.')
      return
    }
    for (
      let waited = 0;
      !row && waited < WAIT_LIMIT_MS;
      waited += WAIT_STEP_MS
    ) {
      await new Promise((r) => setTimeout(r, WAIT_STEP_MS))
      row = await current()
    }
  }
  if (!row?.ready) refuse('SPONSOR_NOT_READY', 'The fee sponsor is not ready.')
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
      })
      return null
    }
    return runCheck(ctx, s, derivedPublicKey())
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
 * Closes a request after an error, when its outcome is known:
 * - the node refused the envelope: failed, nothing was sent;
 * - the network answered FAILED: failed with the fee charged;
 * - nothing was signed yet: failed, nothing was sent.
 * A signed envelope that may have reached the node stays pending for the
 * reconciler.
 */
async function closeAfterError(
  ctx: ActionCtx,
  requestId: string,
  error: unknown,
  signed: boolean,
  fee: string | undefined
): Promise<void> {
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
}

/** Hooks that store the hash before the send and keep the fee charged. */
function hooksFor(ctx: ActionCtx, requestId: () => string | null) {
  const state: { signed: boolean; fee?: string } = { signed: false }
  const hooks: SendHooks = {
    onSigned: async (hash, envelopeFee, maxTime) => {
      await ctx.runMutation(internal.sponsorStore.markSigned, {
        requestId: requestId()!,
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
    let requestId: string | null = null
    try {
      const s = settings()
      // The arguments before any limit slot or the secret.
      specFor(s.cfg, s.cfg.tabContractId, args)
      const now = Date.now()
      const reserved = await ctx.runMutation(internal.sponsorStore.reserve, {
        userId,
        call: args.call,
        amount: args.amount,
        key: args.key,
        keyId: args.keyId,
        passphrase: s.passphrase,
        dailyBudgetStroops: s.cfg.dailyBudgetStroops.toString(),
        now,
      })
      requestId = reserved.requestId
      await requireReady(ctx, s)
      const d = deps(s)
      const spec = specFor(s.cfg, reserved.reader, args)
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
      if (requestId)
        await closeAfterError(ctx, requestId, error, false, undefined)
      throw await report(ctx, error, false)
    }
  },
})

/** Submits a prepared call with the passkey's signed entries. */
export const submit = action({
  args: { requestId: v.string(), signedEntries: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ txHash: string; ledger: number }> => {
    const userId = await requireUser(ctx)
    let claimed = false
    const { state, hooks } = hooksFor(ctx, () => args.requestId)
    try {
      const s = settings()
      const row = await ctx.runMutation(internal.sponsorStore.claim, {
        requestId: args.requestId,
        userId,
      })
      claimed = true
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
      if (claimed)
        await closeAfterError(
          ctx,
          args.requestId,
          error,
          state.signed,
          state.fee
        )
      throw await report(ctx, error, state.signed)
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
    let requestId: string | null = null
    const { state, hooks } = hooksFor(ctx, () => requestId)
    try {
      const s = settings()
      requestId = (
        await ctx.runMutation(internal.sponsorStore.reserveDeploy, {
          reader: args.contractId,
          commitStroops: commitStroops('deploy').toString(),
          dailyBudgetStroops: s.cfg.dailyBudgetStroops.toString(),
          now: Date.now(),
        })
      ).requestId
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
      if (requestId)
        await closeAfterError(ctx, requestId, error, state.signed, state.fee)
      throw await report(ctx, error, state.signed)
    }
  },
})

/**
 * Closes open requests from the network's answer: SUCCESS books the fee
 * charged; FAILED closes with it; not found closes as failed only when the
 * node's history covers the whole window the transaction could have landed
 * in (it starts at or before the signing time and ends after the upper time
 * bound). Rows left in `submitting` past their lifetime had nothing signed
 * and close as failed. It runs while the sponsor is off too.
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
      } else if (r.status === 'NOT_FOUND' && knownNotLanded(r, p)) {
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
