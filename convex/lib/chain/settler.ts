/**
 * The tab settler (docs/architecture/v2/03-tab-contract.md, sections 3.2 and
 * 3.8; 05-flows-and-admin.md, section 5.7).
 *
 * `runSettlementCycle` is the whole run with its dependencies injected: the
 * Convex ledger, the chain, and a `SettlementSubmitter`. The Convex action
 * (`convex/tabSettler.ts`) wires the real ones after the network guard; tests
 * and the local-network suite wire their own.
 *
 * Safety rules:
 * - **Single flight.** A run holds the `settler` lease. At most one settlement
 *   is open per settler account; a run that finds one open resolves it first
 *   and submits nothing new while it is pending.
 * - **No lost settlement.** The signed envelope and its hash are recorded
 *   before it is sent. A run that crashes after sending finds the record and
 *   looks the transaction up.
 * - **No double settlement.** A pair in an open settlement is never selected
 *   again, and the contract skips a voucher that is already paid (`STALE`).
 * - **One bad voucher cannot sink a batch.** Pre-checks verify every
 *   signature with the shared encoder; simulation failures are bisected down
 *   to the failing voucher, which is marked `REJECTED` for review.
 */
import { StrKey, xdr, Address } from '@stellar/stellar-sdk'
import { decodeContractEventXdr } from './events'
import { hexToBytes, isHexOfLength } from './ids'
import { toStoredValue } from './indexerStore'
import { DAY_LEDGERS, type AcceptedVoucher } from './tabLedger'
import { networkIdOf, verifyEd25519, voucherPayloadBytes } from './voucher'

export const MAX_SETTLE_BATCH = 32
/** Final state of a settlement record (not a tip status). */
export const SETTLEMENT_CONFIRMED = 'CONFIRMED' as const
/** Due when the oldest unsettled receipt is older than this (3.8, rule 1). */
export const DUE_AGE_MS = 6 * 60 * 60 * 1000
/** Due when the unsettled amount reaches this (3.8, rule 2). */
export const DUE_AMOUNT = BigInt(50_000_000)
/** Due, and settled first after closing tabs, this close to the window end. */
export const EXPIRING_LEDGERS = 2 * DAY_LEDGERS
/** Settler lag alerts (3.7). */
export const LAG_ALERT_MS = [6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000] as const
/** Settler account balance alert (3.8). */
export const BALANCE_ALERT_STROOPS = BigInt(500_000_000)
/** Seconds between building a settlement and its upper time bound. */
export const SETTLE_TX_WINDOW_SECONDS = 300
/** A transaction not found this long after its upper bound never landed. */
export const SETTLE_EXPIRY_MARGIN_SECONDS = 30
/** Sweep calls per run; each closes up to its limit per queue. */
export const MAX_SWEEP_CALLS = 5
/** Upper bound on simulations in one run (bisection of 32 vouchers). */
export const MAX_SIMULATIONS = 80

// ---------------------------------------------------------------------------
// Types

export type SettleCandidate = {
  voucherId: string
  chainEpoch: string
  voucher: AcceptedVoucher
  paidOnChain: string
  /** `cumulative − paidOnChain`. */
  unsettledAmount: string
  oldestUnsettledAt: number | null
  accountStatus: 'OPEN' | 'CLOSING' | 'CLOSED' | null
  /** Last ledger the contract settles this pair (`valid_until + SETTLE_GRACE`). */
  settleBy: number
}

export type DueReason = 'closing' | 'expiring' | 'age' | 'amount'

/** A voucher as `Tab.settle` takes it. */
export type SettleVoucher = {
  reader: string
  writer: string
  keyId: number
  cumulative: bigint
  receiptsRoot: Uint8Array
  signature: Uint8Array
}

export type SimulationOutcome =
  | { ok: true }
  | { ok: false; kind: 'contract' | 'transient'; message: string }

export type PreparedSubmission = {
  /** Stable for this envelope: the transaction hash for `localKey`. */
  reference: string
  txHash: string | null
  envelopeXdr: string | null
}

export type SendOutcome =
  | { status: 'sent' }
  | { status: 'rejected'; message: string }
  | { status: 'transient'; message: string }

