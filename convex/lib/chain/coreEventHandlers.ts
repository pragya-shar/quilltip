/**
 * Handlers for Core contract events (contracts/core/src/events.rs;
 * docs/architecture/v2/02-core-contract.md, section 2.4).
 *
 * Each handler reads the stored, JSON-safe event (`IndexedEvent.doc`) and is
 * idempotent. Article events apply in event order: an event older than the
 * article's `lastEventId` is ignored, so a replayed or out-of-order page
 * cannot undo a newer change. `Tipped` totals only ever grow.
 */
import { StrKey } from '@stellar/stellar-sdk'
import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { isHexOfLength } from './ids'
import type {
  ChainEventHandler,
  HandlerResult,
  IndexedEvent,
} from './indexerStore'
import {
  applyStoredTippedEvent,
  type StoredTippedEvent,
} from './submissionStore'

type Data = Record<string, unknown>

class StoredEventError extends Error {}

function data(event: IndexedEvent): Data {
  const value = event.doc.data
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoredEventError(`${event.doc.type}: data is not a map`)
  }
  return value as Data
}

function hex(value: unknown, bytes: number, field: string): string {
  if (typeof value !== 'string' || !isHexOfLength(value, bytes)) {
    throw new StoredEventError(`${field} is not ${bytes} bytes`)
  }
  return value
}

function optionalHex(value: unknown, bytes: number, field: string) {
  return value === null || value === undefined ? null : hex(value, bytes, field)
}

function address(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !(StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value))
  ) {
    throw new StoredEventError(`${field} is not an address`)
  }
  return value
}

function integerString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^-?[0-9]+$/.test(value)) {
    throw new StoredEventError(`${field} is not an integer`)
  }
  return value
}

function u32(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StoredEventError(`${field} is not a u32`)
  }
  return value
}

function splits(value: unknown): Array<{ recipient: string; bps: number }> {
  if (!Array.isArray(value)) throw new StoredEventError('splits is not a list')
  return value.map((item, i) => {
    const s = item as Data
    return {
      recipient: address(s?.recipient, `splits[${i}].recipient`),
      bps: u32(s?.bps, `splits[${i}].bps`),
    }
  })
}

function articleKey(event: IndexedEvent): string {
  return hex(event.doc.topics[1], 32, 'article_id')
}

/**
 * The article row of the event's chain epoch. Article keys stay the same
 * after a testnet reset, so a row from an earlier epoch must never match.
 */
async function findArticle(
  ctx: MutationCtx,
  key: string,
  chainEpoch: string
): Promise<Doc<'chainArticles'> | null> {
  const rows = await ctx.db
    .query('chainArticles')
    .withIndex('by_article_key', (q) => q.eq('articleKey', key))
    .take(20)
  return rows.find((row) => row.chainEpoch === chainEpoch) ?? null
}

/**
 * Applies `patch` to the article unless a newer event was applied already.
 * Articles registered outside the app have no row: the event is an orphan.
 */
async function applyArticleEvent(
  ctx: MutationCtx,
  event: IndexedEvent,
  patch: (article: Doc<'chainArticles'>) => Partial<Doc<'chainArticles'>>
): Promise<HandlerResult> {
  const article = await findArticle(
    ctx,
    articleKey(event),
    event.doc.chainEpoch
  )
  if (!article) return 'orphan'
  if (article.lastEventId && article.lastEventId >= event.doc.eventId) {
    return 'done'
  }
  await ctx.db.patch(article._id, {
    ...patch(article),
    lastEventId: event.doc.eventId,
    updatedAt: event.now,
  })
  return 'done'
}

function guarded(handler: ChainEventHandler): ChainEventHandler {
  return async (ctx, event) => {
    try {
      return await handler(ctx, event)
    } catch (error) {
      if (error instanceof StoredEventError) {
        console.error(
          JSON.stringify({
            code: 'CHAIN_INDEXER_MALFORMED_EVENT',
            eventId: event.doc.eventId,
            type: event.doc.type,
            message: error.message,
          })
        )
        return 'error'
      }
      throw error
    }
  }
}

/** The stored `Tipped` event in the form the submission store expects. */
export function storedTippedFromEvent(event: IndexedEvent): StoredTippedEvent {
  const d = data(event)
  return {
    article_id: articleKey(event),
    author: address(event.doc.topics[2], 'author'),
    tipper: address(d.tipper, 'tipper'),
    token: address(d.token, 'token'),
    gross: integerString(d.gross, 'gross'),
    fee: integerString(d.fee, 'fee'),
    net: integerString(d.net, 'net'),
    highlight_id: optionalHex(d.highlight_id, 32, 'highlight_id'),
    content_hash: hex(d.content_hash, 32, 'content_hash'),
    content_version: u32(d.content_version, 'content_version'),
    client_ref: hex(d.client_ref, 16, 'client_ref'),
    total_after: integerString(d.total_after, 'total_after'),
    split_count: u32(d.split_count, 'split_count'),
  }
}

