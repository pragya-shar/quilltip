/**
 * Database side of the v2 article NFT (docs/architecture/v2/05-flows-and-admin.md,
 * section 5.10; 06-app-integration.md, sections 6.1, 6.2 and 6.5).
 *
 * - `applyMintedEvent` and `applyTransferEvent` are the only code that
 *   creates a v2 `articleNFTs` row or changes its ownership. The NFT event
 *   handlers call them with indexed events; nothing else does (I-21: client
 *   input never confirms anything).
 * - Ownership is by address. `currentOwner` caches the Quilltip user whose
 *   verified address owns the token at event time; read queries resolve the
 *   owner from `ownerAddress`.
 * - Order safety: `ownerEventId` keeps the newest applied event; an older
 *   event adds its history row but never moves ownership back.
 * - Submissions: rule (a) (`applyNftVerification`) and rule (b)
 *   (`resolveNftSubmissionsFromEvent`, `resolveNftSubmissionFromState`) move
 *   an NFT submission to a final state from chain evidence only.
 */
import { v, type Infer } from 'convex/values'
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import {
  NFT_CONFIRMED,
  NFT_MINTED_EVENT,
  NFT_TRANSFER_EVENT,
  matchNftEvent,
  mintNftKey,
  nftEventFacts,
  tokenNftKey,
  type NftEventFacts,
  type NftMintedFacts,
  type NftTransferFacts,
  type NftVerification,
} from './nftEvents'
import { verifiedStellarAddress } from '../walletVerification'

/** States from which chain evidence may resolve a submission. */
const RESOLVABLE: readonly string[] = ['PREPARED', 'SUBMITTED', 'EXPIRED']
/** Upper bound on rows read per lookup; NFT volume per token is small. */
const LOOKUP_LIMIT = 200

/** The event fields the store needs, from `chainEvents`. */
export type NftEventContext = {
  network: 'TESTNET' | 'MAINNET'
  chainEpoch: string
  contractId: string
  eventId: string
  txHash: string
  ledger: number
  /** Unix seconds. */
  ledgerCloseTime: number
  now: number
}

export class NftStoreConflict extends Error {}

/** The Quilltip user whose verified address is `address`, if any. */
export async function userForAddress(
  ctx: QueryCtx,
  address: string
): Promise<Id<'users'> | undefined> {
  const users = await ctx.db
    .query('users')
    .withIndex('by_stellar_address', (q) => q.eq('stellarAddress', address))
    .take(10)
  return users.find((u) => verifiedStellarAddress(u) === address)?._id
}

/** The v2 row of a token in one chain epoch and contract. */
export async function findV2Token(
  ctx: QueryCtx,
  args: { contractId: string; chainEpoch: string; tokenId: number }
): Promise<Doc<'articleNFTs'> | null> {
  const rows = await ctx.db
    .query('articleNFTs')
    .withIndex('by_token_id', (q) => q.eq('tokenId', String(args.tokenId)))
    .take(LOOKUP_LIMIT)
  return (
    rows.find(
      (r) =>
        r.contractVersion === 'v2' &&
        r.contractAddress === args.contractId &&
        r.chainEpoch === args.chainEpoch
    ) ?? null
  )
}

/** The v2 row of an article in one chain epoch and contract. */
export async function findV2ArticleNft(
  ctx: QueryCtx,
  args: {
    articleId: Id<'articles'>
    contractId: string | null
    chainEpoch: string
  }
): Promise<Doc<'articleNFTs'> | null> {
  const rows = await ctx.db
    .query('articleNFTs')
    .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
    .take(LOOKUP_LIMIT)
  return (
    rows.find(
      (r) =>
        r.contractVersion === 'v2' &&
        r.chainEpoch === args.chainEpoch &&
        (args.contractId === null || r.contractAddress === args.contractId)
    ) ?? null
  )
}

