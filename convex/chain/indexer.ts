/**
 * Payments v2 event indexer (docs/architecture/v2/06-app-integration.md,
 * section 6.5; 07-security-and-recovery.md, section 7.4).
 *
 * `pollEvents` runs every minute under the `indexer` lease. It reads
 * `getEvents` for this deployment's Core, Tab and NFT contracts from the
 * stored cursor (or `INDEXER_START_LEDGER`), stores each event once and
 * dispatches it, and saves the cursor in the same mutation as each page, so a
 * crash never leaves stored events ahead of a lost cursor or the reverse.
 *
 * The indexer stops instead of skipping ahead when it falls behind RPC
 * retention or detects a testnet reset: records only expire on proven
 * coverage, so a gap must be filled or a new epoch started by an operator.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from '../_generated/server'
import { readChainEnv, type ChainEnv } from '../lib/chain/env'
import { acquireLease, releaseLease } from '../lib/chain/lease'
import {
  RpcError,
  createBackendRpcClient,
  type GetEventsParams,
  type RawRpcEvent,
} from '../lib/chain/rpc'
import {
  ingestEvents,
  logIndexerAlert,
  redispatchPending,
  saveCursor,
  stopCursor,
  type ContractRoles,
} from '../lib/chain/indexerStore'
import { readView } from './config'

export const INDEXER_LEASE_TTL_MS = 90_000
/** A run stops starting new pages after this, well inside the lease. */
export const INDEXER_RUN_BUDGET_MS = 60_000
export const INDEXER_PAGE_LIMIT = 1000
export const INDEXER_MAX_PAGES = 10
/** Events per ingest mutation; a page is split into chunks of this size. */
export const INDEXER_CHUNK_SIZE = 250

const rawEventValidator = v.object({
  type: v.string(),
  ledger: v.number(),
  ledgerClosedAt: v.string(),
  contractId: v.string(),
  id: v.string(),
  operationIndex: v.optional(v.number()),
  transactionIndex: v.optional(v.number()),
  txHash: v.string(),
  topic: v.array(v.string()),
  value: v.string(),
  inSuccessfulContractCall: v.optional(v.boolean()),
})

function rolesOf(chain: ChainEnv): ContractRoles {
  return {
    ...(chain.coreContractId ? { core: chain.coreContractId } : {}),
    ...(chain.tabContractId ? { tab: chain.tabContractId } : {}),
    ...(chain.nftContractId ? { nft: chain.nftContractId } : {}),
  }
}

/** `INDEXER_START_LEDGER` for this deployment's own contract set. */
export function indexerStartLedger(
  env: Record<string, string | undefined> = process.env
): number | null {
  const raw = env.INDEXER_START_LEDGER?.trim()
  if (!raw) return null
  const ledger = Number(raw)
  if (!Number.isSafeInteger(ledger) || ledger <= 0) {
    throw new ConvexError({
      code: 'CHAIN_CONFIG_INVALID',
      message: 'INDEXER_START_LEDGER must be a positive ledger number.',
    })
  }
  return ledger
}

function trimEvent(event: RawRpcEvent): RawRpcEvent {
  return {
    type: event.type,
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    contractId: event.contractId,
    id: event.id,
    ...(event.operationIndex === undefined
      ? {}
      : { operationIndex: event.operationIndex }),
    ...(event.transactionIndex === undefined
      ? {}
      : { transactionIndex: event.transactionIndex }),
    txHash: event.txHash,
    topic: event.topic,
    value: event.value,
    ...(event.inSuccessfulContractCall === undefined
      ? {}
      : { inSuccessfulContractCall: event.inSuccessfulContractCall }),
  }
}

export const acquireIndexerLease = internalMutation({
  args: { holder: v.string() },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    return acquireLease(ctx, {
      name: 'indexer',
      holder: args.holder,
      ttlMs: INDEXER_LEASE_TTL_MS,
      now: Date.now(),
      network: chain.network,
      chainEpoch: chain.chainEpoch,
    })
  },
})