export type LookupOutcome =
  | { status: 'pending' | 'not_found' }
  | { status: 'failed'; txHash: string; ledger: number | null }
  | {
      status: 'success'
      txHash: string
      ledger: number
      /** Base64 `ContractEvent` XDR, one list per operation. */
      contractEventsXdr: string[][]
    }

/**
 * Submits `Tab.settle` for the settler role. `localKey` signs with
 * `TAB_SETTLER_SECRET`; a hosted relayer implements the same contract with
 * its own reference (for example a job id) and its own account.
 */
export interface SettlementSubmitter {
  readonly kind: 'localKey' | 'relayer'
  /** The address that holds the `settler` role (the `settler` argument). */
  readonly settlerAddress: string
  simulate(vouchers: SettleVoucher[]): Promise<SimulationOutcome>
  /** Builds and signs; sends nothing. */
  prepare(
    vouchers: SettleVoucher[],
    maxTime: number
  ): Promise<PreparedSubmission>
  /** Sends a prepared submission. Safe to repeat with the same one. */
  send(prepared: PreparedSubmission): Promise<SendOutcome>
  lookup(prepared: PreparedSubmission): Promise<LookupOutcome>
  /** The settler account's native balance in stroops, if known. */
  balance(): Promise<bigint | null>
}

export type SettlementOutcome =
  | {
      kind: 'settled'
      reader: string
      writer: string
      keyId: number
      cumulative: string
      paidAfter: string
      gross: string
      fee: string
    }
  | {
      kind: 'skipped'
      reader: string
      writer: string
      keyId: number
      cumulative: string
      reason: number
    }

export type OpenSettlement = {
  settlementId: string
  status: 'PREPARED' | 'SUBMITTED'
  reference: string | null
  txHash: string | null
  envelopeXdr: string | null
  maxTime: number
  attempts: number
}

export type SettlementFinish =
  | {
      status: typeof SETTLEMENT_CONFIRMED
      txHash: string
      ledger: number
      outcomes: SettlementOutcome[]
    }
  | { status: 'FAILED' | 'EXPIRED'; reason: string; txHash?: string }

export type SelectionResult = {
  candidates: SettleCandidate[]
  /** Oldest unsettled receipt among selectable pairs (ms), for the lag alert. */
  oldestUnsettledAt: number | null
  /** Pairs within `EXPIRING_LEDGERS` of their window end, with their value. */
  expiring: { count: number; amount: string }
}

/** The Convex side of a run. */
export type SettlementLedger = {
  acquireLease(holder: string): Promise<boolean>
  releaseLease(holder: string): Promise<void>
  openSettlements(): Promise<OpenSettlement[]>
  sweepExpired(ledger: number): Promise<{ closed: number; more: boolean }>
  select(args: { ledger: number; now: number }): Promise<SelectionResult>
  reject(items: Array<{ voucherId: string; reason: string }>): Promise<void>
  begin(args: {
    voucherIds: string[]
    cumulatives: string[]
    submitter: string
    maxTime: number
  }): Promise<string>
  recordPrepared(
    settlementId: string,
    prepared: PreparedSubmission
  ): Promise<void>
  noteAttempt(settlementId: string, error: string): Promise<void>
  finish(settlementId: string, result: SettlementFinish): Promise<void>
}

export type SettlerDeps = {
  holder: string
  passphrase: string
  tabContractId: string
  ledger: SettlementLedger
  latestLedger(): Promise<{ sequence: number; closeTime: number }>
  submitter: SettlementSubmitter
  now(): number
  log(code: string, details: Record<string, unknown>): void
  /** Waits between lookups of a just-sent transaction. */
  sleep(ms: number): Promise<void>
  /** Lookups after sending before the run leaves the result to the next run. */
  pollAttempts?: number
}

export type CycleResult = {
  status:
    | 'busy'
    | 'idle'
    | 'pending'
    | 'confirmed'
    | 'failed'
    | 'expired'
    | 'nothing_due'
  settlementId?: string
  submitted: number
  rejected: number
  resumed: number
  swept: number
}

// ---------------------------------------------------------------------------
// Due rules and ordering (3.8)

