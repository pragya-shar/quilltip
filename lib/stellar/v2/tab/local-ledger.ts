/**
 * The local ledger: one IndexedDB record per `(key_id, writer)` holding the
 * last cumulative and every leaf hash this browser signed for the pair
 * (docs/architecture/v2/05-flows-and-admin.md, section 5.6, step 2).
 *
 * The ledger is what stops a wrong `cumulative_before` or a rewritten leaf
 * list from Convex from being signed: the client signs only on top of
 * history it holds itself.
 *
 * Write-ahead: after signing and before the submit goes out, the signed
 * entry is stored as `pending`. If Convex accepts it but the response is
 * lost, the next prepare shows exactly that leaf; it matches the pending
 * entry and is promoted instead of stopping the key. A pending entry only
 * ever holds a voucher this browser signed, so promotion adds no exposure.
 *
 * Concurrency: every read-check-write runs in one IndexedDB `readwrite`
 * transaction (see `idb.ts`). The Web Locks API is not used: a transaction
 * already serialises writers across browser tabs, and Web Locks would add a
 * second mechanism for no extra safety. Signing is asynchronous WebCrypto
 * work and cannot run inside a transaction, so the write after signing is a
 * compare-and-set against the state the check saw.
 */
import { isHexOfLength, parseAmount } from './bytes'
import { TabClientError } from './errors'
import { LEDGER_STORE, inTransaction, request, type TabDbOptions } from './idb'
import type { SessionKeyScope } from './session-key'

/** The last state Convex confirmed for this pair, as this browser knows it. */
export type LedgerState = {
  /** Receipts so far; equals `leafHashes.length`. */
  seq: number
  /** Cumulative after receipt `seq`, decimal. */
  cumulative: string
  leafHashes: string[]
}

/**
 * A voucher this browser signed. Entries with `seq` above the committed
 * `seq` are pending; older ones are kept so an identical resubmit can reuse
 * the same signature (some engines sign ed25519 with a random nonce).
 */
export type SignedEntry = {
  seq: number
  cumulativeAfter: string
  leafHash: string
  prepareId: string
  /** Hex. Kept so an identical resubmit can be rebuilt. */
  signature: string
  createdAt: number
}

export type LedgerRecord = {
  tab: string
  reader: string
  keyId: number
  writer: string
  committed: LedgerState | null
  /** The most recent `MAX_SIGNED` entries signed for this pair. */
  signed: SignedEntry[]
  /** Set by a first mismatch; a second mismatch then stops the key. */
  mismatchAt: number | null
  updatedAt: number
}

export const EMPTY_STATE: LedgerState = Object.freeze({
  seq: 0,
  cumulative: '0',
  leafHashes: Object.freeze([]) as unknown as string[],
}) as LedgerState

/** Signed entries kept per pair; older ones are dropped. */
export const MAX_SIGNED = 16

/** What Convex says the pair holds before this tip. */
export type ServerPairState = {
  cumulativeBefore: string
  leafHashes: string[]
}

export type MismatchReason =
  | 'server_behind'
  | 'leaf_mismatch'
  | 'unknown_leaf'
  | 'cumulative_mismatch'

export type LedgerMatch =
  | {
      ok: true
      /** The state to sign on top of (after promoting pending entries). */
      state: LedgerState
      /** Pending entries the server state shows as accepted. */
      promoted: SignedEntry[]
    }
  | { ok: false; reason: MismatchReason }

const lower = (values: string[]) => values.map((v) => v.toLowerCase())

/**
 * Compares the server's pair state with the local record.
 *
 * - With a local record, the server state must equal the committed state,
 *   or the committed state extended by pending entries signed here.
 * - With none, it must be `0` with no leaves (or only pending entries).
 */
export function matchLedger(
  local: LedgerRecord | null,
  server: ServerPairState
): LedgerMatch {
  const base = local?.committed ?? EMPTY_STATE
  const serverLeaves = lower(server.leafHashes)
  const baseLeaves = lower(base.leafHashes)
  if (serverLeaves.length < baseLeaves.length)
    return { ok: false, reason: 'server_behind' }
  for (let i = 0; i < baseLeaves.length; i++)
    if (serverLeaves[i] !== baseLeaves[i])
      return { ok: false, reason: 'leaf_mismatch' }
  const promoted: SignedEntry[] = []
  let cumulative = base.cumulative
  for (let i = baseLeaves.length; i < serverLeaves.length; i++) {
    const seq = i + 1
    const entry = local?.signed.find(
      (p) => p.seq === seq && p.leafHash.toLowerCase() === serverLeaves[i]
    )
    if (!entry) return { ok: false, reason: 'unknown_leaf' }
    promoted.push(entry)
    cumulative = entry.cumulativeAfter
  }
  let serverCumulative: bigint
  try {
    serverCumulative = parseAmount(server.cumulativeBefore, 'cumulativeBefore')
  } catch {
    return { ok: false, reason: 'cumulative_mismatch' }
  }
  if (BigInt(cumulative) !== serverCumulative)
    return { ok: false, reason: 'cumulative_mismatch' }
  return {
    ok: true,
    state: {
      seq: serverLeaves.length,
      cumulative: serverCumulative.toString(),
      leafHashes: serverLeaves,
    },
    promoted,
  }
}