export const releaseIndexerLease = internalMutation({
  args: { holder: v.string() },
  handler: async (ctx, args) =>
    releaseLease(ctx, { name: 'indexer', holder: args.holder }),
})

export const readCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    const chain = readChainEnv()
    return ctx.db
      .query('chainCursor')
      .withIndex('by_network', (q) => q.eq('network', chain.network))
      .first()
  },
})

async function holdsLease(
  ctx: { db: import('../_generated/server').MutationCtx['db'] },
  holder: string,
  now: number
): Promise<boolean> {
  const lease = await ctx.db
    .query('chainLeases')
    .withIndex('by_name', (q) => q.eq('name', 'indexer'))
    .first()
  return !!lease && lease.holder === holder && lease.expiresAt > now
}

/**
 * Stores one chunk of a page. Only the last chunk of a page carries the
 * cursor; it is saved in the same transaction as those events. Refused
 * unless the caller still holds the indexer lease.
 */
export const ingestPage = internalMutation({
  args: {
    holder: v.string(),
    events: v.array(rawEventValidator),
    cursor: v.optional(
      v.object({
        cursor: v.string(),
        coveredLedger: v.optional(v.number()),
        coveredLedgerCloseTime: v.optional(v.number()),
        latestLedger: v.number(),
        oldestLedger: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    const now = Date.now()
    if (!(await holdsLease(ctx, args.holder, now))) {
      throw new ConvexError({
        code: 'LEASE_LOST',
        message: 'The indexer lease is held by another run.',
      })
    }
    const result = await ingestEvents(ctx, {
      events: args.events,
      roles: rolesOf(chain),
      network: chain.network,
      chainEpoch: chain.chainEpoch,
      now,
    })
    if (args.cursor) {
      await saveCursor(ctx, {
        network: chain.network,
        chainEpoch: chain.chainEpoch,
        ...args.cursor,
        now,
      })
    }
    return result
  },
})

export const stopIndexer = internalMutation({
  args: {
    status: v.union(v.literal('BEHIND_RETENTION'), v.literal('RESET_DETECTED')),
    reason: v.string(),
    latestLedger: v.number(),
    oldestLedger: v.number(),
  },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    await stopCursor(ctx, {
      network: chain.network,
      chainEpoch: chain.chainEpoch,
      ...args,
      now: Date.now(),
    })
  },
})

export const noteIndexerError = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    const cursor = await ctx.db
      .query('chainCursor')
      .withIndex('by_network', (q) => q.eq('network', chain.network))
      .first()
    if (cursor) {
      await ctx.db.patch(cursor._id, {
        lastError: args.error.slice(0, 300),
        lastRunAt: Date.now(),
      })
    }
  },
})

/**
 * The ledger an RPC paging cursor points at. Cursors are event ids: a TOID
 * (ledger in the high 32 bits) and an event index.
 */
export function ledgerOfCursor(cursor: string): number | null {
  const match = /^(\d{1,20})-\d+$/.exec(cursor)
  if (!match) return null
  const ledger = Number(BigInt(match[1]!) >> BigInt(32))
  return Number.isSafeInteger(ledger) && ledger > 0 ? ledger : null
}

/** True when a simulation error says the contract instance does not exist. */
export function isMissingContractError(message: string): boolean {
  return /MissingValue|non-?existent contract|contract (instance )?(not found|missing)|Storage, MissingValue/i.test(
    message
  )
}

type PollResult =
  | { status: 'skipped'; reason: string }
  | { status: 'stopped'; reason: string }
  | {
      status: 'ok'
      pages: number
      stored: number
      duplicates: number
      lastLedger: number | null
    }

/**
 * Cron (every minute). `pageLimit` and `maxPages` exist for tests and stay
 * at the spec values in production.
 */
