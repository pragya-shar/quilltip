/**
 * Payments v2 submissions (docs/architecture/v2/06-app-integration.md,
 * sections 6.1, 6.3 and 6.4).
 *
 * Lifecycle: PREPARED → SUBMITTED → CONFIRMED | MISMATCH | FAILED | EXPIRED,
 * plus PREPARED → EXPIRED and EXPIRED → CONFIRMED | MISMATCH.
 *
 * - `recordSubmitted` stores the hash the client sent; it never confirms.
 * - `verifySubmission` asks RPC for the transaction (rule (a)).
 * - `recheckPending` takes over after `maxTime + 10 min`: rule (b) from indexed
 *   events, then the expiry rule tied to indexer coverage.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
} from '../_generated/server'
import { readChainEnv } from '../lib/chain/env'
import { acquireLease, releaseLease } from '../lib/chain/lease'
import {
  RpcError,
  createBackendRpcClient,
  type RpcFetch,
} from '../lib/chain/rpc'
import {
  VERIFY_WINDOW_AFTER_MAX_TIME_SECONDS,
  applyFailure,
  applyTransactionVerification,
  expectedTipFromRow,
  loadTipRows,
  resolveWithoutTransaction,
  storeVerification,
} from '../lib/chain/submissionStore'
import { verifyTippedTransaction } from '../lib/chain/verify'

const TX_HASH = /^[0-9a-f]{64}$/
const RECHECK_LEASE_TTL_MS = 110_000
const RECHECK_BATCH = 50
const RECHECK_RUN_BUDGET_MS = 80_000

/** Backoff for verification retries: 2, 4, 8 … 60 seconds. */
export function verifyRetryDelayMs(attempt: number): number {
  return Math.min(2000 * 2 ** Math.max(0, attempt), 60_000)
}

const storedEventValidator = v.object({
  article_id: v.string(),
  author: v.string(),
  tipper: v.string(),
  token: v.string(),
  gross: v.string(),
  fee: v.string(),
  net: v.string(),
  highlight_id: v.union(v.string(), v.null()),
  content_hash: v.string(),
  content_version: v.number(),
  client_ref: v.string(),
  total_after: v.string(),
  split_count: v.number(),
})

const outcomeValidator = v.object({
  key: v.string(),
  status: v.union(v.literal('CONFIRMED'), v.literal('MISMATCH')),
  mismatchReason: v.optional(v.string()),
  needsReview: v.boolean(),
  event: v.union(storedEventValidator, v.null()),
})

async function requireOwnSubmission(
  ctx: MutationCtx,
  submissionId: Id<'chainSubmissions'>
) {
  const userId = await getAuthUserId(ctx)
  if (!userId) {
    throw new ConvexError({
      code: 'UNAUTHENTICATED',
      message: 'Sign in first.',
    })
  }
  const submission = await ctx.db.get(submissionId)
  if (!submission || submission.userId !== userId) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: 'Submission not found.',
    })
  }
  return userId
}

/**
 * Client step 5: `sendTransaction` returned `PENDING` or `DUPLICATE`. Stores
 * the hash once and schedules verification. Repeating the call with the same
 * hash is a no-op; a different hash is refused.
 */
export const recordSubmitted = mutation({
  args: { submissionId: v.id('chainSubmissions'), txHash: v.string() },
  handler: async (ctx, args) => {
    await requireOwnSubmission(ctx, args.submissionId)
    readChainEnv()
    const txHash = args.txHash.trim().toLowerCase()
    if (!TX_HASH.test(txHash)) {
      throw new ConvexError({
        code: 'INVALID_TX_HASH',
        message: 'Invalid transaction hash.',
      })
    }
    const submission = (await ctx.db.get(args.submissionId))!
    if (submission.txHash === txHash) {
      return { status: submission.status, duplicate: true }
    }
    if (submission.status !== 'PREPARED' || submission.txHash) {
      throw new ConvexError({
        code: 'INVALID_STATE',
        message: `Submission is ${submission.status}.`,
      })
    }
    // (txHash, clientRef) deduplication: a hash belongs to one submission.
    const other = await ctx.db
      .query('chainSubmissions')
      .withIndex('by_tx', (q) => q.eq('txHash', txHash))
      .first()
    if (other && other._id !== submission._id) {
      throw new ConvexError({
        code: 'DUPLICATE_TX',
        message: 'This transaction is already recorded.',
      })
    }

    const now = Date.now()
    await ctx.db.patch(submission._id, {
      status: 'SUBMITTED',
      txHash,
      updatedAt: now,
    })
    for (const { table, row } of await loadTipRows(ctx, submission)) {
      if (row.status !== 'PREPARED') continue
      const patch = {
        status: 'SUBMITTED',
        stellarTxId: txHash,
        verificationRequestedAt: now,
        updatedAt: now,
      }
      if (table === 'tips') await ctx.db.patch(row._id as Id<'tips'>, patch)
      else await ctx.db.patch(row._id as Id<'highlightTips'>, patch)
    }
    await ctx.scheduler.runAfter(
      0,
      internal.chain.submissions.verifySubmission,
      {
        submissionId: submission._id,
        attempt: 0,
      }
    )
    return { status: 'SUBMITTED' as const, duplicate: false }
  },
})

