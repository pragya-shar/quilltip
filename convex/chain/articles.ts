/**
 * Article registration on Core, content anchoring and the two-step author
 * change (docs/architecture/v2/05-flows-and-admin.md, section 5.1;
 * 06-app-integration.md, section 6.3).
 *
 * Each prepare mutation:
 * 1. Requires `CHAIN_V2_ENABLED` (the network guard runs first), a signed-in
 *    author who owns the published article, and a verified wallet address.
 * 2. Fixes the values the transaction must produce, on a `chainSubmissions`
 *    row (`expectedArticle`), linked to the article's `chainArticles` row.
 * 3. Is idempotent per client `requestId`.
 *
 * The client builds, simulates and signs the call; `chain.submissions`
 * records and verifies it, and the indexer's event confirms it (rule (b)).
 * Nothing here signs or sends a transaction.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from '../_generated/server'
import { readChainEnv, requireChainV2Enabled } from '../lib/chain/env'
import {
  ARTICLE_SCHEMA,
  articleContentHashHex,
  articleIdHex,
  articleRefHex,
  bytesToHex,
} from '../lib/chain/ids'
import { MAX_TIME_WINDOW_SECONDS } from '../lib/chain/submissionStore'
import { splitProblems, type Split } from '../lib/chain/splits'
import type { ArticleSubmissionKind } from '../lib/chain/articleEvents'
import {
  verifiedStellarAddress,
  walletLinkState,
} from '../lib/walletVerification'

/** Ledgers per day at a 5-second close time (01-architecture.md, 1.5). */
export const LEDGERS_PER_DAY = 17_280
/** How long a proposed author may accept: 7 days (Core allows up to 30). */
export const AUTHOR_PROPOSAL_LEDGERS = 7 * LEDGERS_PER_DAY

const REQUEST_ID = /^[A-Za-z0-9_-]{1,100}$/
const OPEN_SUBMISSION: readonly string[] = ['PREPARED', 'SUBMITTED']

function fail(code: string, message: string, extra?: object): never {
  throw new ConvexError({ code, message, ...extra })
}

/** A 43-character base64url Arweave transaction ID as 32 bytes of hex. */
export function arweaveIdHex(txId: string | undefined | null): string | null {
  if (!txId || !/^[A-Za-z0-9_-]{43}$/.test(txId)) return null
  const base64 = txId.replace(/-/g, '+').replace(/_/g, '/') + '='
  let binary: string
  try {
    binary = atob(base64)
  } catch {
    return null
  }
  if (binary.length !== 32) return null
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = binary.charCodeAt(i)
  return bytesToHex(bytes)
}

type Anchor = {
  contentHash: string
  /** Set only when the Arweave body reproduces `contentHash`. */
  arweaveId: string | null
  /** True for an article published before canonical content hashes. */
  legacy: boolean
}

/**
 * The article's current content anchor. A row published with canonical
 * bytes uses its stored hash. A legacy row (no `contentHashSchema`) gets the
 * canonical hash computed now at version 1 and no Arweave ID, because its
 * Arweave body is an older format that does not reproduce the hash.
 */
export async function currentAnchor(article: Doc<'articles'>): Promise<Anchor> {
  if (article.contentHashSchema === ARTICLE_SCHEMA && article.contentHash) {
    const uploaded =
      article.arweaveStatus === 'uploaded' ||
      article.arweaveStatus === 'verified'
    return {
      contentHash: article.contentHash,
      arweaveId:
        uploaded && article.arweaveContentHash === article.contentHash
          ? arweaveIdHex(article.arweaveTxId)
          : null,
      legacy: false,
    }
  }
  try {
    return {
      contentHash: await articleContentHashHex({
        articleId: article._id,
        authorId: article.authorId,
        title: article.title,
        content: article.content,
        contentVersion: article.contentVersion ?? 1,
      }),
      arweaveId: null,
      legacy: true,
    }
  } catch {
    fail(
      'CONTENT_UNANCHORED',
      'This article contains characters that cannot be anchored.'
    )
  }
}

