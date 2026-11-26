/**
 * Database side of the v2 submission lifecycle
 * (docs/architecture/v2/06-app-integration.md, sections 6.1 and 6.4).
 *
 * `prepareTipSubmission` is called by prepare mutations (direct, highlight
 * and batch tips). The `apply*` helpers are the only code that moves a record
 * to a final state; `convex/chain/submissions.ts` and the event indexer call
 * them. Client input never sets `CONFIRMED` or `MISMATCH` (I-21).
 */
import { ConvexError } from 'convex/values'
import { StrKey } from '@stellar/stellar-sdk'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { requireChainV2Enabled } from './env'
import { confirmedTipPatch } from '../verifiedTips'
import { isHexOfLength, newClientRefHex } from './ids'
import type { ChainRecordStatus } from './schema'
import {
  matchTippedEvent,
  type ExpectedTip,
  type OutcomeStatus,
  type TipVerification,
} from './verify'
import type { TippedEvent } from './events'
import {
  releaseArticleAfterFailure,
  resolveArticleSubmissionFromState,
} from './articleStore'

/** Seconds between prepare and the transaction's upper time bound. */
export const MAX_TIME_WINDOW_SECONDS = 300
/** Verification retries stop this long after `maxTime`; recheck takes over. */
export const VERIFY_WINDOW_AFTER_MAX_TIME_SECONDS = 600
/**
 * The indexer must have processed a ledger that closed at least this long
 * after `maxTime` before a record may expire. Ledgers close every few seconds,
 * so the ledger that closed at or after `maxTime` is then strictly older than
 * the cursor.
 */
export const EXPIRY_COVERAGE_MARGIN_SECONDS = 30
/** RPC retention on testnet: 120,960 ledgers, about 7 days. */
export const RPC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** Unresolved records this close to the retention edge are flagged. */
export const RETENTION_REVIEW_MARGIN_MS = 12 * 60 * 60 * 1000
export const MAX_BATCH_ITEMS = 10

export const FINAL_STATUSES: readonly ChainRecordStatus[] = [
  'CONFIRMED',
  'MISMATCH',
  'FAILED',
]

type TipRow = Doc<'tips'> | Doc<'highlightTips'>
type TipTable = 'tips' | 'highlightTips'
type Related = Doc<'chainSubmissions'>['related'][number]

/** Fields the chain layer owns on a v2 tip row. Callers never pass them. */
type ChainManagedField =
  | 'status'
  | 'contractVersion'
  | 'channel'
  | 'clientRef'
  | 'tokenContractId'
  | 'grossBaseUnits'
  | 'chainArticleKey'
  | 'chainHighlightKey'
  | 'expectedTipperAddress'
  | 'expectedAuthorAddress'
  | 'requestId'
  | 'submissionId'
  | 'chainEpoch'
  | 'maxTime'
  | 'createdLedger'
  | 'stellarNetwork'
  | 'createdAt'
  | 'updatedAt'

type InsertFields<T extends TipTable> = Omit<
  Doc<T>,
  '_id' | '_creationTime' | ChainManagedField
>

export type PrepareTipItem =
  | {
      table: 'tips'
      fields: InsertFields<'tips'>
      articleKey: string
      authorAddress: string
      grossBaseUnits: string
    }
  | {
      table: 'highlightTips'
      fields: InsertFields<'highlightTips'>
      articleKey: string
      highlightKey: string
      authorAddress: string
      grossBaseUnits: string
    }

export type PrepareTipSubmissionArgs = {
  userId: Id<'users'>
  requestId: string
  tipperAddress: string
  items: PrepareTipItem[]
  now: number
  env?: Record<string, string | undefined>
}

export type PreparedTipSubmission = {
  submissionId: Id<'chainSubmissions'>
  maxTime: number
  clientRefs: string[]
  related: Related[]
  coreContractId: string
  tokenContractId: string
  /** True when an earlier call with the same `requestId` created it. */
  existing: boolean
}

function invalid(message: string): never {
  throw new ConvexError({ code: 'INVALID_PREPARE', message })
}

function isAccount(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value)
}

function isBaseUnits(value: string): boolean {
  return /^[1-9][0-9]{0,37}$/.test(value)
}

async function latestKnownLedger(
  ctx: QueryCtx,
  network: 'TESTNET'
): Promise<number | undefined> {
  const cursor = await ctx.db
    .query('chainCursor')
    .withIndex('by_network', (q) => q.eq('network', network))
    .first()
  return cursor?.latestLedger
}