/**
 * Client step 3 or 5: simulation failed, or `sendTransaction` returned
 * `ERROR`. Only a `PREPARED` record without a hash can fail this way.
 */
export const recordSendFailed = mutation({
  args: {
    submissionId: v.id('chainSubmissions'),
    reason: v.union(v.literal('simulation_failed'), v.literal('send_error')),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnSubmission(ctx, args.submissionId)
    const detail = args.detail?.slice(0, 200)
    const result = await applyFailure(ctx, {
      submissionId: args.submissionId,
      from: 'PREPARED',
      reason: detail ? `${args.reason}: ${detail}` : args.reason,
      now: Date.now(),
    })
    if (result === 'skipped') {
      throw new ConvexError({
        code: 'INVALID_STATE',
        message: 'Only a prepared, unsent submission can be marked failed.',
      })
    }
    return { status: 'FAILED' as const }
  },
})

/** Status for the client. Retry is offered only after FAILED or EXPIRED. */
export const getSubmissionStatus = query({
  args: { submissionId: v.id('chainSubmissions') },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const submission = await ctx.db.get(args.submissionId)
    if (!submission || submission.userId !== userId) return null
    const rows = await loadTipRows(ctx, submission)
    return {
      submissionId: submission._id,
      kind: submission.kind,
      status: submission.status,
      txHash: submission.txHash ?? null,
      maxTime: submission.maxTime,
      mismatchReason: submission.mismatchReason ?? null,
      needsReview: submission.needsReview === true,
      // A record flagged for review may hold a payment that landed.
      canRetry:
        (submission.status === 'FAILED' || submission.status === 'EXPIRED') &&
        submission.needsReview !== true,
      rows: rows.map(({ table, row }) => ({
        table,
        id: row._id as string,
        clientRef: row.clientRef ?? null,
        status: row.status,
        mismatchReason: row.mismatchReason ?? null,
        onChainAuthorAddress: row.onChainAuthorAddress ?? null,
      })),
    }
  },
})

export const loadForVerification = internalQuery({
  args: { submissionId: v.id('chainSubmissions') },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId)
    if (!submission) return null
    const rows = await loadTipRows(ctx, submission)
    return {
      submission,
      expected: rows
        .map(({ row }) => expectedTipFromRow(row))
        .filter((e): e is NonNullable<typeof e> => e !== null),
    }
  },
})

export const applyVerification = internalMutation({
  args: {
    submissionId: v.id('chainSubmissions'),
    txHash: v.string(),
    ledger: v.number(),
    outcomes: v.array(outcomeValidator),
  },
  handler: async (ctx, args) =>
    applyTransactionVerification(ctx, { ...args, now: Date.now() }),
})

export const applyRpcFailed = internalMutation({
  args: { submissionId: v.id('chainSubmissions'), txHash: v.string() },
  handler: async (ctx, args) =>
    applyFailure(ctx, {
      submissionId: args.submissionId,
      from: 'SUBMITTED',
      reason: 'transaction_failed',
      txHash: args.txHash,
      now: Date.now(),
    }),
})

export const noteAttempt = internalMutation({
  args: {
    submissionId: v.id('chainSubmissions'),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId)
    if (!submission) return
    await ctx.db.patch(args.submissionId, {
      attempts: submission.attempts + 1,
      // Also rotates the record in the recheck order (by_status_updated).
      updatedAt: Date.now(),
      ...(args.error ? { lastError: args.error.slice(0, 300) } : {}),
    })
  },
})

export const resolveUnfound = internalMutation({
  args: { submissionId: v.id('chainSubmissions') },
  handler: async (ctx, args) =>
    resolveWithoutTransaction(ctx, {
      submissionId: args.submissionId,
      now: Date.now(),
    }),
})

type CheckResult =
  | 'confirmed_or_mismatch'
  | 'failed'
  | 'not_found'
  | 'rpc_error'
  | 'skipped'

/**
 * One RPC check of a submitted transaction. Shared by `verifySubmission` and
 * `recheckPending`. `fetchImpl` is injectable for tests.
 */