async function chainArticleFor(
  ctx: QueryCtx,
  articleId: Id<'articles'>,
  chainEpoch: string
): Promise<Doc<'chainArticles'> | null> {
  const rows = await ctx.db
    .query('chainArticles')
    .withIndex('by_article', (q) => q.eq('articleId', articleId))
    .take(20)
  return rows.find((row) => row.chainEpoch === chainEpoch) ?? null
}

type Context = {
  userId: Id<'users'>
  user: Doc<'users'>
  article: Doc<'articles'>
  chain: ReturnType<typeof requireChainV2Enabled> & { coreContractId: string }
  verifiedAddress: string
}

/** Auth, ownership, the v2 gate and a verified wallet address. */
async function authorContext(
  ctx: MutationCtx,
  articleId: Id<'articles'>
): Promise<Context> {
  const chain = requireChainV2Enabled()
  if (!chain.coreContractId) {
    fail('CHAIN_CONFIG_MISSING', 'CORE_CONTRACT_ID must be set.')
  }
  const userId = await getAuthUserId(ctx)
  if (!userId) fail('UNAUTHENTICATED', 'Sign in first.')
  const user = await ctx.db.get(userId)
  if (!user) fail('UNAUTHENTICATED', 'Sign in first.')
  const article = await ctx.db.get(articleId)
  if (!article) fail('NOT_FOUND', 'Article not found.')
  if (article.authorId !== userId) {
    fail('NOT_AUTHOR', 'Only the author can change this article on Stellar.')
  }
  if (!article.published) {
    fail('NOT_PUBLISHED', 'Publish the article first.')
  }
  const state = walletLinkState(user, chain.passphrase)
  if (state === 'none') fail('NO_WALLET', 'Connect a receiving wallet first.')
  const verifiedAddress = verifiedStellarAddress(user, chain.passphrase)
  if (state !== 'verified' || !verifiedAddress) {
    fail('WALLET_NOT_VERIFIED', 'Verify your receiving wallet first.')
  }
  return {
    userId,
    user,
    article,
    chain: chain as Context['chain'],
    verifiedAddress,
  }
}

type PreparedArticleCall = {
  submissionId: Id<'chainSubmissions'>
  kind: ArticleSubmissionKind
  contractId: string
  networkPassphrase: string
  maxTime: number
  /** The address that must sign; it is also the transaction source. */
  signer: string
  articleKey: string
  articleRef: string | null
  author: string | null
  contentHash: string | null
  arweaveId: string | null
  splits: Split[]
  newAuthor: string | null
  liveUntilLedger: number | null
  /** True when an earlier call with the same `requestId` created it. */
  existing: boolean
}

function toPrepared(
  submission: Doc<'chainSubmissions'>,
  passphrase: string,
  existing: boolean
): PreparedArticleCall {
  const e = submission.expectedArticle!
  return {
    submissionId: submission._id,
    kind: submission.kind as ArticleSubmissionKind,
    contractId: submission.contractId,
    networkPassphrase: passphrase,
    maxTime: submission.maxTime,
    signer: e.signer,
    articleKey: e.articleKey,
    articleRef: e.articleRef ?? null,
    author: e.author ?? null,
    contentHash: e.contentHash ?? null,
    arweaveId: e.arweaveId ?? null,
    splits: e.splits ?? [],
    newAuthor: e.newAuthor ?? null,
    liveUntilLedger: e.liveUntilLedger ?? null,
    existing,
  }
}