export const pollEvents = internalAction({
  args: {
    pageLimit: v.optional(v.number()),
    maxPages: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PollResult> => {
    const chain = readChainEnv()
    const roles = rolesOf(chain)
    const contractIds = Object.values(roles)
    const startLedger = indexerStartLedger()
    if (contractIds.length === 0 || !chain.coreContractId || !startLedger) {
      return { status: 'skipped', reason: 'not_configured' }
    }
    const holder = crypto.randomUUID()
    if (
      !(await ctx.runMutation(internal.chain.indexer.acquireIndexerLease, {
        holder,
      }))
    ) {
      return { status: 'skipped', reason: 'lease_held' }
    }

    const started = Date.now()
    const rpc = createBackendRpcClient()
    try {
      const cursor = await ctx.runQuery(internal.chain.indexer.readCursor, {})
      const sameEpoch = cursor?.chainEpoch === chain.chainEpoch
      if (sameEpoch && cursor?.status === 'RESET_DETECTED') {
        return { status: 'stopped', reason: 'reset_detected' }
      }

      const health = await rpc.getHealth()

      // Testnet reset: the ledger sequence dropped below what was indexed,
      // or the Core instance is gone.
      if (sameEpoch && cursor && health.latestLedger < cursor.lastLedger) {
        await ctx.runMutation(internal.chain.indexer.stopIndexer, {
          status: 'RESET_DETECTED',
          reason: `ledger_sequence_dropped:${cursor.lastLedger}->${health.latestLedger}`,
          latestLedger: health.latestLedger,
          oldestLedger: health.oldestLedger,
        })
        return { status: 'stopped', reason: 'reset_detected' }
      }
      try {
        await readView(rpc, chain, chain.coreContractId, 'fee_bps')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!(error instanceof RpcError) && isMissingContractError(message)) {
          await ctx.runMutation(internal.chain.indexer.stopIndexer, {
            status: 'RESET_DETECTED',
            reason: 'core_instance_missing',
            latestLedger: health.latestLedger,
            oldestLedger: health.oldestLedger,
          })
          return { status: 'stopped', reason: 'reset_detected' }
        }
        if (error instanceof RpcError) throw error
        // Any other view failure (paused, budget) does not stop indexing.
      }

      // Where to read from: the stored cursor, a replay start, or the start
      // ledger of this deployment's contract set.
      const resumeCursor = sameEpoch ? cursor?.cursor : undefined
      const fromLedger = sameEpoch
        ? (cursor?.startLedger ?? (cursor ? undefined : startLedger))
        : startLedger
      const firstLedger = resumeCursor
        ? (ledgerOfCursor(resumeCursor) ??
          Math.max(cursor?.lastLedger ?? 0, startLedger))
        : (fromLedger ?? startLedger)
      if (firstLedger < health.oldestLedger) {
        await ctx.runMutation(internal.chain.indexer.stopIndexer, {
          status: 'BEHIND_RETENTION',
          reason: `start_${firstLedger}_before_oldest_${health.oldestLedger}`,
          latestLedger: health.latestLedger,
          oldestLedger: health.oldestLedger,
        })
        return { status: 'stopped', reason: 'behind_retention' }
      }

      const limit = Math.min(
        args.pageLimit ?? INDEXER_PAGE_LIMIT,
        INDEXER_PAGE_LIMIT
      )
      const maxPages = Math.min(
        args.maxPages ?? INDEXER_MAX_PAGES,
        INDEXER_MAX_PAGES
      )
      let pageCursor = resumeCursor
      let pages = 0
      let stored = 0
      let duplicates = 0
      let lastLedger: number | null = null
      while (pages < maxPages && Date.now() - started < INDEXER_RUN_BUDGET_MS) {
        const params: GetEventsParams = {
          filters: [{ type: 'contract', contractIds }],
          pagination: pageCursor ? { cursor: pageCursor, limit } : { limit },
          ...(pageCursor ? {} : { startLedger: firstLedger }),
        }
        const page = await rpc.getEvents(params)
        pages++
        const events = page.events.map(trimEvent)
        // RPC scans at most 10,000 ledgers per request. A short page means the
        // scan window is exhausted, and its cursor marks the window's last
        // ledger. Only a window that reached the latest ledger proves coverage.
        const cursorLedger = page.cursor ? ledgerOfCursor(page.cursor) : null
        const finalPage =
          events.length < limit &&
          cursorLedger !== null &&
          cursorLedger >= page.latestLedger
        const chunks: RawRpcEvent[][] = []
        for (let i = 0; i < events.length; i += INDEXER_CHUNK_SIZE) {
          chunks.push(events.slice(i, i + INDEXER_CHUNK_SIZE))
        }
        if (chunks.length === 0) chunks.push([])
        for (const [index, chunk] of chunks.entries()) {
          const last = index === chunks.length - 1
          const result = await ctx.runMutation(
            internal.chain.indexer.ingestPage,
            {
              holder,
              events: chunk,
              ...(last
                ? {
                    cursor: {
                      cursor: page.cursor,
                      latestLedger: page.latestLedger,
                      oldestLedger: health.oldestLedger,
                      // Every ledger up to the response's latest ledger has
                      // been read.
                      ...(finalPage
                        ? {
                            coveredLedger: page.latestLedger,
                            coveredLedgerCloseTime: page.latestLedgerCloseTime,
                          }
                        : {}),
                    },
                  }
                : {}),
            }
          )
          stored += result.stored
          duplicates += result.duplicates
        }
        if (finalPage) lastLedger = page.latestLedger
        pageCursor = page.cursor
        if (
          finalPage ||
          !page.cursor ||
          page.cursor === params.pagination?.cursor
        )
          break
      }
      return { status: 'ok', pages, stored, duplicates, lastLedger }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logIndexerAlert('RUN_FAILED', { message })
      await ctx.runMutation(internal.chain.indexer.noteIndexerError, {
        error: message,
      })
      if (error instanceof RpcError) {
        return { status: 'skipped', reason: 'rpc_error' }
      }
      throw error
    } finally {
      await ctx.runMutation(internal.chain.indexer.releaseIndexerLease, {
        holder,
      })
    }
  },
})