export function dueReasons(
  c: SettleCandidate,
  at: { ledger: number; now: number }
): DueReason[] {
  const reasons: DueReason[] = []
  if (c.accountStatus === 'CLOSING' || c.accountStatus === 'CLOSED') {
    reasons.push('closing')
  }
  if (c.settleBy - at.ledger <= EXPIRING_LEDGERS) reasons.push('expiring')
  if (
    c.oldestUnsettledAt !== null &&
    at.now - c.oldestUnsettledAt > DUE_AGE_MS
  ) {
    reasons.push('age')
  }
  if (BigInt(c.unsettledAmount) >= DUE_AMOUNT) reasons.push('amount')
  return reasons
}

/**
 * Due pairs in batch order: closing accounts first, then the soonest window
 * end, then the oldest unsettled receipt.
 */
export function orderDue(
  candidates: SettleCandidate[],
  at: { ledger: number; now: number }
): SettleCandidate[] {
  const due = candidates
    .map((c) => ({ c, reasons: dueReasons(c, at) }))
    .filter((x) => x.reasons.length > 0)
  const rank = (r: DueReason[]) => (r.includes('closing') ? 0 : 1)
  due.sort((a, b) => {
    const byClosing = rank(a.reasons) - rank(b.reasons)
    if (byClosing !== 0) return byClosing
    if (a.c.settleBy !== b.c.settleBy) return a.c.settleBy - b.c.settleBy
    const ageA = a.c.oldestUnsettledAt ?? Number.MAX_SAFE_INTEGER
    const ageB = b.c.oldestUnsettledAt ?? Number.MAX_SAFE_INTEGER
    if (ageA !== ageB) return ageA - ageB
    return a.c.voucherId < b.c.voucherId ? -1 : 1
  })
  return due.map((x) => x.c)
}

// ---------------------------------------------------------------------------
// Pre-checks (3.2, abort conditions)

/**
 * Rebuilds the payload with the shared encoder and verifies the session
 * signature, as `settle` will. Returns a rejection reason, or null.
 */
export function precheck(
  c: SettleCandidate,
  chain: { passphrase: string; tabContractId: string }
): string | null {
  const v = c.voucher
  if (v.tabContractId !== chain.tabContractId) return 'tab_contract'
  if (!isHexOfLength(v.publicKey, 32)) return 'public_key'
  if (!isHexOfLength(v.receiptsRoot, 32) || !isHexOfLength(v.signature, 64)) {
    return 'encoding'
  }
  if (
    !(
      StrKey.isValidEd25519PublicKey(v.reader) ||
      StrKey.isValidContract(v.reader)
    ) ||
    !(
      StrKey.isValidEd25519PublicKey(v.writer) ||
      StrKey.isValidContract(v.writer)
    )
  ) {
    return 'address'
  }
  let cumulative: bigint
  try {
    cumulative = BigInt(v.cumulative)
  } catch {
    return 'encoding'
  }
  if (cumulative <= BigInt(c.paidOnChain)) return 'stale'
  try {
    const payload = voucherPayloadBytes({
      tab: v.tabContractId,
      networkId: networkIdOf(chain.passphrase),
      reader: v.reader,
      writer: v.writer,
      keyId: v.keyId,
      publicKey: hexToBytes(v.publicKey),
      cumulative,
      receiptsRoot: hexToBytes(v.receiptsRoot),
    })
    return verifyEd25519(v.publicKey, payload, v.signature) ? null : 'signature'
  } catch {
    return 'encoding'
  }
}

export function toSettleVoucher(c: SettleCandidate): SettleVoucher {
  return {
    reader: c.voucher.reader,
    writer: c.voucher.writer,
    keyId: c.voucher.keyId,
    cumulative: BigInt(c.voucher.cumulative),
    receiptsRoot: hexToBytes(c.voucher.receiptsRoot),
    signature: hexToBytes(c.voucher.signature),
  }
}

/**
 * The `Voucher` struct as an `ScVal::Map` with keys in ascending order.
 * `settle` ignores the acceptance, so both acceptance fields are `None`.
 */