/** Returns the earlier submission for `requestId`, after checking its owner. */
async function existingRequest(
  ctx: MutationCtx,
  c: Context,
  requestId: string,
  kind: ArticleSubmissionKind
): Promise<Doc<'chainSubmissions'> | null> {
  if (!REQUEST_ID.test(requestId)) {
    fail(
      'INVALID_PREPARE',
      'requestId must be 1 to 100 letters, digits, "-" or "_".'
    )
  }
  const existing = await ctx.db
    .query('chainSubmissions')
    .withIndex('by_request', (q) => q.eq('requestId', requestId))
    .first()
  if (!existing) return null
  if (
    existing.userId !== c.userId ||
    existing.kind !== kind ||
    !existing.expectedArticle
  ) {
    fail('INVALID_PREPARE', 'requestId belongs to another request.')
  }
  return existing
}

/**
 * Refuses while the article's latest submission can still land: it was sent,
 * or it was prepared and its time bound has not passed.
 */
async function assertNoOpenSubmission(
  ctx: MutationCtx,
  article: Doc<'chainArticles'> | null,
  now: number
): Promise<void> {
  if (!article?.lastSubmissionId) return
  const last = await ctx.db.get(article.lastSubmissionId)
  if (!last || !OPEN_SUBMISSION.includes(last.status)) return
  if (last.status === 'PREPARED' && Math.floor(now / 1000) > last.maxTime) {
    return
  }
  fail(
    'PENDING',
    'A transaction for this article is still in progress. Wait for it to finish.',
    { submissionId: last._id }
  )
}

async function latestKnownLedger(
  ctx: MutationCtx
): Promise<number | undefined> {
  const cursor = await ctx.db
    .query('chainCursor')
    .withIndex('by_network', (q) => q.eq('network', 'TESTNET'))
    .first()
  return cursor?.latestLedger
}

async function insertArticleSubmission(
  ctx: MutationCtx,
  c: Context,
  args: {
    kind: ArticleSubmissionKind
    requestId: string
    chainArticleId: Id<'chainArticles'>
    expected: NonNullable<Doc<'chainSubmissions'>['expectedArticle']>
    now: number
  }
): Promise<Doc<'chainSubmissions'>> {
  const createdLedger = await latestKnownLedger(ctx)
  const id = await ctx.db.insert('chainSubmissions', {
    network: c.chain.network,
    chainEpoch: c.chain.chainEpoch,
    kind: args.kind,
    userId: c.userId,
    contractId: c.chain.coreContractId,
    requestId: args.requestId,
    // Article calls carry no client_ref; the article ID identifies them.
    clientRefs: [],
    maxTime: Math.floor(args.now / 1000) + MAX_TIME_WINDOW_SECONDS,
    ...(createdLedger === undefined ? {} : { createdLedger }),
    status: 'PREPARED',
    attempts: 0,
    related: [{ table: 'chainArticles', id: args.chainArticleId }],
    expectedArticle: args.expected,
    createdAt: args.now,
    updatedAt: args.now,
  })
  await ctx.db.patch(args.chainArticleId, {
    lastSubmissionId: id,
    updatedAt: args.now,
  })
  return (await ctx.db.get(id))!
}

const splitArg = v.object({ recipient: v.string(), bps: v.number() })

/**
 * "Enable tips": prepares `Core.register_article` for the author's verified
 * address. `article_id` is derived from that address and `article_ref`; if
 * the address changes before registration succeeds, the next prepare uses
 * the new address and a new `article_id`.
 */