/**
 * Creates the `PREPARED` rows and their `chainSubmissions` row in one
 * mutation. Gated by `CHAIN_V2_ENABLED`. A repeated call with the same
 * `requestId` from the same user returns the existing records.
 */
export async function prepareTipSubmission(
  ctx: MutationCtx,
  args: PrepareTipSubmissionArgs
): Promise<PreparedTipSubmission> {
  const chain = requireChainV2Enabled(args.env)
  if (!chain.coreContractId || !chain.tokenContractId) {
    throw new ConvexError({
      code: 'CHAIN_CONFIG_MISSING',
      message: 'CORE_CONTRACT_ID and TOKEN_CONTRACT_ID must be set.',
    })
  }
  const coreContractId = chain.coreContractId
  const tokenContractId = chain.tokenContractId

  if (
    !args.requestId ||
    args.requestId.length > 100 ||
    !/^[A-Za-z0-9_-]+$/.test(args.requestId)
  ) {
    invalid('requestId must be 1 to 100 letters, digits, "-" or "_".')
  }

  const existing = await ctx.db
    .query('chainSubmissions')
    .withIndex('by_request', (q) => q.eq('requestId', args.requestId))
    .first()
  if (existing) {
    if (existing.userId !== args.userId) {
      invalid('requestId belongs to another request.')
    }
    return {
      submissionId: existing._id,
      maxTime: existing.maxTime,
      clientRefs: existing.clientRefs,
      related: existing.related,
      coreContractId: existing.contractId,
      tokenContractId,
      existing: true,
    }
  }

  if (args.items.length < 1 || args.items.length > MAX_BATCH_ITEMS) {
    invalid(`A submission has 1 to ${MAX_BATCH_ITEMS} tips.`)
  }
  if (!isAccount(args.tipperAddress)) invalid('Invalid tipper address.')
  for (const item of args.items) {
    if (!isHexOfLength(item.articleKey, 32)) invalid('Invalid article key.')
    if (
      item.table === 'highlightTips' &&
      !isHexOfLength(item.highlightKey, 32)
    ) {
      invalid('Invalid highlight key.')
    }
    if (!isAccount(item.authorAddress)) invalid('Invalid author address.')
    if (item.authorAddress === args.tipperAddress) {
      invalid('A tipper cannot tip their own article.')
    }
    if (!isBaseUnits(item.grossBaseUnits)) invalid('Invalid tip amount.')
  }

  const kind = args.items.length === 1 ? 'tip' : 'tip_batch'
  const channel = kind === 'tip' ? 'direct' : 'batch'
  const maxTime = Math.floor(args.now / 1000) + MAX_TIME_WINDOW_SECONDS
  const createdLedger = await latestKnownLedger(ctx, chain.network)
  const clientRefs = args.items.map(() => newClientRefHex())

  const submissionId = await ctx.db.insert('chainSubmissions', {
    network: chain.network,
    chainEpoch: chain.chainEpoch,
    kind,
    userId: args.userId,
    contractId: coreContractId,
    requestId: args.requestId,
    clientRefs,
    maxTime,
    ...(createdLedger === undefined ? {} : { createdLedger }),
    status: 'PREPARED',
    attempts: 0,
    related: [],
    createdAt: args.now,
    updatedAt: args.now,
  })

  const shared = {
    status: 'PREPARED',
    contractVersion: 'v2' as const,
    channel: channel as 'direct' | 'batch',
    tokenContractId,
    expectedTipperAddress: args.tipperAddress,
    requestId: args.requestId,
    submissionId,
    chainEpoch: chain.chainEpoch,
    maxTime,
    ...(createdLedger === undefined ? {} : { createdLedger }),
    stellarNetwork: chain.network,
    createdAt: args.now,
    updatedAt: args.now,
  }

  const related: Related[] = []
  for (const [index, item] of args.items.entries()) {
    const clientRef = clientRefs[index]!
    if (item.table === 'tips') {
      const id = await ctx.db.insert('tips', {
        ...item.fields,
        ...shared,
        clientRef,
        grossBaseUnits: item.grossBaseUnits,
        chainArticleKey: item.articleKey,
        expectedAuthorAddress: item.authorAddress,
      })
      related.push({ table: 'tips', id })
    } else {
      const id = await ctx.db.insert('highlightTips', {
        ...item.fields,
        ...shared,
        clientRef,
        grossBaseUnits: item.grossBaseUnits,
        chainArticleKey: item.articleKey,
        chainHighlightKey: item.highlightKey,
        expectedAuthorAddress: item.authorAddress,
      })
      related.push({ table: 'highlightTips', id })
    }
  }
  await ctx.db.patch(submissionId, { related })

  return {
    submissionId,
    maxTime,
    clientRefs,
    related,
    coreContractId,
    tokenContractId,
    existing: false,
  }
}

