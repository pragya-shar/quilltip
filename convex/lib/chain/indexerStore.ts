/**
 * Event indexer storage (docs/architecture/v2/06-app-integration.md, section
 * 6.5; 07-security-and-recovery.md, section 7.4).
 *
 * `ingestEvents` stores each RPC event once, keyed by its RPC `id`, and
 * dispatches it to the handler registered for `<contract role>:<event name>`.
 * Handlers are idempotent; an event already stored is never dispatched again,
 * so replaying a range is a no-op. `saveCursor` only moves the cursor forward
 * and only for the lease holder, so overlapping runs cannot move it back.
 */
import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { StrKey } from '@stellar/stellar-sdk'
import { bytesToHex } from './ids'
import {
  EventDecodeError,
  decodeRpcEvent,
  type DecodedContractEvent,
} from './events'
import type { RawRpcEvent } from './rpc'
import { CORE_EVENT_HANDLERS } from './coreEventHandlers'
import { TAB_EVENT_HANDLERS } from './tabEventHandlers'

/** About one hour of ledgers. Beyond this lag the cursor is `LAGGING`. */
export const LAG_ALERT_LEDGERS = 720
/**
 * About one day of ledgers. When the cursor is this close to the oldest
 * ledger RPC still serves, an alert fires so the gap can be closed well
 * inside the 7-day retention window.
 */
export const RETENTION_ALERT_LEDGERS = 17_280

export type ContractRole = 'core' | 'tab' | 'nft'

/**
 * What a handler receives. `doc.topics` and `doc.data` are the stored,
 * JSON-safe form (integers as decimal strings, bytes as lower-case hex), so
 * a first dispatch and a later re-dispatch see the same values.
 */
export type IndexedEvent = {
  doc: Doc<'chainEvents'>
  role: ContractRole
  now: number
}

/** `done`: applied. `orphan`: valid, but no app record. `pending`: retry later. */
export type HandlerResult = 'done' | 'orphan' | 'pending' | 'error'

export type ChainEventHandler = (
  ctx: MutationCtx,
  event: IndexedEvent
) => Promise<HandlerResult>

/**
 * Handler registry keyed by `<role>:<event name>`. NFT handlers (#450) add
 * their entries here. An event without a handler is
 * stored as `pending` and dispatched again by `redispatchPending`.
 */
export const EVENT_HANDLERS: Readonly<Record<string, ChainEventHandler>> = {
  ...CORE_EVENT_HANDLERS,
  ...TAB_EVENT_HANDLERS,
}

export type ContractRoles = Partial<Record<ContractRole, string>>

function roleOf(contractId: string, roles: ContractRoles): ContractRole | null {
  for (const role of ['core', 'tab', 'nft'] as const) {
    if (roles[role] && roles[role] === contractId) return role
  }
  return null
}

/** JSON-safe form of a decoded value: bigint as string, bytes as hex. */
export function toStoredValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return bytesToHex(value)
  if (Array.isArray(value)) return value.map(toStoredValue)
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([k, v]) => [String(k), toStoredValue(v)])
    )
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, toStoredValue(v)])
    )
  }
  return value === undefined ? null : value
}

function closeTimeSeconds(ledgerClosedAt: string): number {
  const ms = Date.parse(ledgerClosedAt)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
}

export type IngestResult = {
  stored: number
  duplicates: number
  skipped: number
  byResult: Partial<Record<HandlerResult, number>>
  maxEventId: string | null
}

async function dispatch(
  ctx: MutationCtx,
  doc: Doc<'chainEvents'>,
  role: ContractRole,
  now: number
): Promise<HandlerResult> {
  const handler = EVENT_HANDLERS[`${role}:${doc.type}`]
  if (!handler) return 'pending'
  try {
    return await handler(ctx, { doc, role, now })
  } catch (error) {
    // A handler bug must not block the cursor: the event is kept as `error`
    // for review and can be dispatched again after a fix.
    console.error(
      JSON.stringify({
        code: 'CHAIN_INDEXER_HANDLER_ERROR',
        eventId: doc.eventId,
        type: doc.type,
        message: error instanceof Error ? error.message : String(error),
      })
    )
    return 'error'
  }
}

function handledFor(result: HandlerResult): Doc<'chainEvents'>['handled'] {
  return result === 'done'
    ? 'done'
    : result === 'orphan'
      ? 'orphan'
      : result === 'error'
        ? 'error'
        : 'pending'
}

/**
 * Stores and dispatches RPC events. Events from contracts outside `roles`,
 * events of failed calls and malformed events are skipped.
 */