export const prepareRegistration = mutation({
  args: {
    articleId: v.id('articles'),
    requestId: v.string(),
    splits: v.optional(v.array(splitArg)),
  },
  handler: async (ctx, args): Promise<PreparedArticleCall> => {
    const c = await authorContext(ctx, args.articleId)
    const prior = await existingRequest(ctx, c, args.requestId, 'register')
    if (prior) return toPrepared(prior, c.chain.passphrase, true)

    const now = Date.now()
    const row = await chainArticleFor(ctx, c.article._id, c.chain.chainEpoch)
    if (row?.status === 'REGISTERED') {
      fail('ALREADY_REGISTERED', 'Tips are already enabled for this article.')
    }
    await assertNoOpenSubmission(ctx, row, now)

    const author = c.verifiedAddress
    const splits = args.splits ?? []
    const problems = splitProblems(splits, { author })
    if (problems.length > 0) {
      fail('INVALID_SPLITS', problems[0]!.message, { problems })
    }
    const anchor = await currentAnchor(c.article)
    const articleRef = await articleRefHex(c.article._id)
    const articleKey = await articleIdHex(author, articleRef)

    const fields = {
      network: c.chain.network,
      chainEpoch: c.chain.chainEpoch,
      articleKey,
      articleRef,
      authorAddress: author,
      contentHash: anchor.contentHash,
      ...(anchor.arweaveId ? { arweaveId: anchor.arweaveId } : {}),
      contentVersion: 1,
      splits,
      status: 'PREPARED' as const,
      updatedAt: now,
    }
    let chainArticleId: Id<'chainArticles'>
    if (row) {
      await ctx.db.patch(row._id, {
        ...fields,
        arweaveId: anchor.arweaveId ?? undefined,
        pendingAuthor: undefined,
        pendingAuthorLiveUntil: undefined,
        txHash: undefined,
      })
      chainArticleId = row._id
    } else {
      chainArticleId = await ctx.db.insert('chainArticles', {
        ...fields,
        articleId: c.article._id,
        totals: {},
      })
    }

    const submission = await insertArticleSubmission(ctx, c, {
      kind: 'register',
      requestId: args.requestId,
      chainArticleId,
      expected: {
        articleKey,
        signer: author,
        author,
        articleRef,
        contentHash: anchor.contentHash,
        arweaveId: anchor.arweaveId,
        splits,
      },
      now,
    })
    return toPrepared(submission, c.chain.passphrase, false)
  },
})

async function registeredRow(
  ctx: MutationCtx,
  c: Context
): Promise<Doc<'chainArticles'>> {
  const row = await chainArticleFor(ctx, c.article._id, c.chain.chainEpoch)
  if (!row || row.status !== 'REGISTERED') {
    fail('NOT_REGISTERED', 'Enable tips for this article first.')
  }
  return row
}

/**
 * Re-anchors a registered article: `Core.update_content` with the article's
 * current content hash and, when its upload matches, the Arweave ID. Signed
 * by the registered author.
 */
export const prepareContentUpdate = mutation({
  args: { articleId: v.id('articles'), requestId: v.string() },
  handler: async (ctx, args): Promise<PreparedArticleCall> => {
    const c = await authorContext(ctx, args.articleId)
    const prior = await existingRequest(
      ctx,
      c,
      args.requestId,
      'content_update'
    )
    if (prior) return toPrepared(prior, c.chain.passphrase, true)

    const now = Date.now()
    const row = await registeredRow(ctx, c)
    await assertNoOpenSubmission(ctx, row, now)
    if (row.authorAddress !== c.verifiedAddress) {
      fail(
        'WRONG_SIGNER',
        'This article is registered to another wallet. Move it to your current wallet first.'
      )
    }
    const anchor = await currentAnchor(c.article)
    const arweaveId = anchor.arweaveId ?? row.arweaveId ?? null
    if (
      anchor.contentHash === row.contentHash &&
      arweaveId === (row.arweaveId ?? null)
    ) {
      fail('NOTHING_TO_UPDATE', 'The anchor on Stellar is already current.')
    }
    // Keep a recorded Arweave ID only while it still matches the content.
    const nextArweaveId =
      anchor.contentHash === row.contentHash ? arweaveId : anchor.arweaveId
    const submission = await insertArticleSubmission(ctx, c, {
      kind: 'content_update',
      requestId: args.requestId,
      chainArticleId: row._id,
      expected: {
        articleKey: row.articleKey,
        signer: row.authorAddress,
        contentHash: anchor.contentHash,
        arweaveId: nextArweaveId,
        contentVersion: row.contentVersion + 1,
      },
      now,
    })
    return toPrepared(submission, c.chain.passphrase, false)
  },
})