async function chainArticleFor(
  ctx: QueryCtx,
  articleKey: string,
  chainEpoch: string
): Promise<Doc<'chainArticles'> | null> {
  const rows = await ctx.db
    .query('chainArticles')
    .withIndex('by_article_key', (q) => q.eq('articleKey', articleKey))
    .take(20)
  return rows.find((r) => r.chainEpoch === chainEpoch) ?? null
}

/** The metadata URL the contract's `token_uri` uses: `<site>/api/nft/<id>`. */
export function nftMetadataUrl(
  tokenId: number,
  siteUrl: string | undefined = process.env.SITE_URL
): string {
  const base = (siteUrl?.trim() || 'https://www.quilltip.me').replace(
    /\/+$/,
    ''
  )
  return `${base}/api/nft/${tokenId}`
}

/** Inserts a v2 transfer row. `transactionId` is required for v2 rows. */
async function insertV2Transfer(
  ctx: MutationCtx,
  row: Omit<Doc<'nftTransfers'>, '_id' | '_creationTime'>
): Promise<Id<'nftTransfers'>> {
  if (row.contractVersion !== 'v2' || !row.transactionId || !row.chainEventId) {
    throw new NftStoreConflict(
      'A v2 transfer row needs contractVersion, transactionId and chainEventId.'
    )
  }
  return ctx.db.insert('nftTransfers', row)
}

/**
 * Applies a `transfer` event to an existing v2 row: one history row per
 * event, and the owner moves only when the event is newer than the event
 * that set the current owner.
 */
async function applyTransferToRow(
  ctx: MutationCtx,
  nft: Doc<'articleNFTs'>,
  ev: NftEventContext,
  facts: NftTransferFacts
): Promise<void> {
  const existing = await ctx.db
    .query('nftTransfers')
    .withIndex('by_chain_event', (q) => q.eq('chainEventId', ev.eventId))
    .take(20)
  const [fromUserId, toUserId] = await Promise.all([
    userForAddress(ctx, facts.from),
    userForAddress(ctx, facts.to),
  ])
  if (!existing.some((r) => r.nftId === nft._id)) {
    await insertV2Transfer(ctx, {
      nftId: nft._id,
      fromAddress: facts.from,
      toAddress: facts.to,
      ...(fromUserId ? { fromUserId } : {}),
      ...(toUserId ? { toUserId } : {}),
      transactionId: ev.txHash,
      contractVersion: 'v2',
      network: ev.network,
      chainEpoch: ev.chainEpoch,
      chainEventId: ev.eventId,
      ledger: ev.ledger,
      transferredAt: ev.ledgerCloseTime * 1000,
    })
  }
  if (!nft.ownerEventId || nft.ownerEventId < ev.eventId) {
    await ctx.db.patch(nft._id, {
      ownerAddress: facts.to,
      currentOwner: toUserId,
      ownerEventId: ev.eventId,
      chainVerifiedAt: ev.now,
      updatedAt: ev.now,
    })
  }
}

/**
 * `article_nft_minted`: creates the v2 row. An article that is not a
 * Quilltip article in this epoch is an orphan. Idempotent per token.
 */
