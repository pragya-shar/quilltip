/**
 * Article registration, content update and author change on a local
 * standalone network (docs/architecture/v2/05-flows-and-admin.md, section 5.1).
 *
 * What runs for real:
 * - Prepared values from the Convex encoders (`articleRefHex`, `articleIdHex`,
 *   `articleContentHashHex`), in the shape `chain.articles.prepare*` returns.
 * - The client path: `runArticleAction` checks them, encodes the call with the
 *   generated Core bindings' spec, builds with time bounds, simulates through
 *   RPC, signs and sends.
 * - The server verifier (`verifyArticleTransaction`) on the real
 *   `getTransaction` events, through the Convex RPC client.
 * - The indexer decoding (`decodeRpcEvent`, `toStoredValue`,
 *   `articleEventFacts`, `matchArticleEvent`) on the real `getEvents` page.
 *
 * Not run here: the Convex mutations themselves. The backend network guard
 * accepts TESTNET only (`assertBackendTestnet`), so Convex functions cannot
 * target a LOCAL network; scripts/chain/article-registration.test.ts covers
 * them with convex-test.
 *
 *   QUILLTIP_WASM_DIR=<dir with quilltip_core.wasm> bunx vitest run \
 *     --config scripts/integration/vitest.config.mts scripts/integration/article-registration.test.ts
 */
import { join } from 'path'