/**
 * Step 1 of moving an article to the author's new verified wallet:
 * `Core.propose_author`, signed by the address registered on chain.
 * `currentLedger` comes from the client's RPC; Core rejects an expiry that
 * is not ahead of the current ledger or more than 30 days ahead.
 */
export const prepareAuthorProposal = mutation({
  args: {
    articleId: v.id('articles'),
    requestId: v.string(),
    currentLedger: v.number(),
  },
  handler: async (ctx, args): Promise<PreparedArticleCall> => {
    const c = await authorContext(ctx, args.articleId)
    const prior = await existingRequest(
      ctx,
      c,
      args.requestId,
      'author_propose'
    )
    if (prior) return toPrepared(prior, c.chain.passphrase, true)

    const now = Date.now()
    const row = await registeredRow(ctx, c)
    await assertNoOpenSubmission(ctx, row, now)
    const newAuthor = c.verifiedAddress
    if (row.authorAddress === newAuthor) {
      fail('SAME_AUTHOR', 'This article already pays your current wallet.')
    }
    if (row.splits.some((s) => s.recipient === newAuthor)) {
      fail(
        'SAME_AUTHOR',
        'Your current wallet is a co-author of this article. Use another wallet.'
      )
    }
    if (row.pendingAuthor === newAuthor) {
      fail(
        'ALREADY_PROPOSED',
        'The move is ready. Accept it with your new wallet.'
      )
    }
    if (!Number.isInteger(args.currentLedger) || args.currentLedger < 1) {
      fail('INVALID_PREPARE', 'currentLedger must be a positive integer.')
    }
    const known = await latestKnownLedger(ctx)
    const base = Math.max(args.currentLedger, known ?? 0)
    const submission = await insertArticleSubmission(ctx, c, {
      kind: 'author_propose',
      requestId: args.requestId,
      chainArticleId: row._id,
      expected: {
        articleKey: row.articleKey,
        signer: row.authorAddress,
        newAuthor,
        liveUntilLedger: base + AUTHOR_PROPOSAL_LEDGERS,
      },
      now,
    })
    return toPrepared(submission, c.chain.passphrase, false)
  },
})

/**
 * Step 2: `Core.accept_author`, signed by the proposed (new) address, which
 * must be the author's verified address.
 */
export const prepareAuthorAccept = mutation({
  args: { articleId: v.id('articles'), requestId: v.string() },
  handler: async (ctx, args): Promise<PreparedArticleCall> => {
    const c = await authorContext(ctx, args.articleId)
    const prior = await existingRequest(ctx, c, args.requestId, 'author_accept')
    if (prior) return toPrepared(prior, c.chain.passphrase, true)

    const now = Date.now()
    const row = await registeredRow(ctx, c)
    await assertNoOpenSubmission(ctx, row, now)
    if (!row.pendingAuthor || row.pendingAuthor !== c.verifiedAddress) {
      fail(
        'NO_PENDING_AUTHOR',
        'No move to your current wallet is waiting. Start the move first.'
      )
    }
    const submission = await insertArticleSubmission(ctx, c, {
      kind: 'author_accept',
      requestId: args.requestId,
      chainArticleId: row._id,
      expected: {
        articleKey: row.articleKey,
        signer: c.verifiedAddress,
        author: row.authorAddress,
        newAuthor: c.verifiedAddress,
      },
      now,
    })
    return toPrepared(submission, c.chain.passphrase, false)
  },
})