export function voucherScVal(v: SettleVoucher): xdr.ScVal {
  const i128 = (value: bigint) => {
    const u = BigInt.asUintN(128, value)
    return xdr.ScVal.scvI128(
      new xdr.Int128Parts({
        hi: xdr.Int64.fromString(BigInt.asIntN(64, u >> BigInt(64)).toString()),
        lo: xdr.Uint64.fromString(
          (u & ((BigInt(1) << BigInt(64)) - BigInt(1))).toString()
        ),
      })
    )
  }
  const entries: Array<[string, xdr.ScVal]> = [
    ['acceptance_signature', xdr.ScVal.scvVoid()],
    ['acceptor', xdr.ScVal.scvVoid()],
    ['cumulative', i128(v.cumulative)],
    ['key_id', xdr.ScVal.scvU32(v.keyId)],
    ['reader', new Address(v.reader).toScVal()],
    ['receipts_root', xdr.ScVal.scvBytes(Buffer.from(v.receiptsRoot))],
    ['signature', xdr.ScVal.scvBytes(Buffer.from(v.signature))],
    ['writer', new Address(v.writer).toScVal()],
  ]
  return xdr.ScVal.scvMap(
    entries.map(
      ([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })
    )
  )
}

/** Arguments of `Tab.settle(settler, vouchers)`. */
export function settleArgs(
  settler: string,
  vouchers: SettleVoucher[]
): xdr.ScVal[] {
  return [
    new Address(settler).toScVal(),
    xdr.ScVal.scvVec(vouchers.map(voucherScVal)),
  ]
}

// ---------------------------------------------------------------------------
// Simulation and bisection

export class TransientSettlementError extends Error {}

/**
 * A single voucher failed simulation for a reason no voucher can cause on its
 * own (a missing settler role, a wrong contract, a host or network limit).
 * Nothing is rejected: rejecting would close every due pair.
 */
export class SystemicSettlementError extends TransientSettlementError {}

/**
 * Failures that one voucher causes by itself, so rejecting it for review is
 * right: an invalid signature (the host's ed25519 check traps), a missing
 * reader account (`AccountMissing`, 47) and arithmetic overflow (`Overflow`, 43).
 */