export async function checkSubmission(
  ctx: Pick<ActionCtx, 'runQuery' | 'runMutation'>,
  submissionId: Id<'chainSubmissions'>,
  fetchImpl?: RpcFetch
): Promise<{ result: CheckResult; maxTime: number | null }> {
  const loaded = await ctx.runQuery(
    internal.chain.submissions.loadForVerification,
    { submissionId }
  )
  if (!loaded) return { result: 'skipped', maxTime: null }
  const { submission, expected } = loaded
  const maxTime: number = submission.maxTime
  if (
    !submission.txHash ||
    !['SUBMITTED', 'EXPIRED', 'PREPARED'].includes(submission.status)
  ) {
    return { result: 'skipped', maxTime }
  }

  const rpc = createBackendRpcClient(fetchImpl)
  let tx
  try {
    tx = await rpc.getTransaction(submission.txHash)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await ctx.runMutation(internal.chain.submissions.noteAttempt, {
      submissionId,
      error: message,
    })
    if (error instanceof RpcError) return { result: 'rpc_error', maxTime }
    throw error
  }
  await ctx.runMutation(internal.chain.submissions.noteAttempt, {
    submissionId,
  })

  if (tx.status === 'NOT_FOUND') return { result: 'not_found', maxTime }
  if (tx.status === 'FAILED') {
    await ctx.runMutation(internal.chain.submissions.applyRpcFailed, {
      submissionId,
      txHash: submission.txHash,
    })
    return { result: 'failed', maxTime }
  }

  const outcomes = verifyTippedTransaction({
    expected,
    coreContractId: submission.contractId,
    contractEventsXdr: tx.contractEventsXdr,
    ledger: tx.ledger!,
    createdLedger: submission.createdLedger ?? null,
  }).map(storeVerification)
  await ctx.runMutation(internal.chain.submissions.applyVerification, {
    submissionId,
    txHash: submission.txHash,
    ledger: tx.ledger!,
    outcomes,
  })
  return { result: 'confirmed_or_mismatch', maxTime }
}

/**
 * Step 7: authoritative verification. Retries back off at 2, 4, 8 … 60 s
 * until `maxTime + 10 min`; after that `recheckPending` takes over.
 */
export const verifySubmission = internalAction({
  args: { submissionId: v.id('chainSubmissions'), attempt: v.number() },
  handler: async (ctx, args) => {
    readChainEnv()
    const { result, maxTime } = await checkSubmission(ctx, args.submissionId)
    if (result !== 'not_found' && result !== 'rpc_error') return result
    const delay = verifyRetryDelayMs(args.attempt)
    const deadline =
      ((maxTime ?? 0) + VERIFY_WINDOW_AFTER_MAX_TIME_SECONDS) * 1000
    if (Date.now() + delay <= deadline) {
      await ctx.scheduler.runAfter(
        delay,
        internal.chain.submissions.verifySubmission,
        { submissionId: args.submissionId, attempt: args.attempt + 1 }
      )
    }
    return result
  },
})

export const listRecheckCandidates = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const nowSeconds = Math.floor(args.now / 1000)
    const out: Id<'chainSubmissions'>[] = []
    for (const status of ['SUBMITTED', 'PREPARED'] as const) {
      const rows = await ctx.db
        .query('chainSubmissions')
        .withIndex('by_status_updated', (q) => q.eq('status', status))
        .order('asc')
        .take(RECHECK_BATCH * 4)
      for (const row of rows) {
        const due =
          status === 'SUBMITTED'
            ? nowSeconds > row.maxTime + VERIFY_WINDOW_AFTER_MAX_TIME_SECONDS
            : nowSeconds > row.maxTime
        if (due) out.push(row._id)
        if (out.length >= RECHECK_BATCH) return out
      }
    }
    return out
  },
})

export const acquireRecheckLease = internalMutation({
  args: { holder: v.string() },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    return acquireLease(ctx, {
      name: 'recheck',
      holder: args.holder,
      ttlMs: RECHECK_LEASE_TTL_MS,
      now: Date.now(),
      network: chain.network,
      chainEpoch: chain.chainEpoch,
    })
  },
})

export const releaseRecheckLease = internalMutation({
  args: { holder: v.string() },
  handler: async (ctx, args) =>
    releaseLease(ctx, { name: 'recheck', holder: args.holder }),
})

/**
 * Cron (every 2 minutes, under the `recheck` lease). For each due record:
 * a recorded hash is checked with RPC (rule (a)); a record RPC cannot find is
 * resolved from indexed events (rule (b)) or expires once the indexer covers
 * `maxTime`. Records still open near the RPC retention edge are flagged.
 */
export const recheckPending = internalAction({
  args: {},
  handler: async (ctx) => {
    readChainEnv()
    const due = await ctx.runQuery(
      internal.chain.submissions.listRecheckCandidates,
      { now: Date.now() }
    )
    if (due.length === 0) return { skipped: false, checked: 0 }
    const holder = crypto.randomUUID()
    const acquired = await ctx.runMutation(
      internal.chain.submissions.acquireRecheckLease,
      { holder }
    )
    if (!acquired) return { skipped: true, checked: 0 }
    let checked = 0
    const startedAt = Date.now()
    try {
      const ids = await ctx.runQuery(
        internal.chain.submissions.listRecheckCandidates,
        { now: Date.now() }
      )
      for (const submissionId of ids) {
        // Stop well inside the lease so two runs never overlap; the rest are
        // reached on the next run.
        if (Date.now() - startedAt > RECHECK_RUN_BUDGET_MS) break
        checked++
        const { result } = await checkSubmission(ctx, submissionId)
        if (result === 'not_found' || result === 'skipped') {
          await ctx.runMutation(internal.chain.submissions.resolveUnfound, {
            submissionId,
          })
        }
      }
    } finally {
      await ctx.runMutation(internal.chain.submissions.releaseRecheckLease, {
        holder,
      })
    }
    return { skipped: false, checked }
  },
})