export async function ingestEvents(
  ctx: MutationCtx,
  args: {
    events: RawRpcEvent[]
    roles: ContractRoles
    network: 'TESTNET' | 'MAINNET'
    chainEpoch: string
    now: number
  }
): Promise<IngestResult> {
  const result: IngestResult = {
    stored: 0,
    duplicates: 0,
    skipped: 0,
    byResult: {},
    maxEventId: null,
  }
  for (const raw of args.events) {
    if (raw.inSuccessfulContractCall === false || raw.type !== 'contract') {
      result.skipped++
      continue
    }
    if (!StrKey.isValidContract(raw.contractId)) {
      result.skipped++
      continue
    }
    const role = roleOf(raw.contractId, args.roles)
    if (!role) {
      result.skipped++
      continue
    }
    if (!result.maxEventId || raw.id > result.maxEventId) {
      result.maxEventId = raw.id
    }
    // Event ids restart after a testnet reset, so an id is unique only
    // within one chain epoch.
    const existing = (
      await ctx.db
        .query('chainEvents')
        .withIndex('by_event_id', (q) => q.eq('eventId', raw.id))
        .take(20)
    ).find((row) => row.chainEpoch === args.chainEpoch)
    if (existing) {
      result.duplicates++
      continue
    }

    let decoded: DecodedContractEvent
    try {
      decoded = decodeRpcEvent(raw)
    } catch (error) {
      if (!(error instanceof EventDecodeError)) throw error
      await ctx.db.insert('chainEvents', {
        network: args.network,
        chainEpoch: args.chainEpoch,
        eventId: raw.id,
        contractId: raw.contractId,
        ledger: raw.ledger,
        ledgerCloseTime: closeTimeSeconds(raw.ledgerClosedAt),
        txHash: raw.txHash,
        type: 'undecodable',
        topics: raw.topic,
        data: raw.value,
        handled: 'error',
      })
      result.byResult.error = (result.byResult.error ?? 0) + 1
      continue
    }

    const type = decoded.name ?? 'unnamed'
    const clientRef =
      type === 'tipped' &&
      decoded.data &&
      typeof decoded.data === 'object' &&
      (decoded.data as Record<string, unknown>).client_ref instanceof Uint8Array
        ? bytesToHex(
            (decoded.data as Record<string, unknown>).client_ref as Uint8Array
          )
        : undefined
    const id = await ctx.db.insert('chainEvents', {
      network: args.network,
      chainEpoch: args.chainEpoch,
      eventId: raw.id,
      contractId: raw.contractId,
      ledger: raw.ledger,
      ledgerCloseTime: closeTimeSeconds(raw.ledgerClosedAt),
      txHash: raw.txHash,
      type,
      topics: toStoredValue(decoded.topics) as unknown[],
      data: toStoredValue(decoded.data),
      ...(clientRef ? { clientRef } : {}),
      handled: 'pending',
    })
    result.stored++
    const doc = (await ctx.db.get(id))!
    const handled = await dispatch(ctx, doc, role, args.now)
    result.byResult[handled] = (result.byResult[handled] ?? 0) + 1
    if (handled !== 'pending')
      await ctx.db.patch(id, { handled: handledFor(handled) })
  }
  return result
}

/** Dispatches stored `pending` events again, for example after a handler ships. */
export async function redispatchPending(
  ctx: MutationCtx,
  args: { roles: ContractRoles; limit: number; now: number }
): Promise<{ checked: number; resolved: number }> {
  const pending = await ctx.db
    .query('chainEvents')
    .withIndex('by_handled', (q) => q.eq('handled', 'pending'))
    .take(args.limit)
  let resolved = 0
  for (const doc of pending) {
    const role = roleOf(doc.contractId, args.roles)
    if (!role) continue
    const handled = await dispatch(ctx, doc, role, args.now)
    if (handled !== 'pending') {
      await ctx.db.patch(doc._id, { handled: handledFor(handled) })
      resolved++
    }
  }
  return { checked: pending.length, resolved }
}

export type CursorUpdate = {
  network: 'TESTNET' | 'MAINNET'
  chainEpoch: string
  /** RPC paging cursor after the last page. */
  cursor?: string
  /**
   * The ledger every event up to which has been stored. Set only when the
   * last page was shorter than the limit (the response's `latestLedger`).
   */
  coveredLedger?: number
  coveredLedgerCloseTime?: number
  latestLedger: number
  oldestLedger: number
  now: number
}