export function isVoucherFailure(message: string): boolean {
  return (
    /Error\(Crypto, /.test(message) ||
    /Error\(Contract, #(43|47)\)/.test(message)
  )
}

/**
 * Splits a failing batch until each failure is isolated. Returns the vouchers
 * that simulate together and the ones that fail on their own.
 */
export async function bisect<T>(
  items: T[],
  simulate: (items: T[]) => Promise<SimulationOutcome>,
  budget = { left: MAX_SIMULATIONS }
): Promise<{ good: T[]; rejected: Array<{ item: T; message: string }> }> {
  if (items.length === 0) return { good: [], rejected: [] }
  if (budget.left <= 0) {
    throw new TransientSettlementError('Simulation budget exhausted')
  }
  budget.left--
  const r = await simulate(items)
  if (r.ok) return { good: items, rejected: [] }
  if (r.kind === 'transient') throw new TransientSettlementError(r.message)
  if (items.length === 1) {
    if (!isVoucherFailure(r.message)) {
      throw new SystemicSettlementError(r.message)
    }
    return { good: [], rejected: [{ item: items[0]!, message: r.message }] }
  }
  const mid = Math.ceil(items.length / 2)
  const left = await bisect(items.slice(0, mid), simulate, budget)
  const right = await bisect(items.slice(mid), simulate, budget)
  return {
    good: [...left.good, ...right.good],
    rejected: [...left.rejected, ...right.rejected],
  }
}

/** Bisects, then confirms that the remaining vouchers simulate together. */
export async function settleableSet<T>(
  items: T[],
  simulate: (items: T[]) => Promise<SimulationOutcome>
): Promise<{ good: T[]; rejected: Array<{ item: T; message: string }> }> {
  const budget = { left: MAX_SIMULATIONS }
  let current = items
  const rejected: Array<{ item: T; message: string }> = []
  for (;;) {
    const r = await bisect(current, simulate, budget)
    rejected.push(...r.rejected)
    if (r.rejected.length === 0 || r.good.length === 0) {
      return { good: r.good, rejected }
    }
    // Halves that passed apart may still fail together: check the union.
    current = r.good
  }
}

// ---------------------------------------------------------------------------
// Transaction results

/** `TabSettled` and `VoucherSkipped` events of `tabContractId` in a result. */
export function parseSettlementEvents(
  contractEventsXdr: string[][],
  tabContractId: string
): SettlementOutcome[] {
  const out: SettlementOutcome[] = []
  for (const b64 of contractEventsXdr.flat()) {
    let e
    try {
      e = decodeContractEventXdr(b64)
    } catch {
      continue
    }
    if (e.contractId !== tabContractId) continue
    const topics = toStoredValue(e.topics) as unknown[]
    const d = toStoredValue(e.data) as Record<string, unknown>
    if (e.name === 'tab_settled') {
      out.push({
        kind: 'settled',
        reader: String(topics[1]),
        writer: String(topics[2]),
        keyId: Number(d.key_id),
        cumulative: String(d.cumulative),
        paidAfter: String(d.paid_after),
        gross: String(d.gross),
        fee: String(d.fee),
      })
    } else if (e.name === 'voucher_skipped') {
      out.push({
        kind: 'skipped',
        reader: String(topics[1]),
        writer: String(topics[2]),
        keyId: Number(d.key_id),
        cumulative: String(d.cumulative),
        reason: Number(d.reason),
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The run

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

async function resolveOpen(
  deps: SettlerDeps,
  open: OpenSettlement,
  latest: { sequence: number; closeTime: number },
  resend = true
): Promise<'pending' | 'confirmed' | 'failed' | 'expired'> {
  if (!open.reference) {
    // Crashed before the signed envelope was recorded: nothing was sent.
    await deps.ledger.finish(open.settlementId, {
      status: 'FAILED',
      reason: 'not_sent',
    })
    return 'failed'
  }
  const prepared: PreparedSubmission = {
    reference: open.reference,
    txHash: open.txHash,
    envelopeXdr: open.envelopeXdr,
  }
  let found: LookupOutcome
  try {
    found = await deps.submitter.lookup(prepared)
  } catch (error) {
    await deps.ledger.noteAttempt(open.settlementId, errorText(error))
    return 'pending'
  }
  if (found.status === 'success') {
    await deps.ledger.finish(open.settlementId, {
      status: SETTLEMENT_CONFIRMED,
      txHash: found.txHash,
      ledger: found.ledger,
      outcomes: parseSettlementEvents(
        found.contractEventsXdr,
        deps.tabContractId
      ),
    })
    return 'confirmed'
  }
  if (found.status === 'failed') {
    await deps.ledger.finish(open.settlementId, {
      status: 'FAILED',
      reason: 'transaction_failed',
      txHash: found.txHash,
    })
    return 'failed'
  }
  if (found.status === 'not_found') {
    if (latest.closeTime > open.maxTime + SETTLE_EXPIRY_MARGIN_SECONDS) {
      // The time bound has passed on chain: it can never be included.
      await deps.ledger.finish(open.settlementId, {
        status: 'EXPIRED',
        reason: 'not_included',
        ...(open.txHash ? { txHash: open.txHash } : {}),
      })
      return 'expired'
    }
    if (!resend) return 'pending'
    // Recorded but maybe never sent (a crash or a send error): send again.
    const sent = await deps.submitter.send(prepared).catch((error) => ({
      status: 'transient' as const,
      message: errorText(error),
    }))
    if (sent.status !== 'sent') {
      await deps.ledger.noteAttempt(open.settlementId, sent.message)
    }
  }
  return 'pending'
}

/** One settler run (3.8, submission steps). */
export async function runSettlementCycle(
  deps: SettlerDeps
): Promise<CycleResult> {
  const result: CycleResult = {
    status: 'idle',
    submitted: 0,
    rejected: 0,
    resumed: 0,
    swept: 0,
  }
  if (!(await deps.ledger.acquireLease(deps.holder))) {
    return { ...result, status: 'busy' }
  }
  try {
    const latest = await deps.latestLedger()
    const now = deps.now()

    // 1. Resolve the open settlement first (single flight per account).
    for (const open of await deps.ledger.openSettlements()) {
      result.resumed++
      const state = await resolveOpen(deps, open, latest)
      if (state === 'pending') {
        return { ...result, status: 'pending', settlementId: open.settlementId }
      }
    }

    // 2. Pairs whose window ended can never settle.
    for (let i = 0; i < MAX_SWEEP_CALLS; i++) {
      const swept = await deps.ledger.sweepExpired(latest.sequence)
      result.swept += swept.closed
      if (!swept.more) break
    }

    // 3. Alerts.
    const balance = await deps.submitter.balance().catch(() => null)
    if (balance !== null && balance < BALANCE_ALERT_STROOPS) {
      deps.log('TAB_SETTLER_BALANCE_LOW', {
        settler: deps.submitter.settlerAddress,
        balance: balance.toString(),
      })
    }
    const selection = await deps.ledger.select({ ledger: latest.sequence, now })
    if (selection.oldestUnsettledAt !== null) {
      const lag = now - selection.oldestUnsettledAt
      for (const threshold of [...LAG_ALERT_MS].reverse()) {
        if (lag > threshold) {
          deps.log('TAB_SETTLER_LAG', { lagMs: lag, thresholdMs: threshold })
          break
        }
      }
    }
    if (selection.expiring.count > 0) {
      deps.log('TAB_SETTLER_KEY_EXPIRING', selection.expiring)
    }

    // 4. Due pairs, pre-checked with the shared encoder.
    const ordered = orderDue(selection.candidates, {
      ledger: latest.sequence,
      now,
    })
    const rejections: Array<{ voucherId: string; reason: string }> = []
    const checked: SettleCandidate[] = []
    for (const c of ordered) {
      if (checked.length >= MAX_SETTLE_BATCH) break
      const reason = precheck(c, deps)
      if (reason === 'stale') continue
      if (reason)
        rejections.push({
          voucherId: c.voucherId,
          reason: `precheck:${reason}`,
        })
      else checked.push(c)
    }

    // 5. Simulate, bisecting on failure. A failure no single voucher explains
    // stops the run without rejecting anything.
    let simulated: Awaited<ReturnType<typeof settleableSet<SettleCandidate>>>
    try {
      simulated = await settleableSet(checked, (items) =>
        deps.submitter.simulate(items.map(toSettleVoucher))
      )
    } catch (error) {
      if (error instanceof SystemicSettlementError) {
        deps.log('TAB_SETTLER_SIMULATION_FAILED', {
          message: errorText(error),
          vouchers: checked.length,
        })
        return { ...result, status: 'failed' }
      }
      throw error
    }
    const { good, rejected } = simulated
    for (const r of rejected) {
      rejections.push({
        voucherId: r.item.voucherId,
        reason: `simulation:${r.message}`.slice(0, 500),
      })
    }
    if (rejections.length) {
      await deps.ledger.reject(rejections)
      deps.log('TAB_SETTLER_REJECTED', {
        count: rejections.length,
        voucherIds: rejections.map((r) => r.voucherId),
      })
      result.rejected = rejections.length
    }
    if (good.length === 0) return { ...result, status: 'nothing_due' }

    // 6. Record, sign, record the envelope, then send.
    const maxTime = Math.floor(now / 1000) + SETTLE_TX_WINDOW_SECONDS
    const settlementId = await deps.ledger.begin({
      voucherIds: good.map((c) => c.voucherId),
      cumulatives: good.map((c) => c.voucher.cumulative),
      submitter: deps.submitter.kind,
      maxTime,
    })
    result.settlementId = settlementId
    result.submitted = good.length
    const prepared = await deps.submitter.prepare(
      good.map(toSettleVoucher),
      maxTime
    )
    await deps.ledger.recordPrepared(settlementId, prepared)
    const sent = await deps.submitter.send(prepared)
    if (sent.status === 'rejected') {
      await deps.ledger.finish(settlementId, {
        status: 'FAILED',
        reason: sent.message,
      })
      return { ...result, status: 'failed' }
    }
    if (sent.status === 'transient') {
      await deps.ledger.noteAttempt(settlementId, sent.message)
      return { ...result, status: 'pending' }
    }

    // 7. Poll briefly; a later run resumes from the record otherwise.
    for (let i = 0; i < (deps.pollAttempts ?? 6); i++) {
      await deps.sleep(i === 0 ? 2_000 : 5_000)
      const state = await resolveOpen(
        deps,
        {
          settlementId,
          status: 'SUBMITTED',
          reference: prepared.reference,
          txHash: prepared.txHash,
          envelopeXdr: prepared.envelopeXdr,
          maxTime,
          attempts: 0,
        },
        await deps.latestLedger(),
        false
      )
      if (state !== 'pending') return { ...result, status: state }
    }
    return { ...result, status: 'pending' }
  } catch (error) {
    deps.log('TAB_SETTLER_RUN_FAILED', { message: errorText(error) })
    throw error
  } finally {
    await deps.ledger.releaseLease(deps.holder)
  }
}