import {
  Keypair,
  Networks,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk'
import { beforeAll, describe, expect, it } from 'vitest'

import { Client as CoreClient } from '../../lib/stellar/v2/bindings/core'
import {
  runArticleAction,
  type ArticleActionDeps,
} from '../../lib/stellar/v2/article-actions'
import type { PreparedArticleCall } from '../../lib/stellar/v2/article-calls'
import {
  articleContentHashHex,
  articleIdHex,
  articleRefHex,
  bytesToHex,
} from '../../convex/lib/chain/ids'
import {
  articleEventFacts,
  matchArticleEvent,
  verifyArticleTransaction,
  type ArticleSubmissionKind,
  type ExpectedArticle,
} from '../../convex/lib/chain/articleEvents'
import { decodeRpcEvent } from '../../convex/lib/chain/events'
import { toStoredValue } from '../../convex/lib/chain/indexerStore'
import { createRpcClient, type RpcFetch } from '../../convex/lib/chain/rpc'
import { Harness, LOCAL_PASSPHRASE } from './harness'

const wasmDir = process.env.QUILLTIP_WASM_DIR ?? ''
const h = new Harness()
const backendRpc = createRpcClient({
  url: h.net.rpcUrl,
  fetch: fetch as unknown as RpcFetch,
})
const CONVEX_ARTICLE_ID = `k17local${Date.now().toString(36)}`
const DAY = 17_280

let admin: Keypair, treasury: Keypair, author: Keypair
let newWallet: Keypair, coauthor: Keypair
let coreId: string
let articleKey: string
let articleRef: string

function sign(kp: Keypair) {
  return async (xdr: string) => {
    const tx = TransactionBuilder.fromXDR(xdr, LOCAL_PASSPHRASE) as Transaction
    tx.sign(kp)
    return tx.toXDR()
  }
}

type Run = {
  prepared: PreparedArticleCall & { submissionId: string; existing: boolean }
  submitted: string[]
  failed: string[]
}

/** Runs one action through the client path, as the panel does. */
async function act(
  prepared: Omit<
    PreparedArticleCall,
    'contractId' | 'networkPassphrase' | 'maxTime'
  >,
  signer: Keypair,
  connectedAs: string = signer.publicKey()
): Promise<Run & { result: Awaited<ReturnType<typeof runArticleAction>> }> {
  const full = {
    ...prepared,
    contractId: coreId,
    networkPassphrase: LOCAL_PASSPHRASE,
    maxTime: Math.floor(Date.now() / 1000) + 300,
    submissionId: 'local',
    existing: false,
  }
  const run: Run = { prepared: full, submitted: [], failed: [] }
  const deps: ArticleActionDeps = {
    convexArticleId: CONVEX_ARTICLE_ID,
    config: { passphrase: LOCAL_PASSPHRASE, coreContractId: coreId },
    server: h.server,
    prepare: async () => full,
    connect: async () => connectedAs,
    sign: sign(signer),
    recordSubmitted: async (_id, hash) => {
      run.submitted.push(hash)
    },
    recordFailed: async (_id, reason, detail) => {
      run.failed.push(`${reason}:${detail ?? ''}`)
    },
  }
  return { ...run, result: await runArticleAction(deps) }
}

/** Waits for RPC to report the transaction, as the verifier action does. */
async function waitForTransaction(hash: string) {
  for (let i = 0; i < 60; i++) {
    const tx = await backendRpc.getTransaction(hash)
    if (tx.status !== 'NOT_FOUND') return tx
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error(`transaction ${hash} not found`)
}

/** Rule (a), as `checkSubmission` runs it for an article submission. */
async function verify(
  kind: ArticleSubmissionKind,
  expected: ExpectedArticle,
  hash: string
) {
  const tx = await waitForTransaction(hash)
  expect(tx.status).toBe('SUCCESS')
  return {
    ledger: tx.ledger!,
    outcome: verifyArticleTransaction({
      kind,
      expected,
      coreContractId: coreId,
      contractEventsXdr: tx.contractEventsXdr,
      ledger: tx.ledger!,
    }),
  }
}

/** Rule (b), as the indexer stores and dispatches an event. */
async function indexed(ledger: number, name: string) {
  const page = await backendRpc.getEvents({
    startLedger: ledger,
    filters: [{ type: 'contract', contractIds: [coreId] }],
    pagination: { limit: 100 },
  })
  const raw = page.events.find(
    (e) => e.ledger === ledger && decodeRpcEvent(e).name === name
  )
  expect(raw, `${name} at ledger ${ledger}`).toBeDefined()
  const decoded = decodeRpcEvent(raw!)
  return articleEventFacts({
    name: decoded.name,
    topics: toStoredValue(decoded.topics) as unknown[],
    data: toStoredValue(decoded.data),
  })!
}

const core = (kp: Keypair) => new CoreClient(h.opts(coreId, kp))

beforeAll(async () => {
  expect(wasmDir, 'QUILLTIP_WASM_DIR').not.toBe('')
  await h.assertLocalNetwork()
  ;[admin, treasury, author, newWallet, coauthor] = (await h.accounts(5)) as [
    Keypair,
    Keypair,
    Keypair,
    Keypair,
    Keypair,
  ]
  const token = h.ensureNativeSac(admin)
  const hash = h.uploadWasm(join(wasmDir, 'quilltip_core.wasm'), admin)
  coreId = h.deploy(hash, admin, {
    admin: admin.publicKey(),
    pauser: admin.publicKey(),
    upgrader: admin.publicKey(),
    treasury: treasury.publicKey(),
    token,
    min_tip: '1000000',
  })
  articleRef = await articleRefHex(CONVEX_ARTICLE_ID)
  articleKey = await articleIdHex(author.publicKey(), articleRef)
}, 600_000)

describe('article registration on a local network', () => {
  it('registers with co-author shares; RPC and indexed event both confirm', async () => {
    const contentHash = await articleContentHashHex({
      articleId: CONVEX_ARTICLE_ID,
      authorId: 'local-author',
      title: 'Words on a local network',
      content: { type: 'doc', content: [{ type: 'text', text: 'Hello' }] },
      contentVersion: 1,
    })
    const splits = [
      { recipient: author.publicKey(), bps: 7_000 },
      { recipient: coauthor.publicKey(), bps: 3_000 },
    ]
    const run = await act(
      {
        kind: 'register',
        signer: author.publicKey(),
        articleKey,
        articleRef,
        author: author.publicKey(),
        contentHash,
        arweaveId: null,
        splits,
        newAuthor: null,
        liveUntilLedger: null,
      },
      author
    )
    expect(run.result).toMatchObject({ status: 'submitted' })
    expect(run.submitted).toHaveLength(1)
    expect(run.failed).toEqual([])

    const expected: ExpectedArticle = {
      articleKey,
      signer: author.publicKey(),
      author: author.publicKey(),
      articleRef,
      contentHash,
      arweaveId: null,
      splits,
    }
    const { ledger, outcome } = await verify(
      'register',
      expected,
      run.submitted[0]!
    )
    expect(outcome.status).toBe('CONFIRMED')

    const facts = await indexed(ledger, 'article_registered')
    expect(matchArticleEvent('register', expected, facts).status).toBe(
      'CONFIRMED'
    )

    const record = (
      await core(author).get_article({
        article_id: Buffer.from(articleKey, 'hex'),
      })
    ).result
    expect(record?.author).toBe(author.publicKey())
    expect(bytesToHex(record!.content_hash)).toBe(contentHash)
    expect(record?.splits).toEqual(splits)
  })

  it('reports a duplicate registration from simulation and sends nothing', async () => {
    const run = await act(
      {
        kind: 'register',
        signer: author.publicKey(),
        articleKey,
        articleRef,
        author: author.publicKey(),
        contentHash: 'ab'.repeat(32),
        arweaveId: null,
        splits: [],
        newAuthor: null,
        liveUntilLedger: null,
      },
      author
    )
    expect(run.result).toMatchObject({
      status: 'failed',
      stage: 'simulation',
      code: 'AlreadyRegistered',
    })
    expect(run.submitted).toEqual([])
    expect(run.failed).toEqual(['simulation_failed:AlreadyRegistered'])
  })

  it('re-anchors content as version 2', async () => {
    const contentHash = 'cd'.repeat(32)
    const run = await act(
      {
        kind: 'content_update',
        signer: author.publicKey(),
        articleKey,
        articleRef: null,
        author: null,
        contentHash,
        arweaveId: null,
        splits: [],
        newAuthor: null,
        liveUntilLedger: null,
      },
      author
    )
    expect(run.result.status).toBe('submitted')
    const expected: ExpectedArticle = {
      articleKey,
      signer: author.publicKey(),
      contentHash,
      arweaveId: null,
      contentVersion: 2,
    }
    const { ledger, outcome } = await verify(
      'content_update',
      expected,
      run.submitted[0]!
    )
    expect(outcome.status).toBe('CONFIRMED')
    const facts = await indexed(ledger, 'content_updated')
    expect(facts.contentVersion).toBe(2)
  })

  it('refuses to sign from the wrong account', async () => {
    const run = await act(
      {
        kind: 'author_accept',
        signer: newWallet.publicKey(),
        articleKey,
        articleRef: null,
        author: author.publicKey(),
        contentHash: null,
        arweaveId: null,
        splits: [],
        newAuthor: newWallet.publicKey(),
        liveUntilLedger: null,
      },
      newWallet,
      author.publicKey()
    )
    expect(run.result).toMatchObject({
      status: 'failed',
      code: 'WRONG_ACCOUNT',
    })
    expect(run.submitted).toEqual([])
  })

  it('moves the article to a new wallet in two single-signer transactions', async () => {
    const liveUntil = (await h.latestLedger()) + 7 * DAY
    const propose = await act(
      {
        kind: 'author_propose',
        signer: author.publicKey(),
        articleKey,
        articleRef: null,
        author: null,
        contentHash: null,
        arweaveId: null,
        splits: [],
        newAuthor: newWallet.publicKey(),
        liveUntilLedger: liveUntil,
      },
      author
    )
    expect(propose.result.status).toBe('submitted')
    const proposed = await verify(
      'author_propose',
      {
        articleKey,
        signer: author.publicKey(),
        newAuthor: newWallet.publicKey(),
        liveUntilLedger: liveUntil,
      },
      propose.submitted[0]!
    )
    expect(proposed.outcome.status).toBe('CONFIRMED')

    const accept = await act(
      {
        kind: 'author_accept',
        signer: newWallet.publicKey(),
        articleKey,
        articleRef: null,
        author: author.publicKey(),
        contentHash: null,
        arweaveId: null,
        splits: [],
        newAuthor: newWallet.publicKey(),
        liveUntilLedger: null,
      },
      newWallet
    )
    expect(accept.result.status).toBe('submitted')
    const expected: ExpectedArticle = {
      articleKey,
      signer: newWallet.publicKey(),
      author: author.publicKey(),
      newAuthor: newWallet.publicKey(),
    }
    const accepted = await verify(
      'author_accept',
      expected,
      accept.submitted[0]!
    )
    expect(accepted.outcome.status).toBe('CONFIRMED')
    const facts = await indexed(accepted.ledger, 'author_changed')
    expect(matchArticleEvent('author_accept', expected, facts).status).toBe(
      'CONFIRMED'
    )

    const record = (
      await core(newWallet).get_article({
        article_id: Buffer.from(articleKey, 'hex'),
      })
    ).result
    expect(record?.author).toBe(newWallet.publicKey())
    expect(record?.splits[0]?.recipient).toBe(newWallet.publicKey())
    // The article ID never changes after registration.
    expect(record?.content_version).toBe(2)
  })

  it('never targets a non-local network', () => {
    expect(h.net.passphrase).toBe(LOCAL_PASSPHRASE)
    expect(h.net.passphrase).not.toBe(Networks.PUBLIC)
    expect(new URL(h.net.rpcUrl).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/)
  })
})