export async function loadTipRows(
  ctx: QueryCtx,
  submission: Doc<'chainSubmissions'>
): Promise<Array<{ table: TipTable; row: TipRow }>> {
  const rows: Array<{ table: TipTable; row: TipRow }> = []
  for (const link of submission.related) {
    if (link.table === 'chainArticles') continue
    const row = await ctx.db.get(link.id)
    if (row) rows.push({ table: link.table, row })
  }
  return rows
}

/** The expected payment fields of a v2 tip row, or null if incomplete. */
export function expectedTipFromRow(row: TipRow): ExpectedTip | null {
  if (
    !row.clientRef ||
    !row.chainArticleKey ||
    !row.expectedTipperAddress ||
    !row.expectedAuthorAddress ||
    !row.tokenContractId ||
    !row.grossBaseUnits
  ) {
    return null
  }
  return {
    key: row._id,
    clientRef: row.clientRef,
    articleKey: row.chainArticleKey,
    tipper: row.expectedTipperAddress,
    token: row.tokenContractId,
    gross: row.grossBaseUnits,
    highlightKey: row.chainHighlightKey ?? null,
    author: row.expectedAuthorAddress,
  }
}

function isFinal(status: string): boolean {
  return (FINAL_STATUSES as readonly string[]).includes(status)
}

/** States from which a verified on-chain event may resolve a record. */
const RESOLVABLE: readonly string[] = ['PREPARED', 'SUBMITTED', 'EXPIRED']

/** Serializable verification outcome, as passed from an action. */
export type StoredTipVerification = {
  key: string
  status: OutcomeStatus
  mismatchReason?: string
  needsReview: boolean
  event: StoredTippedEvent | null
}

/**
 * `Tipped` event in its stored form (`chainEvents.data` and action
 * arguments): integers as decimal strings, bytes as lower-case hex.
 */
export type StoredTippedEvent = {
  article_id: string
  author: string
  tipper: string
  token: string
  gross: string
  fee: string
  net: string
  highlight_id: string | null
  content_hash: string
  content_version: number
  client_ref: string
  total_after: string
  split_count: number
}

export function storeTippedEvent(event: TippedEvent): StoredTippedEvent {
  return {
    article_id: event.articleId,
    author: event.author,
    tipper: event.tipper,
    token: event.token,
    gross: event.gross.toString(),
    fee: event.fee.toString(),
    net: event.net.toString(),
    highlight_id: event.highlightId,
    content_hash: event.contentHash,
    content_version: event.contentVersion,
    client_ref: event.clientRef,
    total_after: event.totalAfter.toString(),
    split_count: event.splitCount,
  }
}

export function loadTippedEvent(stored: StoredTippedEvent): TippedEvent {
  return {
    articleId: stored.article_id,
    author: stored.author,
    tipper: stored.tipper,
    token: stored.token,
    gross: BigInt(stored.gross),
    fee: BigInt(stored.fee),
    net: BigInt(stored.net),
    highlightId: stored.highlight_id,
    contentHash: stored.content_hash,
    contentVersion: stored.content_version,
    clientRef: stored.client_ref,
    totalAfter: BigInt(stored.total_after),
    splitCount: stored.split_count,
  }
}

export function storeVerification(
  outcome: TipVerification
): StoredTipVerification {
  return {
    key: outcome.key,
    status: outcome.status,
    ...(outcome.status === 'MISMATCH'
      ? { mismatchReason: outcome.mismatchReason }
      : {}),
    needsReview: outcome.needsReview,
    event: outcome.event ? storeTippedEvent(outcome.event) : null,
  }
}