/**
 * Operator replay (section 7.4): the next run reads from `fromLedger`.
 * Stored events are skipped and handlers are idempotent, so replaying an
 * indexed range changes nothing. Clears `BEHIND_RETENTION` and
 * `RESET_DETECTED`; the cursor's covered ledger does not move back.
 */
export const replayFrom = internalMutation({
  args: {
    fromLedger: v.number(),
    /**
     * Set only after the ledgers between the covered ledger and `fromLedger`
     * were filled with `ingestBackfill`. Otherwise a replay past the covered
     * ledger would let the next run claim coverage of ledgers never read.
     */
    gapBackfilled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    if (!Number.isSafeInteger(args.fromLedger) || args.fromLedger <= 0) {
      throw new ConvexError({
        code: 'INVALID_LEDGER',
        message: 'fromLedger must be a positive ledger number.',
      })
    }
    const cursor = await ctx.db
      .query('chainCursor')
      .withIndex('by_network', (q) => q.eq('network', chain.network))
      .first()
    const now = Date.now()
    if (
      cursor &&
      cursor.chainEpoch === chain.chainEpoch &&
      cursor.lastLedger > 0 &&
      args.fromLedger > cursor.lastLedger + 1
    ) {
      if (args.gapBackfilled !== true) {
        throw new ConvexError({
          code: 'REPLAY_GAP',
          message: `Ledgers ${cursor.lastLedger + 1} to ${args.fromLedger - 1} were never indexed. Fill them with ingestBackfill, then pass gapBackfilled: true.`,
        })
      }
      logIndexerAlert('REPLAY_GAP_BACKFILLED', {
        lastLedger: cursor.lastLedger,
        fromLedger: args.fromLedger,
      })
    }
    if (cursor && cursor.chainEpoch === chain.chainEpoch) {
      await ctx.db.patch(cursor._id, {
        cursor: undefined,
        startLedger: args.fromLedger,
        status: 'OK',
        statusReason: `replay_from_${args.fromLedger}`,
        updatedAt: now,
      })
    } else {
      if (cursor) await ctx.db.delete(cursor._id)
      await ctx.db.insert('chainCursor', {
        network: chain.network,
        chainEpoch: chain.chainEpoch,
        startLedger: args.fromLedger,
        lastLedger: 0,
        lastLedgerCloseTime: 0,
        latestLedger: 0,
        oldestLedger: 0,
        lagLedgers: 0,
        status: 'OK',
        statusReason: `replay_from_${args.fromLedger}`,
        updatedAt: now,
      })
    }
    return { fromLedger: args.fromLedger }
  },
})