/** What the author sees for one article. Null for anyone else. */
export const getRegistration = query({
  args: { articleId: v.id('articles') },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const article = await ctx.db.get(args.articleId)
    if (!article || article.authorId !== userId) return null
    const user = await ctx.db.get(userId)
    const chain = readChainEnv()
    const walletState = walletLinkState(user, chain.passphrase)
    const verifiedAddress = verifiedStellarAddress(user, chain.passphrase)
    const row = await chainArticleFor(ctx, article._id, chain.chainEpoch)
    const submission = row?.lastSubmissionId
      ? await ctx.db.get(row.lastSubmissionId)
      : null
    const canonical =
      article.contentHashSchema === ARTICLE_SCHEMA && !!article.contentHash
    const uploaded =
      article.arweaveStatus === 'uploaded' ||
      article.arweaveStatus === 'verified'
    const arweaveId =
      canonical &&
      uploaded &&
      article.arweaveContentHash === article.contentHash
        ? arweaveIdHex(article.arweaveTxId)
        : null
    const registered = row?.status === 'REGISTERED'
    return {
      v2Enabled: chain.v2Enabled && !!chain.coreContractId,
      network: chain.network,
      published: article.published,
      wallet: { state: walletState, address: verifiedAddress },
      legacyAnchor: !canonical,
      registration: row
        ? {
            status: row.status,
            articleKey: row.articleKey,
            authorAddress: row.authorAddress,
            pendingAuthor: row.pendingAuthor ?? null,
            pendingAuthorLiveUntil: row.pendingAuthorLiveUntil ?? null,
            contentHash: row.contentHash,
            contentVersion: row.contentVersion,
            arweaveId: row.arweaveId ?? null,
            splits: row.splits,
            registeredLedger: row.registeredLedger ?? null,
            txHash: row.txHash ?? null,
          }
        : null,
      submission: submission
        ? {
            id: submission._id,
            kind: submission.kind,
            status: submission.status,
            txHash: submission.txHash ?? null,
            maxTime: submission.maxTime,
            needsReview: submission.needsReview === true,
            mismatchReason: submission.mismatchReason ?? null,
            lastError: submission.lastError ?? null,
            canRetry:
              (submission.status === 'FAILED' ||
                submission.status === 'EXPIRED') &&
              submission.needsReview !== true,
          }
        : null,
      // A canonical article whose anchor differs from Core's record.
      contentOutdated:
        registered &&
        canonical &&
        (row!.contentHash !== article.contentHash ||
          (!!arweaveId && row!.arweaveId !== arweaveId)),
      // Tips pay the on-chain author; the app's wallet changed since.
      payoutOutdated:
        registered &&
        !!verifiedAddress &&
        row!.authorAddress !== verifiedAddress,
      canAccept:
        registered &&
        !!verifiedAddress &&
        row!.pendingAuthor === verifiedAddress,
    }
  },
})

/**
 * Whether readers can tip an article through v2 (public). An article is
 * tippable only once Core registration is confirmed and the on-chain author
 * is still the author's verified address (07-security-and-recovery.md).
 * With v2 off, or with v2 on and no `CORE_CONTRACT_ID`, the result is
 * `paused`: no flow can take the tip, so the article shows the paused note
 * rather than a tip button.
 */
export const getArticleTipAvailability = query({
  args: { articleId: v.id('articles') },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    if (!chain.v2Enabled || !chain.coreContractId) {
      return { status: 'paused' as const }
    }
    const article = await ctx.db.get(args.articleId)
    if (!article?.published) return { status: 'unregistered' as const }
    const row = await chainArticleFor(ctx, article._id, chain.chainEpoch)
    if (!row || row.status === 'FAILED') {
      return { status: 'unregistered' as const }
    }
    if (row.status !== 'REGISTERED') return { status: 'pending' as const }
    const author = await ctx.db.get(article.authorId)
    if (
      verifiedStellarAddress(author, chain.passphrase) !== row.authorAddress
    ) {
      return { status: 'payout_outdated' as const }
    }
    return {
      status: 'registered' as const,
      articleKey: row.articleKey,
      authorAddress: row.authorAddress,
      splits: row.splits,
      contractId: chain.coreContractId,
    }
  },
})