async function patchRowWithOutcome(
  ctx: MutationCtx,
  table: TipTable,
  row: TipRow,
  outcome: StoredTipVerification,
  extra: { ledger?: number; txHash?: string; chainEventId?: string },
  now: number
): Promise<void> {
  const event = outcome.event
  // CONFIRMED goes through confirmedTipPatch, which also sets verifiedAt.
  // MISMATCH is verified on chain too, so it carries the same timestamps.
  const statusPatch =
    outcome.status === 'MISMATCH'
      ? {
          status: outcome.status,
          verifiedAt: now,
          processedAt: now,
          updatedAt: now,
        }
      : confirmedTipPatch(now)
  const patch = {
    ...statusPatch,
    needsReview: outcome.needsReview,
    mismatchReason: outcome.mismatchReason,
    ...(extra.ledger === undefined ? {} : { stellarLedger: extra.ledger }),
    ...(extra.txHash === undefined ? {} : { stellarTxId: extra.txHash }),
    ...(extra.chainEventId === undefined
      ? {}
      : { chainEventId: extra.chainEventId }),
    ...(event ? decodedEventFields(event) : {}),
  }
  if (table === 'tips') {
    await ctx.db.patch(row._id as Id<'tips'>, patch)
  } else {
    await ctx.db.patch(row._id as Id<'highlightTips'>, patch)
  }
}

async function patchRowStatus(
  ctx: MutationCtx,
  table: TipTable,
  id: TipRow['_id'],
  patch: Partial<Doc<'tips'>> & Partial<Doc<'highlightTips'>>
): Promise<void> {
  if (table === 'tips') {
    await ctx.db.patch(id as Id<'tips'>, patch)
  } else {
    await ctx.db.patch(id as Id<'highlightTips'>, patch)
  }
}

/** Recomputes a submission's state from its rows once every row is final. */
export async function refreshSubmissionFromRows(
  ctx: MutationCtx,
  submissionId: Id<'chainSubmissions'>,
  now: number,
  extra: { ledger?: number } = {}
): Promise<void> {
  const submission = await ctx.db.get(submissionId)
  if (!submission) return
  const rows = await loadTipRows(ctx, submission)
  if (rows.length === 0) return
  const statuses = rows.map(({ row }) => row.status)
  if (!statuses.every((s) => s === 'CONFIRMED' || s === 'MISMATCH')) return
  const mismatch = rows.find(({ row }) => row.status === 'MISMATCH')
  await ctx.db.patch(submissionId, {
    status: mismatch ? 'MISMATCH' : 'CONFIRMED',
    mismatchReason: mismatch?.row.mismatchReason,
    needsReview: rows.some(({ row }) => row.needsReview === true),
    updatedAt: now,
    ...(extra.ledger === undefined ? {} : { ledger: extra.ledger }),
  })
}

/**
 * Applies the outcome of rule (a): RPC returned `SUCCESS` for the submission's
 * hash. Idempotent; a final submission is left unchanged.
 */
export async function applyTransactionVerification(
  ctx: MutationCtx,
  args: {
    submissionId: Id<'chainSubmissions'>
    txHash: string
    ledger: number
    outcomes: StoredTipVerification[]
    now: number
  }
): Promise<'applied' | 'skipped'> {
  const submission = await ctx.db.get(args.submissionId)
  if (!submission || submission.txHash !== args.txHash) return 'skipped'
  if (!RESOLVABLE.includes(submission.status)) return 'skipped'
  const rows = await loadTipRows(ctx, submission)
  const byKey = new Map(args.outcomes.map((o) => [o.key, o]))
  for (const { table, row } of rows) {
    if (isFinal(row.status)) continue
    // (txHash, clientRef) deduplication: a row carries one hash only.
    if (row.stellarTxId && row.stellarTxId !== args.txHash) continue
    const outcome = byKey.get(row._id)
    if (!outcome) continue
    await patchRowWithOutcome(
      ctx,
      table,
      row,
      outcome,
      { ledger: args.ledger, txHash: args.txHash },
      args.now
    )
  }
  await refreshSubmissionFromRows(ctx, args.submissionId, args.now, {
    ledger: args.ledger,
  })
  return 'applied'
}

/**
 * The decoded on-chain values a row keeps next to its expected values, so a
 * reviewer sees what the transaction actually paid.
 */
export function decodedEventFields(event: StoredTippedEvent) {
  return {
    onChainAuthorAddress: event.author,
    onChainTipperAddress: event.tipper,
    onChainTokenContractId: event.token,
    onChainGrossBaseUnits: event.gross,
    onChainArticleKey: event.article_id,
    onChainHighlightKey: event.highlight_id,
    onChainClientRef: event.client_ref,
    feeBaseUnits: event.fee,
    netBaseUnits: event.net,
    chainContentHash: event.content_hash,
    chainContentVersion: event.content_version,
  }
}