export type StepTwoDecision =
  | { action: 'proceed'; state: LedgerState; promoted: SignedEntry[] }
  | { action: 'reread' }
  | { action: 'retry_prepare'; reason: MismatchReason }
  | { action: 'stop'; reason: MismatchReason }

/**
 * The step-2 rule of spec 5.6 as a pure function.
 *
 * 1. The first read matches: proceed.
 * 2. It does not, and no re-read was made: re-read (another browser tab may
 *    have written).
 * 3. The re-read matches: proceed.
 * 4. It does not: `retry_prepare` the first time, `stop` when the previous
 *    attempt for this pair also mismatched (`priorMismatch`). On `stop` the
 *    caller marks the key unusable in this browser.
 */
export function decideStepTwo(input: {
  server: ServerPairState
  first: LedgerRecord | null
  reread?: LedgerRecord | null
}): StepTwoDecision {
  const first = matchLedger(input.first, input.server)
  if (first.ok) return { action: 'proceed', ...pick(first) }
  if (input.reread === undefined) return { action: 'reread' }
  const second = matchLedger(input.reread, input.server)
  if (second.ok) return { action: 'proceed', ...pick(second) }
  const prior =
    input.reread?.mismatchAt != null || input.first?.mismatchAt != null
  return prior
    ? { action: 'stop', reason: second.reason }
    : { action: 'retry_prepare', reason: second.reason }
}

function pick(m: Extract<LedgerMatch, { ok: true }>) {
  return { state: m.state, promoted: m.promoted }
}

function checkPair(keyId: number, writer: string): void {
  if (!Number.isInteger(keyId) || keyId < 0 || keyId > 0xffff_ffff)
    throw new TabClientError('INVALID_INPUT', 'keyId must be a u32')
  if (typeof writer !== 'string' || !/^[GC][A-Z2-7]{55}$/.test(writer))
    throw new TabClientError('INVALID_INPUT', 'writer must be an address')
}

function emptyRecord(
  scope: SessionKeyScope,
  keyId: number,
  writer: string,
  now: number
): LedgerRecord {
  return {
    tab: scope.tabContractId,
    reader: scope.readerAddress,
    keyId,
    writer,
    committed: null,
    signed: [],
    mismatchAt: null,
    updatedAt: now,
  }
}

function applyState(
  record: LedgerRecord,
  state: LedgerState,
  now: number
): void {
  if (state.seq > (record.committed?.seq ?? 0)) {
    record.committed = {
      seq: state.seq,
      cumulative: state.cumulative,
      leafHashes: [...state.leafHashes],
    }
  }
  record.updatedAt = now
}

export type LocalLedgerOptions = TabDbOptions & { now?: () => number }

export type CommitResult =
  | { status: 'committed'; state: LedgerState }
  /** The local ledger already holds this acceptance (an identical resubmit). */
  | { status: 'already_committed'; state: LedgerState }

export type LocalLedger = {
  read(
    scope: SessionKeyScope,
    keyId: number,
    writer: string
  ): Promise<LedgerRecord | null>
  /** Every pair record of one key. */
  list(scope: SessionKeyScope, keyId: number): Promise<LedgerRecord[]>
  /** Records a first mismatch for the pair (spec 5.6, step 2). */
  markMismatch(
    scope: SessionKeyScope,
    keyId: number,
    writer: string
  ): Promise<void>
  /**
   * After signing: in one transaction, checks that the pair still matches
   * `server`, promotes accepted pending entries, clears the mismatch flag and
   * stores `entry` as a signed entry. Returns false when another browser tab changed
   * the pair since the check, in which case nothing is written.
   */
  recordPending(
    scope: SessionKeyScope,
    keyId: number,
    writer: string,
    server: ServerPairState,
    entry: SignedEntry
  ): Promise<boolean>
  /**
   * After `tabs.submitTip` accepts: appends the accepted leaf in one
   * transaction. Safe to repeat and safe with other browser tabs. Throws
   * `LEDGER_CONFLICT` when the accepted leaves do not extend what this
   * browser signed.
   */
  commitAccepted(
    scope: SessionKeyScope,
    accepted: {
      keyId: number
      writer: string
      cumulative: string
      leafHashes: string[]
    }
  ): Promise<CommitResult>
}

