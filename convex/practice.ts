'use node'
/**
 * Testnet practice money from the practice treasury, through the Tab's grant
 * entry points (the treasury holds the Tab's `grantor` role).
 *
 * - `grantFirst` (signed in, once per account): `grant_session` gives the
 *   reader's passkey account the gift and registers the device key the
 *   reader's browser made, with a cap of the whole gift, for
 *   `PRACTICE_KEY_DAYS` days. The first tip needs no signature of the
 *   reader's own. The contract lets that key spend gift only.
 * - `grantDaily` (signed in, once a day after the first): `grant_gift` adds
 *   the gift and raises the same key's cap by it while that key is live, so
 *   there is no new approval.
 * - `reconcile` (internal, cron): closes open grants from the network's
 *   answer, from any day, while grants are off too.
 * - `checkReadiness` (internal, cron): the treasury's readiness check.
 *
 * Order: sign-in, the testnet guard, `PRACTICE_GRANTS_ENABLED`, the price,
 * the two limits (`practiceStore.reserve`: once a day per account, a daily
 * treasury budget), readiness, then the treasury key for signing.
 *
 * Readiness fails closed: the treasury secret parses and derives
 * `PRACTICE_TREASURY_PUBLIC_KEY`, the account holds the floor plus one gift,
 * and a signed simulation shows it holds the Tab's `grantor` role.
 *
 * A grant's record (hash and time bound) is written before it is sent. Only
 * the node's refusal means "not sent"; anything else after signing waits for
 * the network. Errors reach the client as a code and a fixed sentence.
 * `PRACTICE_REFUSALS` lists the codes for the sheet.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import {
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import { createHash } from 'node:crypto'
import { ConvexError, v } from 'convex/values'
import { api, internal } from './_generated/api'
import { action, internalAction, type ActionCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { readChainEnv } from './lib/chain/env'
import { centsToStroops } from './lib/chain/tabLedger'
import { assertBackendTestnet } from './lib/networkGuard'
import { codeOf, errorDetail, toClientError } from './lib/sponsor/clientError'
import { READINESS_TTL_MS, refuse } from './lib/sponsor/policy'
import {
  knownNotLanded,
  lookupSent,
  sendAsSource,
  type SendHooks,
} from './lib/sponsor/run'

type EnvLike = Record<string, string | undefined>

/** What the newcomer sheet shows for each refusal: never a dead end. */
export const PRACTICE_REFUSALS = [
  'PRACTICE_PAUSED',
  'PRACTICE_NOT_READY',
  'PRACTICE_EMPTY',
  'PRACTICE_BUSY',
  'PRACTICE_TODAY_USED',
  'PRACTICE_ALREADY_STARTED',
  'PRACTICE_NOT_STARTED',
  'PRACTICE_NOT_PASSKEY',
  'PRACTICE_PRICE_UNAVAILABLE',
  'PRACTICE_PENDING',
] as const

/** Ledgers per day at about 5 s each. */
export const DAY_LEDGERS = 17_280
/** The Tab's `MAX_KEY_LIFETIME` is 30 days; a granted key stays inside it. */
const MAX_KEY_DAYS = 29
/**
 * Resource fee cap per grant. Measured on a fresh testnet Tab: 1,870,270
 * stroops charged for the first `grant_session`, 1,337,066 after, 476,535 for
 * a `grant_gift` that raises a key.
 */
const GRANT_FEE_CAP = BigInt(3_000_000)
const UNAVAILABLE = 'Practice money is not available right now.'

function intSetting(env: EnvLike, name: string, fallback: number): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n <= 0)
    refuse('PRACTICE_CONFIG_INVALID', `${name} must be a positive integer.`)
  return n
}

export function practiceConfig(env: EnvLike = process.env) {
  assertBackendTestnet(env)
  if (env.PRACTICE_GRANTS_ENABLED?.trim() !== 'true') {
    refuse('PRACTICE_PAUSED', 'Practice money is paused for now.')
  }
  const tab = env.TAB_CONTRACT_ID?.trim() ?? ''
  if (!StrKey.isValidContract(tab))
    refuse('PRACTICE_CONFIG_INVALID', 'TAB_CONTRACT_ID is not set.')
  const treasuryPublicKey = env.PRACTICE_TREASURY_PUBLIC_KEY?.trim() ?? ''
  if (!StrKey.isValidEd25519PublicKey(treasuryPublicKey))
    refuse(
      'PRACTICE_CONFIG_INVALID',
      'PRACTICE_TREASURY_PUBLIC_KEY is not an account address.'
    )
  const keyDays = intSetting(env, 'PRACTICE_KEY_DAYS', 7)
  if (keyDays > MAX_KEY_DAYS)
    refuse(
      'PRACTICE_CONFIG_INVALID',
      `PRACTICE_KEY_DAYS must be at most ${MAX_KEY_DAYS}.`
    )
  return {
    tabContractId: tab,
    treasuryPublicKey,
    giftCents: intSetting(env, 'PRACTICE_GIFT_CENTS', 500),
    keyDays,
    /** Default 5,000 XLM a day for everyone. */
    dailyBudgetStroops: BigInt(
      intSetting(env, 'PRACTICE_DAILY_BUDGET_STROOPS', 50_000_000_000)
    ),
    minTreasury: BigInt(
      intSetting(env, 'PRACTICE_MIN_TREASURY_STROOPS', 10_000_000_000)
    ),
  }
}