/**
 * Flags a submission and one row for manual review when an on-chain event
 * carries the row's `client_ref` but cannot resolve it: the row is `FAILED`,
 * or the submission recorded a different hash. Money may have moved, so the
 * record must not expire or offer a retry.
 */
async function flagEventConflict(
  ctx: MutationCtx,
  submission: Doc<'chainSubmissions'>,
  found: { table: TipTable; row: TipRow },
  reason: 'event_after_failure' | 'event_hash_differs',
  now: number,
  event: StoredTippedEvent,
  eventMeta: { txHash: string; ledger: number; eventId: string }
): Promise<void> {
  // The row keeps its status; the decoded payment is recorded for review.
  await patchRowStatus(ctx, found.table, found.row._id, {
    needsReview: true,
    mismatchReason: reason,
    chainEventId: eventMeta.eventId,
    ...decodedEventFields(event),
    updatedAt: now,
  })
  await ctx.db.patch(submission._id, {
    needsReview: true,
    lastError: reason,
    updatedAt: now,
  })
}

/**
 * Rule (b): a stored `Tipped` event from the submission's contract carries a
 * row's `client_ref`. Resolves that row (and the submission once every row is
 * final). Returns `orphan` when no v2 row has the `client_ref`, so the indexer
 * can mark the event. Returns `conflict` when the event cannot resolve the
 * row (the row is `FAILED`, or the submission recorded another hash); the
 * record is then flagged for review and never expires or offers a retry.
 */
export async function applyStoredTippedEvent(
  ctx: MutationCtx,
  args: {
    contractId: string
    txHash: string
    ledger: number
    eventId: string
    event: StoredTippedEvent
    now: number
  }
): Promise<'linked' | 'already_final' | 'orphan' | 'conflict'> {
  const clientRef = args.event.client_ref
  const tip = await ctx.db
    .query('tips')
    .withIndex('by_client_ref', (q) => q.eq('clientRef', clientRef))
    .first()
  const highlight = tip
    ? null
    : await ctx.db
        .query('highlightTips')
        .withIndex('by_client_ref', (q) => q.eq('clientRef', clientRef))
        .first()
  const found: { table: TipTable; row: TipRow } | null = tip
    ? { table: 'tips', row: tip }
    : highlight
      ? { table: 'highlightTips', row: highlight }
      : null
  if (!found || found.row.contractVersion !== 'v2' || !found.row.submissionId) {
    return 'orphan'
  }
  const submission = await ctx.db.get(found.row.submissionId)
  if (!submission || submission.contractId !== args.contractId) return 'orphan'
  if (found.row.status === 'FAILED') {
    await flagEventConflict(
      ctx,
      submission,
      found,
      'event_after_failure',
      args.now,
      args.event,
      args
    )
    return 'conflict'
  }
  if (!RESOLVABLE.includes(found.row.status)) return 'already_final'
  // A recorded hash must match; a batch row shares the submission's hash.
  if (submission.txHash && submission.txHash !== args.txHash) {
    await flagEventConflict(
      ctx,
      submission,
      found,
      'event_hash_differs',
      args.now,
      args.event,
      args
    )
    return 'conflict'
  }

  const expected = expectedTipFromRow(found.row)
  if (!expected) return 'orphan'
  let outcome: StoredTipVerification
  if (
    submission.createdLedger !== undefined &&
    args.ledger < submission.createdLedger
  ) {
    outcome = {
      key: expected.key,
      status: 'MISMATCH',
      mismatchReason: 'field:ledger',
      needsReview: true,
      event: args.event,
    }
  } else {
    outcome = storeVerification(
      matchTippedEvent(expected, loadTippedEvent(args.event))
    )
  }
  await patchRowWithOutcome(
    ctx,
    found.table,
    found.row,
    outcome,
    { ledger: args.ledger, txHash: args.txHash, chainEventId: args.eventId },
    args.now
  )
  if (!submission.txHash) {
    await ctx.db.patch(submission._id, { txHash: args.txHash })
  }
  await refreshSubmissionFromRows(ctx, submission._id, args.now, {
    ledger: args.ledger,
  })
  return 'linked'
}

/**
 * Marks a submission and its rows `FAILED`. Allowed only from `PREPARED` (a
 * send `ERROR` or a failed simulation) or `SUBMITTED` when RPC reported the
 * transaction `FAILED`. Never applies to a final or `EXPIRED` record.
 */