export function createLocalLedger(
  options: LocalLedgerOptions = {}
): LocalLedger {
  const now = options.now ?? (() => Date.now())
  const id = (scope: SessionKeyScope, keyId: number, writer: string) => [
    scope.tabContractId,
    scope.readerAddress,
    keyId,
    writer,
  ]

  async function readIn(
    store: IDBObjectStore,
    scope: SessionKeyScope,
    keyId: number,
    writer: string
  ): Promise<LedgerRecord | null> {
    const found = (await request(store.get(id(scope, keyId, writer)))) as
      | LedgerRecord
      | undefined
    return found ?? null
  }

  return {
    async read(scope, keyId, writer) {
      checkPair(keyId, writer)
      return inTransaction(options, [LEDGER_STORE], 'readonly', (tx) =>
        readIn(tx.objectStore(LEDGER_STORE), scope, keyId, writer)
      )
    },

    async list(scope, keyId) {
      return inTransaction(
        options,
        [LEDGER_STORE],
        'readonly',
        async (tx) =>
          (await request(
            tx
              .objectStore(LEDGER_STORE)
              .getAll(
                IDBKeyRange.bound(
                  [scope.tabContractId, scope.readerAddress, keyId, ''],
                  [scope.tabContractId, scope.readerAddress, keyId, []]
                )
              )
          )) as LedgerRecord[]
      )
    },

    async markMismatch(scope, keyId, writer) {
      checkPair(keyId, writer)
      await inTransaction(options, [LEDGER_STORE], 'readwrite', async (tx) => {
        const store = tx.objectStore(LEDGER_STORE)
        const record =
          (await readIn(store, scope, keyId, writer)) ??
          emptyRecord(scope, keyId, writer, now())
        record.mismatchAt = now()
        record.updatedAt = now()
        await request(store.put(record))
      })
    },

    async recordPending(scope, keyId, writer, server, entry) {
      checkPair(keyId, writer)
      if (
        !isHexOfLength(entry.leafHash, 32) ||
        !isHexOfLength(entry.signature, 64)
      )
        throw new TabClientError('INVALID_INPUT', 'malformed pending entry')
      return inTransaction(options, [LEDGER_STORE], 'readwrite', async (tx) => {
        const store = tx.objectStore(LEDGER_STORE)
        const record =
          (await readIn(store, scope, keyId, writer)) ??
          emptyRecord(scope, keyId, writer, now())
        const match = matchLedger(record, server)
        if (!match.ok) return false
        applyState(record, match.state, now())
        record.mismatchAt = null
        const signed = record.signed.filter(
          (p) =>
            !(
              p.seq === entry.seq &&
              p.leafHash.toLowerCase() === entry.leafHash.toLowerCase()
            )
        )
        signed.push({ ...entry, leafHash: entry.leafHash.toLowerCase() })
        record.signed = signed.slice(-MAX_SIGNED)
        await request(store.put(record))
        return true
      })
    },

    async commitAccepted(scope, accepted) {
      checkPair(accepted.keyId, accepted.writer)
      const leaves = lower(accepted.leafHashes)
      if (leaves.length === 0 || !leaves.every((h) => isHexOfLength(h, 32)))
        throw new TabClientError('INVALID_INPUT', 'malformed accepted leaves')
      const cumulative = parseAmount(accepted.cumulative, 'cumulative')
      return inTransaction(options, [LEDGER_STORE], 'readwrite', async (tx) => {
        const store = tx.objectStore(LEDGER_STORE)
        const record = await readIn(
          store,
          scope,
          accepted.keyId,
          accepted.writer
        )
        const committed = record?.committed
        // Another tab (or an earlier call) already recorded this or later.
        if (
          committed &&
          committed.seq >= leaves.length &&
          leaves.every((h, i) => committed.leafHashes[i] === h)
        ) {
          if (
            committed.seq === leaves.length &&
            BigInt(committed.cumulative) !== cumulative
          )
            throw new TabClientError(
              'LEDGER_CONFLICT',
              'The accepted cumulative differs from the local ledger.'
            )
          return { status: 'already_committed', state: committed }
        }
        const match = matchLedger(record, {
          cumulativeBefore: cumulative.toString(),
          leafHashes: leaves,
        })
        if (!match.ok || !record)
          throw new TabClientError(
            'LEDGER_CONFLICT',
            `The accepted tip does not extend the local ledger (${
              match.ok ? 'no record' : match.reason
            }).`
          )
        applyState(record, match.state, now())
        await request(store.put(record))
        return { status: 'committed', state: match.state }
      })
    },
  }
}