export async function applyMintedEvent(
  ctx: MutationCtx,
  ev: NftEventContext,
  facts: NftMintedFacts
): Promise<'done' | 'orphan'> {
  let nft = await findV2Token(ctx, {
    contractId: ev.contractId,
    chainEpoch: ev.chainEpoch,
    tokenId: facts.tokenId,
  })
  if (nft) {
    if (nft.chainArticleKey !== facts.articleKey) {
      throw new NftStoreConflict(
        `token ${facts.tokenId} is recorded for another article`
      )
    }
  } else {
    const chainArticle = await chainArticleFor(
      ctx,
      facts.articleKey,
      ev.chainEpoch
    )
    if (!chainArticle) return 'orphan'
    const other = await findV2ArticleNft(ctx, {
      articleId: chainArticle.articleId,
      contractId: ev.contractId,
      chainEpoch: ev.chainEpoch,
    })
    if (other) {
      throw new NftStoreConflict(
        `article already has token ${other.tokenId}; got ${facts.tokenId}`
      )
    }
    const minter = await userForAddress(ctx, facts.author)
    const id = await ctx.db.insert('articleNFTs', {
      articleId: chainArticle.articleId,
      tokenId: String(facts.tokenId),
      contractAddress: ev.contractId,
      metadataUrl: nftMetadataUrl(facts.tokenId),
      ...(minter ? { mintedBy: minter, currentOwner: minter } : {}),
      ownerAddress: facts.author,
      contractVersion: 'v2',
      txHash: ev.txHash,
      chainVerifiedAt: ev.now,
      network: ev.network,
      chainEpoch: ev.chainEpoch,
      chainArticleKey: facts.articleKey,
      minterAddress: facts.author,
      totalAtMintBaseUnits: facts.totalAtMint,
      mintEventId: ev.eventId,
      mintLedger: ev.ledger,
      ownerEventId: ev.eventId,
      mintedAt: ev.ledgerCloseTime * 1000,
      updatedAt: ev.now,
    })
    const article = await ctx.db.get(chainArticle.articleId)
    if (article) {
      await ctx.db.patch(article._id, {
        hasNft: true,
        nftId: id,
        updatedAt: ev.now,
      })
    }
    nft = (await ctx.db.get(id))!
    // Transfers stored before the mint row existed wait as `pending`.
    await applyWaitingTransfers(ctx, nft, ev)
  }
  await resolveNftSubmissionsFromEvent(ctx, {
    nftKey: mintNftKey(ev.contractId, facts.articleKey),
    facts,
    ev,
  })
  return 'done'
}

/** Applies `transfer` events of this token that were stored before its row. */
async function applyWaitingTransfers(
  ctx: MutationCtx,
  nft: Doc<'articleNFTs'>,
  mint: NftEventContext
): Promise<void> {
  const waiting = await ctx.db
    .query('chainEvents')
    .withIndex('by_type_ledger', (q) =>
      q.eq('type', NFT_TRANSFER_EVENT).gte('ledger', mint.ledger)
    )
    .take(LOOKUP_LIMIT)
  const mine = waiting
    .filter(
      (e) =>
        e.handled === 'pending' &&
        e.chainEpoch === mint.chainEpoch &&
        e.contractId === mint.contractId &&
        (e.data as { token_id?: unknown } | null)?.token_id ===
          Number(nft.tokenId)
    )
    .sort((a, b) => (a.eventId < b.eventId ? -1 : 1))
  for (const e of mine) {
    const facts = nftEventFacts({
      name: e.type,
      topics: e.topics,
      data: e.data,
    })
    if (!facts || facts.name !== NFT_TRANSFER_EVENT) continue
    const row = (await ctx.db.get(nft._id))!
    const ev = { ...eventContext(e), now: mint.now }
    await applyTransferToRow(ctx, row, ev, facts)
    await resolveNftSubmissionsFromEvent(ctx, {
      nftKey: tokenNftKey(e.contractId, facts.tokenId),
      facts,
      ev,
    })
    await ctx.db.patch(e._id, { handled: 'done' })
  }
}

export function eventContext(
  doc: Doc<'chainEvents'>
): Omit<NftEventContext, 'now'> {
  return {
    network: doc.network,
    chainEpoch: doc.chainEpoch,
    contractId: doc.contractId,
    eventId: doc.eventId,
    txHash: doc.txHash,
    ledger: doc.ledger,
    ledgerCloseTime: doc.ledgerCloseTime,
  }
}

/**
 * Whether the mint of `tokenId` was indexed as an orphan (an article outside
 * Quilltip). Its transfers are orphans too.
 */
async function mintWasOrphan(
  ctx: QueryCtx,
  ev: NftEventContext,
  tokenId: number
): Promise<boolean> {
  const mints = await ctx.db
    .query('chainEvents')
    .withIndex('by_type_ledger', (q) =>
      q.eq('type', NFT_MINTED_EVENT).lte('ledger', ev.ledger)
    )
    .order('desc')
    .take(LOOKUP_LIMIT)
  const mint = mints.find(
    (e) =>
      e.chainEpoch === ev.chainEpoch &&
      e.contractId === ev.contractId &&
      (e.data as { token_id?: unknown } | null)?.token_id === tokenId
  )
  return mint?.handled === 'orphan'
}