export async function applyFailure(
  ctx: MutationCtx,
  args: {
    submissionId: Id<'chainSubmissions'>
    from: 'PREPARED' | 'SUBMITTED'
    reason: string
    txHash?: string
    now: number
  }
): Promise<'applied' | 'skipped'> {
  const submission = await ctx.db.get(args.submissionId)
  if (!submission || submission.status !== args.from) return 'skipped'
  if (args.from === 'SUBMITTED' && submission.txHash !== args.txHash) {
    return 'skipped'
  }
  const rows = await loadTipRows(ctx, submission)
  for (const { table, row } of rows) {
    if (row.status !== args.from) continue
    await patchRowStatus(ctx, table, row._id, {
      status: 'FAILED',
      failureReason: args.reason,
      processedAt: args.now,
      updatedAt: args.now,
    })
  }
  await ctx.db.patch(args.submissionId, {
    status: 'FAILED',
    lastError: args.reason,
    updatedAt: args.now,
  })
  await releaseArticleAfterFailure(ctx, submission, args.now)
  return 'applied'
}

/** True when the indexer has covered every ledger up to `maxTime`. */
export function indexerCoversMaxTime(
  cursor: Doc<'chainCursor'> | null,
  maxTime: number
): boolean {
  // Only a cursor that is moving normally proves coverage.
  if (!cursor || (cursor.status !== 'OK' && cursor.status !== 'LAGGING')) {
    return false
  }
  return cursor.lastLedgerCloseTime >= maxTime + EXPIRY_COVERAGE_MARGIN_SECONDS
}

/**
 * For a `PREPARED` or `SUBMITTED` record that RPC cannot find: applies rule
 * (b) from stored events, then the expiry rule, then the retention flag.
 */
export async function resolveWithoutTransaction(
  ctx: MutationCtx,
  args: { submissionId: Id<'chainSubmissions'>; now: number }
): Promise<'linked' | 'expired' | 'flagged' | 'waiting' | 'skipped'> {
  const submission = await ctx.db.get(args.submissionId)
  if (!submission) return 'skipped'
  if (submission.status !== 'PREPARED' && submission.status !== 'SUBMITTED') {
    return 'skipped'
  }

  // Rule (b) for article submissions: the indexer already applied the
  // expected Core event to the article.
  if (await resolveArticleSubmissionFromState(ctx, submission, args.now)) {
    return 'linked'
  }

  // Rule (b): an indexed Tipped event carrying a row's client_ref.
  let linked = false
  let conflict = false
  for (const clientRef of submission.clientRefs) {
    const events = await ctx.db
      .query('chainEvents')
      .withIndex('by_client_ref', (q) => q.eq('clientRef', clientRef))
      .take(20)
    const event = events.find(
      (e) => e.contractId === submission.contractId && e.type === 'tipped'
    )
    if (!event) continue
    const result = await applyStoredTippedEvent(ctx, {
      contractId: event.contractId,
      txHash: event.txHash,
      ledger: event.ledger,
      eventId: event.eventId,
      event: event.data as StoredTippedEvent,
      now: args.now,
    })
    if (result === 'linked') linked = true
    if (result === 'conflict') conflict = true
  }
  if (linked) return 'linked'
  // An event for this record exists but could not resolve it: never expire.
  if (conflict) return 'flagged'

  const cursor = await ctx.db
    .query('chainCursor')
    .withIndex('by_network', (q) => q.eq('network', submission.network))
    .first()
  if (indexerCoversMaxTime(cursor, submission.maxTime)) {
    const rows = await loadTipRows(ctx, submission)
    for (const { table, row } of rows) {
      if (row.status !== 'PREPARED' && row.status !== 'SUBMITTED') continue
      await patchRowStatus(ctx, table, row._id, {
        status: 'EXPIRED',
        processedAt: args.now,
        updatedAt: args.now,
      })
    }
    await ctx.db.patch(submission._id, {
      status: 'EXPIRED',
      updatedAt: args.now,
    })
    await releaseArticleAfterFailure(ctx, submission, args.now)
    return 'expired'
  }

  if (
    !submission.needsReview &&
    args.now - submission.createdAt >
      RPC_RETENTION_MS - RETENTION_REVIEW_MARGIN_MS
  ) {
    await ctx.db.patch(submission._id, {
      needsReview: true,
      lastError: 'unresolved_at_retention_edge',
      updatedAt: args.now,
    })
    return 'flagged'
  }
  // Move the record to the back of the recheck order so other due records
  // are reached on the next run.
  await ctx.db.patch(submission._id, { updatedAt: args.now })
  return 'waiting'
}