type Config = ReturnType<typeof practiceConfig>

type PracticeErrorData = { code: string; message: string }

/** Refusals of ours whose sentences were written for the client. */
const CLIENT_CODES = new Set([
  'NOT_SIGNED_IN',
  'PRACTICE_PAUSED',
  'PRACTICE_BUSY',
  'PRACTICE_TODAY_USED',
  'PRACTICE_ALREADY_STARTED',
  'PRACTICE_NOT_STARTED',
  'PRACTICE_NOT_PASSKEY',
  'PRACTICE_PRICE_UNAVAILABLE',
  'PRACTICE_INVALID',
  'PRACTICE_PENDING',
  // PRACTICE_EMPTY is not here: its refusal carries figures for operators,
  // so the caller gets the fixed "not available right now".
])

const WAITING = 'Waiting for Stellar testnet to confirm it.'

/**
 * The client's view of an error, a code and a fixed sentence:
 * - our own refusals keep the sentence written for the client;
 * - configuration and readiness codes say only "not available right now";
 * - network outcomes follow the sponsor's rules, where "Nothing was sent" is
 *   said only when that is known.
 */
function toPracticeError(
  error: unknown,
  signed = false
): ConvexError<PracticeErrorData> {
  const code = codeOf(error)
  if (code && CLIENT_CODES.has(code)) {
    const message =
      error instanceof ConvexError
        ? (error.data as PracticeErrorData).message
        : (error as Error).message
    return new ConvexError({ code, message })
  }
  if (code && !code.startsWith('SPONSOR_')) {
    return new ConvexError({ code, message: UNAVAILABLE })
  }
  const e = toClientError(error, signed)
  const renamed: Record<string, string> = {
    SPONSOR_PENDING: 'PRACTICE_PENDING',
    SPONSOR_FAILED: 'PRACTICE_FAILED',
  }
  return renamed[e.data.code]
    ? new ConvexError({ code: renamed[e.data.code]!, message: e.data.message })
    : e
}

/**
 * The one way a public entry reports an error: the code alone in its own log
 * line (a development deployment returns log lines to the caller), the detail
 * to the scheduled operator log, and a code with a fixed sentence to the
 * caller.
 */
async function report(
  ctx: ActionCtx,
  error: unknown,
  signed: boolean
): Promise<ConvexError<PracticeErrorData>> {
  const client = toPracticeError(error, signed)
  const code = codeOf(error)
  if (!code || !CLIENT_CODES.has(code)) {
    console.error(`[practice] ${client.data.code}`)
    try {
      await ctx.scheduler.runAfter(0, internal.sponsorStore.logDetail, {
        source: 'practice',
        ...errorDetail(error),
      })
    } catch {
      // The caller's answer does not depend on the operator log.
    }
  }
  return client
}

async function requireUser(ctx: ActionCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (!userId)
    throw new ConvexError({ code: 'NOT_SIGNED_IN', message: 'Sign in first.' })
  return userId
}

function rpcServer(url: string) {
  return new rpc.Server(url, { allowHttp: url.startsWith('http://') })
}

// ----- Readiness -----

type Readiness = {
  ready: boolean
  failed: string[]
  warnings: string[]
  fingerprint: string
}

/** The public address the treasury secret derives, or null when it does not parse. */
function derivedPublicKey(): string | null {
  const raw = process.env.PRACTICE_TREASURY_SECRET?.trim() ?? ''
  return StrKey.isValidEd25519SecretSeed(raw)
    ? Keypair.fromSecret(raw).publicKey()
    : null
}

/**
 * A hash of the settings and of the key the secret derives (its public
 * address). No digest of the secret itself is stored anywhere.
 */