const tipped: ChainEventHandler = async (ctx, event) => {
  const stored = storedTippedFromEvent(event)

  // Article totals include tips made outside the app (section 6.5).
  const article = await findArticle(
    ctx,
    stored.article_id,
    event.doc.chainEpoch
  )
  if (article) {
    const current = article.totals[stored.token]
    if (current === undefined || BigInt(stored.total_after) > BigInt(current)) {
      await ctx.db.patch(article._id, {
        totals: { ...article.totals, [stored.token]: stored.total_after },
        updatedAt: event.now,
      })
    }
  }

  // Rule (b): confirm or link the record that carries this client_ref.
  const outcome = await applyStoredTippedEvent(ctx, {
    contractId: event.doc.contractId,
    txHash: event.doc.txHash,
    ledger: event.doc.ledger,
    eventId: event.doc.eventId,
    event: stored,
    now: event.now,
  })
  return outcome === 'orphan' ? 'orphan' : 'done'
}

const articleRegistered: ChainEventHandler = (ctx, event) => {
  const d = data(event)
  const author = address(event.doc.topics[2], 'author')
  const contentHash = hex(d.content_hash, 32, 'content_hash')
  const arweaveId = optionalHex(d.arweave_id, 32, 'arweave_id')
  const articleSplits = splits(d.splits)
  return applyArticleEvent(ctx, event, () => ({
    status: 'REGISTERED',
    authorAddress: author,
    pendingAuthor: undefined,
    contentHash,
    arweaveId: arweaveId ?? undefined,
    contentVersion: 1,
    splits: articleSplits,
    registeredLedger: event.doc.ledger,
    txHash: event.doc.txHash,
  }))
}

const contentUpdated: ChainEventHandler = (ctx, event) => {
  const d = data(event)
  const contentHash = hex(d.content_hash, 32, 'content_hash')
  const arweaveId = optionalHex(d.arweave_id, 32, 'arweave_id')
  const contentVersion = u32(d.content_version, 'content_version')
  return applyArticleEvent(ctx, event, (article) =>
    contentVersion > article.contentVersion
      ? { contentHash, arweaveId: arweaveId ?? undefined, contentVersion }
      : {}
  )
}

const splitsSet: ChainEventHandler = (ctx, event) => {
  const articleSplits = splits(data(event).splits)
  return applyArticleEvent(ctx, event, () => ({ splits: articleSplits }))
}

const authorProposed: ChainEventHandler = (ctx, event) => {
  const newAuthor = address(data(event).new_author, 'new_author')
  return applyArticleEvent(ctx, event, () => ({ pendingAuthor: newAuthor }))
}

const authorProposalCancelled: ChainEventHandler = (ctx, event) => {
  address(data(event).new_author, 'new_author')
  return applyArticleEvent(ctx, event, () => ({ pendingAuthor: undefined }))
}

const authorChanged: ChainEventHandler = (ctx, event) => {
  const next = address(data(event).new, 'new')
  return applyArticleEvent(ctx, event, () => ({
    authorAddress: next,
    pendingAuthor: undefined,
  }))
}

const tokenSet: ChainEventHandler = async (ctx, event) => {
  const token = address(event.doc.topics[1], 'token')
  const minTip = integerString(data(event).min_tip, 'min_tip')
  const config = await ctx.db
    .query('chainConfig')
    .withIndex('by_network', (q) => q.eq('network', event.doc.network))
    .first()
  if (
    config &&
    config.tokenContractId === token &&
    config.coreContractId === event.doc.contractId
  ) {
    await ctx.db.patch(config._id, { minTip })
  }
  return 'done'
}

/** Stored for the record; no table depends on them. */
const recordOnly: ChainEventHandler = async () => 'done'

export const CORE_EVENT_HANDLERS: Readonly<Record<string, ChainEventHandler>> =
  {
    'core:tipped': guarded(tipped),
    'core:article_registered': guarded(articleRegistered),
    'core:content_updated': guarded(contentUpdated),
    'core:splits_set': guarded(splitsSet),
    'core:author_proposed': guarded(authorProposed),
    'core:author_proposal_cancelled': guarded(authorProposalCancelled),
    'core:author_changed': guarded(authorChanged),
    'core:token_set': guarded(tokenSet),
    'core:token_removed': recordOnly,
    'core:treasury_set': recordOnly,
    'core:migrated': recordOnly,
  }