/**
 * OpenZeppelin `transfer`: records the transfer and moves ownership when the
 * event is the newest. Before the mint row exists the event waits as
 * `pending`; the mint applies it. Addresses outside Quilltip are fine: the
 * row keeps the address and no user.
 */
export async function applyTransferEvent(
  ctx: MutationCtx,
  ev: NftEventContext,
  facts: NftTransferFacts
): Promise<'done' | 'orphan' | 'pending'> {
  const nft = await findV2Token(ctx, {
    contractId: ev.contractId,
    chainEpoch: ev.chainEpoch,
    tokenId: facts.tokenId,
  })
  if (!nft) {
    return (await mintWasOrphan(ctx, ev, facts.tokenId)) ? 'orphan' : 'pending'
  }
  await applyTransferToRow(ctx, nft, ev, facts)
  await resolveNftSubmissionsFromEvent(ctx, {
    nftKey: tokenNftKey(ev.contractId, facts.tokenId),
    facts,
    ev,
  })
  return 'done'
}

function expectedForMatch(
  e: NonNullable<Doc<'chainSubmissions'>['expectedNft']>
) {
  return e.action === 'mint'
    ? { action: 'mint' as const, articleKey: e.articleKey, signer: e.signer }
    : {
        action: 'transfer' as const,
        tokenId: e.tokenId,
        from: e.from,
        to: e.to,
      }
}

/**
 * Rule (b) with an event in hand: confirms the open submission this event
 * belongs to. The transaction's time bound proves which submission produced
 * it: an event that closed after a submission's `maxTime` is not its own.
 * A matching event after `FAILED`, or under another hash, is flagged.
 */
export async function resolveNftSubmissionsFromEvent(
  ctx: MutationCtx,
  args: { nftKey: string; facts: NftEventFacts; ev: NftEventContext }
): Promise<'linked' | 'conflict' | 'none'> {
  const { ev } = args
  const candidates = await ctx.db
    .query('chainSubmissions')
    .withIndex('by_nft_key', (q) => q.eq('nftKey', args.nftKey))
    .take(LOOKUP_LIMIT)
  let result: 'linked' | 'conflict' | 'none' = 'none'
  for (const submission of candidates) {
    if (
      submission.kind !== 'nft' ||
      !submission.expectedNft ||
      submission.contractId !== ev.contractId ||
      submission.chainEpoch !== ev.chainEpoch
    ) {
      continue
    }
    const outcome = matchNftEvent(
      expectedForMatch(submission.expectedNft),
      args.facts
    )
    if (outcome.status !== 'CONFIRMED') continue
    if (ev.ledgerCloseTime > submission.maxTime) continue
    if (
      submission.createdLedger !== undefined &&
      ev.ledger < submission.createdLedger
    ) {
      continue
    }
    if (
      submission.status === 'FAILED' ||
      (submission.txHash && submission.txHash !== ev.txHash)
    ) {
      if (!submission.needsReview) {
        await ctx.db.patch(submission._id, {
          needsReview: true,
          lastError:
            submission.status === 'FAILED'
              ? 'event_after_failure'
              : 'event_hash_differs',
          updatedAt: ev.now,
        })
      }
      result = 'conflict'
      continue
    }
    if (!RESOLVABLE.includes(submission.status)) continue
    await ctx.db.patch(submission._id, {
      status: NFT_CONFIRMED,
      needsReview: false,
      txHash: submission.txHash ?? ev.txHash,
      ledger: ev.ledger,
      updatedAt: ev.now,
    })
    result = 'linked'
  }
  return result
}

/**
 * Rule (b) without an event in hand, for the recheck cron: the indexer has
 * already recorded the mint or transfer the submission expects.
 */