function fingerprint(
  cfg: Config,
  rpcUrl: string,
  derived: string | null
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        tab: cfg.tabContractId,
        publicKey: cfg.treasuryPublicKey,
        floor: cfg.minTreasury.toString(),
        gift: cfg.giftCents,
        rpc: rpcUrl,
        key: derived ?? 'invalid',
      })
    )
    .digest('hex')
}

/**
 * The treasury's readiness. Never logs or returns the secret or anything
 * derived from it except the comparison's result.
 */
async function checkTreasury(
  ctx: ActionCtx,
  cfg: Config,
  derived: string | null
): Promise<Readiness> {
  const chain = readChainEnv()
  const fp = fingerprint(cfg, chain.rpcUrl, derived)
  const warnings: string[] = []
  const failed: string[] = []
  const raw = process.env.PRACTICE_TREASURY_SECRET?.trim() ?? ''
  if (derived === null) {
    return {
      ready: false,
      failed: ['secret_invalid'],
      warnings,
      fingerprint: fp,
    }
  }
  const key = Keypair.fromSecret(raw)
  if (derived !== cfg.treasuryPublicKey) {
    return {
      ready: false,
      failed: ['secret_mismatch'],
      warnings,
      fingerprint: fp,
    }
  }
  const net = rpcServer(chain.rpcUrl)
  const price = await ctx.runQuery(api.xlmPrice.getCachedXlmPrice, {})
  if (!price) failed.push('price_unavailable')
  try {
    const entry = await net.getAccountEntry(cfg.treasuryPublicKey)
    const balance = BigInt(
      String((entry as unknown as { balance: unknown }).balance)
    )
    const gift = price
      ? centsToStroops(cfg.giftCents, price.priceUsd)
      : BigInt(0)
    if (balance < cfg.minTreasury + gift) failed.push('below_floor_plus_gift')
  } catch {
    failed.push('account_unreadable')
  }
  try {
    // A real transaction signed by the treasury, simulated and never sent:
    // the account loads, the key signs, and the Tab says it holds the role.
    const account = await net.getAccount(cfg.treasuryPublicKey)
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: chain.passphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: cfg.tabContractId,
          function: 'has_role',
          args: [
            new Address(cfg.treasuryPublicKey).toScVal(),
            xdr.ScVal.scvSymbol('grantor'),
          ],
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
      const role = retval ? scValToNative(retval) : null
      if (role === null || role === undefined) failed.push('not_grantor')
    }
  } catch {
    failed.push('simulation_failed')
  }
  const last = await ctx.runQuery(internal.practiceStore.lastGoodGrant, {})
  if (last === null) warnings.push('no_confirmed_grant_yet')
  return { ready: failed.length === 0, failed, warnings, fingerprint: fp }
}

async function runCheck(
  ctx: ActionCtx,
  cfg: Config,
  derived: string | null
): Promise<Readiness> {
  const r = await checkTreasury(ctx, cfg, derived)
  await ctx.runMutation(internal.sponsorStore.recordReadiness, {
    service: 'practice',
    ...r,
  })
  if (!r.ready || r.warnings.length > 0) {
    await ctx.scheduler.runAfter(0, internal.sponsorStore.logDetail, {
      source: 'practice',
      code: r.ready ? 'PRACTICE_READY_WITH_WARNINGS' : 'PRACTICE_NOT_READY',
      detail: [...r.failed, ...r.warnings].join(', '),
    })
  }
  return r
}

const WAIT_STEP_MS = 250
const WAIT_LIMIT_MS = 10_000

/**
 * Refuses unless the latest check for these settings and key passed
 * recently; one caller runs a missing or stale check under the lease, the
 * others wait for its result.
 */