export function cursorStatus(args: {
  lastLedger: number
  latestLedger: number
  oldestLedger: number
}): 'OK' | 'LAGGING' | 'BEHIND_RETENTION' {
  if (args.lastLedger < args.oldestLedger) return 'BEHIND_RETENTION'
  if (args.latestLedger - args.lastLedger > LAG_ALERT_LEDGERS) return 'LAGGING'
  return 'OK'
}

export function logIndexerAlert(
  code: string,
  details: Record<string, unknown>
): void {
  console.error(JSON.stringify({ code: `CHAIN_INDEXER_${code}`, ...details }))
}

/**
 * Saves the cursor. Never moves `lastLedger` backwards; a page that arrives
 * after a newer one only stores its events.
 */
export async function saveCursor(
  ctx: MutationCtx,
  update: CursorUpdate
): Promise<Doc<'chainCursor'>> {
  const existing = await ctx.db
    .query('chainCursor')
    .withIndex('by_network', (q) => q.eq('network', update.network))
    .first()
  const sameEpoch = existing?.chainEpoch === update.chainEpoch
  const previousLedger = sameEpoch ? existing!.lastLedger : 0
  const advances =
    update.coveredLedger !== undefined && update.coveredLedger >= previousLedger
  const lastLedger = advances ? update.coveredLedger! : previousLedger
  const lastLedgerCloseTime = advances
    ? (update.coveredLedgerCloseTime ?? 0)
    : sameEpoch
      ? existing!.lastLedgerCloseTime
      : 0
  const lagLedgers = Math.max(0, update.latestLedger - lastLedger)
  const status = cursorStatus({
    lastLedger,
    latestLedger: update.latestLedger,
    oldestLedger: update.oldestLedger,
  })
  const row = {
    network: update.network,
    chainEpoch: update.chainEpoch,
    // RPC paging cursors are event ids, which sort in chain order; an older
    // page's cursor never replaces a newer one.
    cursor:
      update.cursor !== undefined &&
      (!sameEpoch || !existing?.cursor || update.cursor > existing.cursor)
        ? update.cursor
        : sameEpoch
          ? existing?.cursor
          : undefined,
    lastLedger,
    lastLedgerCloseTime,
    latestLedger: update.latestLedger,
    oldestLedger: update.oldestLedger,
    lagLedgers,
    status,
    // A saved paging cursor supersedes a replay start.
    startLedger:
      update.cursor !== undefined || !sameEpoch
        ? undefined
        : existing?.startLedger,
    lastRunAt: update.now,
    updatedAt: update.now,
  }
  if (existing) await ctx.db.replace(existing._id, row)
  else await ctx.db.insert('chainCursor', row)
  if (status === 'LAGGING') {
    logIndexerAlert('LAGGING', {
      lastLedger,
      latestLedger: update.latestLedger,
      lagLedgers,
    })
  }
  if (
    status !== 'BEHIND_RETENTION' &&
    lastLedger - update.oldestLedger < RETENTION_ALERT_LEDGERS
  ) {
    logIndexerAlert('RETENTION_RISK', {
      lastLedger,
      oldestLedger: update.oldestLedger,
      ledgersLeft: lastLedger - update.oldestLedger,
    })
  }
  return (await ctx.db
    .query('chainCursor')
    .withIndex('by_network', (q) => q.eq('network', update.network))
    .first())!
}

/** Stops the indexer with a status an operator must clear. */
export async function stopCursor(
  ctx: MutationCtx,
  args: {
    network: 'TESTNET' | 'MAINNET'
    chainEpoch: string
    status: 'BEHIND_RETENTION' | 'RESET_DETECTED'
    reason: string
    latestLedger: number
    oldestLedger: number
    now: number
  }
): Promise<void> {
  const existing = await ctx.db
    .query('chainCursor')
    .withIndex('by_network', (q) => q.eq('network', args.network))
    .first()
  const fields = {
    status: args.status,
    statusReason: args.reason,
    latestLedger: args.latestLedger,
    oldestLedger: args.oldestLedger,
    lastRunAt: args.now,
    updatedAt: args.now,
  }
  if (existing) {
    await ctx.db.patch(existing._id, {
      ...fields,
      lagLedgers: Math.max(0, args.latestLedger - existing.lastLedger),
    })
  } else {
    await ctx.db.insert('chainCursor', {
      network: args.network,
      chainEpoch: args.chainEpoch,
      lastLedger: 0,
      lastLedgerCloseTime: 0,
      lagLedgers: args.latestLedger,
      ...fields,
    })
  }
  logIndexerAlert(args.status, {
    reason: args.reason,
    latestLedger: args.latestLedger,
    oldestLedger: args.oldestLedger,
  })
}