export async function resolveNftSubmissionFromState(
  ctx: MutationCtx,
  submission: Doc<'chainSubmissions'>,
  now: number
): Promise<boolean> {
  const expected = submission.expectedNft
  if (
    submission.kind !== 'nft' ||
    !expected ||
    !RESOLVABLE.includes(submission.status)
  ) {
    return false
  }
  const fresh = (ledger: number | undefined, txHash: string | undefined) =>
    ledger !== undefined &&
    (submission.createdLedger === undefined ||
      ledger >= submission.createdLedger) &&
    (!submission.txHash || submission.txHash === txHash)

  let txHash: string | undefined
  let ledger: number | undefined
  if (expected.action === 'mint') {
    const nft = await findV2ArticleNft(ctx, {
      articleId: expected.articleId,
      contractId: submission.contractId,
      chainEpoch: submission.chainEpoch,
    })
    if (
      !nft ||
      nft.chainArticleKey !== expected.articleKey ||
      nft.minterAddress !== expected.signer ||
      nft.mintedAt / 1000 > submission.maxTime ||
      !fresh(nft.mintLedger, nft.txHash)
    ) {
      return false
    }
    txHash = nft.txHash
    ledger = nft.mintLedger
  } else {
    const rows = await ctx.db
      .query('nftTransfers')
      .withIndex('by_nft', (q) => q.eq('nftId', expected.nftId))
      .take(LOOKUP_LIMIT)
    const row = rows.find(
      (r) =>
        r.contractVersion === 'v2' &&
        r.fromAddress === expected.from &&
        r.toAddress === expected.to &&
        r.transferredAt / 1000 <= submission.maxTime &&
        fresh(r.ledger, r.transactionId)
    )
    if (!row) return false
    txHash = row.transactionId
    ledger = row.ledger
  }
  await ctx.db.patch(submission._id, {
    status: NFT_CONFIRMED,
    needsReview: false,
    ...(submission.txHash || !txHash ? {} : { txHash }),
    ...(ledger === undefined ? {} : { ledger }),
    updatedAt: now,
  })
  return true
}

const factsValidator = v.union(
  v.object({
    name: v.literal(NFT_MINTED_EVENT),
    articleKey: v.string(),
    author: v.string(),
    tokenId: v.number(),
    totalAtMint: v.string(),
  }),
  v.object({
    name: v.literal(NFT_TRANSFER_EVENT),
    from: v.string(),
    to: v.string(),
    tokenId: v.number(),
  })
)

export const nftVerificationValidator = v.object({
  status: v.union(v.literal('CONFIRMED'), v.literal('MISMATCH')),
  mismatchReason: v.optional(v.string()),
  needsReview: v.boolean(),
  facts: v.union(factsValidator, v.null()),
})

export type StoredNftVerification = Infer<typeof nftVerificationValidator>

export function storeNftVerification(
  outcome: NftVerification
): StoredNftVerification {
  return {
    status: outcome.status,
    ...(outcome.status === 'MISMATCH'
      ? { mismatchReason: outcome.mismatchReason }
      : {}),
    needsReview: outcome.needsReview,
    facts: outcome.facts,
  }
}

/**
 * Rule (a) for an NFT submission: RPC returned `SUCCESS` for its hash.
 * Changes the submission only; the row and its owner follow from the
 * indexed event. Idempotent; a final submission is left unchanged.
 */
export async function applyNftVerification(
  ctx: MutationCtx,
  args: {
    submissionId: Id<'chainSubmissions'>
    txHash: string
    ledger: number
    outcome: StoredNftVerification
    now: number
  }
): Promise<'applied' | 'skipped'> {
  const submission = await ctx.db.get(args.submissionId)
  if (!submission || submission.kind !== 'nft') return 'skipped'
  if (submission.txHash !== args.txHash) return 'skipped'
  if (!RESOLVABLE.includes(submission.status)) return 'skipped'
  await ctx.db.patch(submission._id, {
    status: args.outcome.status,
    mismatchReason: args.outcome.mismatchReason,
    needsReview: args.outcome.needsReview,
    ledger: args.ledger,
    updatedAt: args.now,
  })
  return 'applied'
}