async function requireReady(ctx: ActionCtx, cfg: Config): Promise<void> {
  const derived = derivedPublicKey()
  const fp = fingerprint(cfg, readChainEnv().rpcUrl, derived)
  const current = async () => {
    const row = await ctx.runQuery(internal.sponsorStore.readiness, {
      service: 'practice',
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
        service: 'practice',
      })
    ) {
      const r = await runCheck(ctx, cfg, derived)
      if (!r.ready)
        refuse('PRACTICE_NOT_READY', 'The practice treasury is not ready.')
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
  if (!row?.ready)
    refuse('PRACTICE_NOT_READY', 'The practice treasury is not ready.')
}

/** Runs the treasury's readiness check (cron, and on demand). */
export const checkReadiness = internalAction({
  args: {},
  handler: async (ctx): Promise<Readiness | null> => {
    let cfg: Config
    try {
      cfg = practiceConfig()
    } catch {
      await ctx.runMutation(internal.sponsorStore.recordReadiness, {
        service: 'practice',
        ready: false,
        failed: ['config'],
        warnings: [],
        fingerprint: '',
      })
      return null
    }
    return runCheck(ctx, cfg, derivedPublicKey())
  },
})

// ----- Grants -----

type GrantArgs = { kind: 'session'; devicePublicKey: string } | { kind: 'gift' }

export type GrantResult = {
  txHash: string
  ledger: number
  amount: string
  keyId: number | null
  spendLimit: string | null
  validUntil: number | null
}

async function grant(
  ctx: ActionCtx,
  userId: Id<'users'>,
  g: GrantArgs
): Promise<GrantResult> {
  const state: { signed: boolean } = { signed: false }
  try {
    return await grantSteps(ctx, userId, g, state)
  } catch (error) {
    throw await report(ctx, error, state.signed)
  }
}

async function grantSteps(
  ctx: ActionCtx,
  userId: Id<'users'>,
  g: GrantArgs,
  state: { signed: boolean }
): Promise<GrantResult> {
  const cfg = practiceConfig()
  if (
    g.kind === 'session' &&
    (!/^[0-9a-f]{64}$/.test(g.devicePublicKey) ||
      /^0+$/.test(g.devicePublicKey))
  ) {
    throw new ConvexError({
      code: 'PRACTICE_INVALID',
      message: 'Invalid device key.',
    })
  }
  // The same browser asking again for its first grant gets that grant, or
  // "still pending"; another device key is refused by `reserve`.
  if (g.kind === 'session') {
    const replay = await ctx.runQuery(internal.practiceStore.sessionReplay, {
      userId,
      devicePublicKey: g.devicePublicKey,
    })
    if (replay?.status === 'sent' && replay.txHash) {
      return {
        txHash: replay.txHash,
        ledger: replay.ledger ?? 0,
        amount: replay.amount,
        keyId: replay.keyId ?? 0,
        spendLimit: replay.amount,
        validUntil: replay.validUntil,
      }
    }
    if (replay?.status === 'pending') {
      throw new ConvexError({ code: 'PRACTICE_PENDING', message: WAITING })
    }
  }
  const price = await ctx.runQuery(api.xlmPrice.getCachedXlmPrice, {})
  if (!price)
    throw new ConvexError({
      code: 'PRACTICE_PRICE_UNAVAILABLE',
      message: 'No current XLM price.',
    })
  const amount = centsToStroops(cfg.giftCents, price.priceUsd)
  const chain = readChainEnv()
  const server = rpcServer(chain.rpcUrl)
  const latestLedger = (await server.getLatestLedger()).sequence
  const validUntil =
    g.kind === 'session' ? latestLedger + cfg.keyDays * DAY_LEDGERS : undefined
  const { grantId, reader, raiseKeyId } = await ctx.runMutation(
    internal.practiceStore.reserve,
    {
      userId,
      kind: g.kind,
      amount: amount.toString(),
      ...(g.kind === 'session' ? { devicePublicKey: g.devicePublicKey } : {}),
      ...(validUntil !== undefined ? { validUntil } : {}),
      passphrase: chain.passphrase,
      chainEpoch: chain.chainEpoch,
      latestLedger,
      dailyBudgetStroops: cfg.dailyBudgetStroops.toString(),
      now: Date.now(),
    }
  )
  const hooks: SendHooks = {
    onSigned: async (hash, _fee, maxTime) => {
      await ctx.runMutation(internal.practiceStore.markSigned, {
        grantId,
        txHash: hash,
        maxTime,
        now: Date.now(),
      })
      state.signed = true
    },
  }
  try {
    await requireReady(ctx, cfg)
    const treasury = Keypair.fromSecret(
      process.env.PRACTICE_TREASURY_SECRET?.trim() ?? ''
    )
    const account = await server.getAccountEntry(treasury.publicKey())
    const balance = BigInt(
      String((account as unknown as { balance: unknown }).balance)
    )
    if (balance < cfg.minTreasury) {
      // The figures are for operators (the scheduled log), never the caller.
      refuse(
        'PRACTICE_EMPTY',
        `Treasury balance ${balance} is below the floor ${cfg.minTreasury}.`
      )
    }
    const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' })
    const funder = new Address(treasury.publicKey()).toScVal()
    const readerVal = new Address(reader).toScVal()
    const op =
      g.kind === 'session'
        ? Operation.invokeContractFunction({
            contract: cfg.tabContractId,
            function: 'grant_session',
            args: [
              funder,
              readerVal,
              i128(amount),
              xdr.ScVal.scvBytes(Buffer.from(g.devicePublicKey, 'hex')),
              nativeToScVal(validUntil, { type: 'u32' }),
              // The key may spend the whole gift, and only the gift.
              i128(amount),
            ],
          })
        : Operation.invokeContractFunction({
            contract: cfg.tabContractId,
            function: 'grant_gift',
            args: [
              funder,
              readerVal,
              i128(amount),
              raiseKeyId === null
                ? xdr.ScVal.scvVoid()
                : nativeToScVal(raiseKeyId, { type: 'u32' }),
            ],
          })
    const result = await sendAsSource(
      server,
      chain.passphrase,
      treasury,
      op,
      GRANT_FEE_CAP,
      hooks
    )
    // `grant_session` lands only on an unused account, so its key id is 0.
    const keyId =
      g.kind === 'session'
        ? result.returnValue
          ? Number(scValToNative(result.returnValue))
          : 0
        : (raiseKeyId ?? undefined)
    await ctx.runMutation(internal.practiceStore.finish, {
      grantId,
      txHash: result.hash,
      ...(keyId !== undefined ? { keyId } : {}),
      ledger: result.ledger,
      now: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.chain.indexer.pollEvents, {})
    return {
      txHash: result.hash,
      ledger: result.ledger,
      amount: amount.toString(),
      keyId: keyId ?? null,
      spendLimit: g.kind === 'session' ? amount.toString() : null,
      validUntil: validUntil ?? null,
    }
  } catch (error) {
    const code = codeOf(error)
    // Closed here only when the outcome is known: the node refused the
    // envelope, the network answered FAILED, or nothing was signed yet.
    // Anything else after signing waits for the reconciler.
    if (
      code === 'SPONSOR_SEND_REFUSED' ||
      code === 'SPONSOR_TX_FAILED' ||
      !state.signed
    ) {
      await ctx.runMutation(internal.practiceStore.fail, {
        grantId,
        error: code ?? 'PRACTICE_FAILED',
        force: true,
        now: Date.now(),
      })
    }
    throw error
  }
}

/** The first practice money, with this device's key capped at the gift. */
export const grantFirst = action({
  args: { devicePublicKey: v.string() },
  handler: async (ctx, args): Promise<GrantResult> => {
    const userId = await requireUser(ctx)
    return grant(ctx, userId, {
      kind: 'session',
      devicePublicKey: args.devicePublicKey,
    })
  },
})

/** Practice money again (once a day), raising the granted key when live. */
export const grantDaily = action({
  args: {},
  handler: async (ctx): Promise<GrantResult> => {
    const userId = await requireUser(ctx)
    return grant(ctx, userId, { kind: 'gift' })
  },
})

/** A pending grant with no hash after this long was never signed. */
const NO_HASH_AFTER_MS = 10 * 60_000

/**
 * Closes open grants from the network's answer: SUCCESS finishes it; FAILED
 * fails it; not found fails it only once the node's latest ledger closed
 * after the grant's upper time bound. A grant with no hash was never signed
 * (the hash is stored before the send) and fails after `NO_HASH_AFTER_MS`.
 * It runs while grants are off too, so no grant stays open.
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
    const open = await ctx.runQuery(internal.practiceStore.openGrants, {
      now,
      olderThanMs: 30_000,
    })
    if (open.length === 0) return { checked: 0 }
    const server = rpcServer(rpcUrl)
    for (const p of open) {
      if (!p.txHash) {
        if (now - p.updatedAt >= NO_HASH_AFTER_MS) {
          await ctx.runMutation(internal.practiceStore.fail, {
            grantId: p.grantId,
            error: 'PRACTICE_NOT_SIGNED',
            force: true,
            now: Date.now(),
          })
        }
        continue
      }
      let r: Awaited<ReturnType<typeof lookupSent>>
      try {
        r = await lookupSent(server, p.txHash)
      } catch {
        continue
      }
      if (r.status === 'SUCCESS') {
        await ctx.runMutation(internal.practiceStore.finish, {
          grantId: p.grantId,
          txHash: p.txHash,
          // `grant_session` lands only on an unused account: its key is 0.
          ...(p.kind === 'session' ? { keyId: 0 } : {}),
          now: Date.now(),
        })
      } else if (
        r.status === 'FAILED' ||
        (r.status === 'NOT_FOUND' && knownNotLanded(r, p))
      ) {
        await ctx.runMutation(internal.practiceStore.fail, {
          grantId: p.grantId,
          error:
            r.status === 'FAILED' ? 'SPONSOR_TX_FAILED' : 'PRACTICE_NOT_LANDED',
          force: true,
          now: Date.now(),
        })
      }
    }
    return { checked: open.length }
  },
})