/**
 * Writes events from another source (an archive RPC or hosted indexer) after
 * the indexer fell behind retention. Same storage and handlers as a run; the
 * cursor is not moved.
 */
export const ingestBackfill = internalMutation({
  args: { events: v.array(rawEventValidator) },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    return ingestEvents(ctx, {
      events: args.events,
      roles: rolesOf(chain),
      network: chain.network,
      chainEpoch: chain.chainEpoch,
      now: Date.now(),
    })
  },
})

/** Dispatches stored `pending` events again after a handler ships. */
export const redispatch = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    return redispatchPending(ctx, {
      roles: rolesOf(chain),
      limit: Math.min(Math.max(1, args.limit ?? 200), 500),
      now: Date.now(),
    })
  },
})

/** Convex user IDs that may read the ops status. */
export function opsUserIds(
  env: Record<string, string | undefined> = process.env
): Set<string> {
  return new Set(
    (env.OPS_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  )
}

const STATUS_SAMPLE = 100

/** Indexer status for `app/ops/chain`. Null unless the user is in `OPS_USER_IDS`. */
export const getIndexerStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId || !opsUserIds().has(userId)) return null
    const chain = readChainEnv()
    const cursor = await ctx.db
      .query('chainCursor')
      .withIndex('by_network', (q) => q.eq('network', chain.network))
      .first()
    const lease = await ctx.db
      .query('chainLeases')
      .withIndex('by_name', (q) => q.eq('name', 'indexer'))
      .first()
    const count = async (handled: 'pending' | 'orphan' | 'error') =>
      (
        await ctx.db
          .query('chainEvents')
          .withIndex('by_handled', (q) => q.eq('handled', handled))
          .take(STATUS_SAMPLE)
      ).length
    const openSubmissions = async (status: 'PREPARED' | 'SUBMITTED') =>
      ctx.db
        .query('chainSubmissions')
        .withIndex('by_status_updated', (q) => q.eq('status', status))
        .take(STATUS_SAMPLE)
    const open = [
      ...(await openSubmissions('PREPARED')),
      ...(await openSubmissions('SUBMITTED')),
    ]
    return {
      network: chain.network,
      chainEpoch: chain.chainEpoch,
      startLedger: indexerStartLedger(),
      contracts: {
        core: chain.coreContractId,
        tab: chain.tabContractId,
        nft: chain.nftContractId,
      },
      cursor: cursor
        ? {
            chainEpoch: cursor.chainEpoch,
            status: cursor.status,
            statusReason: cursor.statusReason ?? null,
            lastLedger: cursor.lastLedger,
            lastLedgerCloseTime: cursor.lastLedgerCloseTime,
            latestLedger: cursor.latestLedger,
            oldestLedger: cursor.oldestLedger,
            lagLedgers: cursor.lagLedgers,
            lastRunAt: cursor.lastRunAt ?? null,
            lastError: cursor.lastError ?? null,
            updatedAt: cursor.updatedAt,
          }
        : null,
      leaseHeld: !!lease && lease.expiresAt > Date.now(),
      events: {
        pending: await count('pending'),
        orphan: await count('orphan'),
        error: await count('error'),
        sampleLimit: STATUS_SAMPLE,
      },
      submissions: {
        open: open.length,
        needsReview: open.filter((s) => s.needsReview === true).length,
        sampleLimit: STATUS_SAMPLE * 2,
      },
    }
  },
})
