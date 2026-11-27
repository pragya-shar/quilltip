// Browser-only collaborators for the v2 tip fixture. They stand in for
// Convex (tipsV2, chain config, wallet linking), auth and Stellar RPC, so the
// real tip components, runner, call encoder, wallet runtime and Wallets Kit
// run against an emulated Varial wallet. Nothing is sent to a network.
//
// Query parameters choose the scenario; see SCENARIO below and
// e2e/tips-v2.spec.ts.
import {
  lazy,
  Suspense,
  createElement,
  useSyncExternalStore,
  type ComponentType,
} from 'react'
import { ConvexError } from 'convex/values'
import {
  Account,
  Keypair,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk'
import { bytesToHex } from '../../../lib/stellar/bytes'
import { highlightId } from '../../../lib/stellar/v2/ids'

export const CORE = 'CAFCGOIM6SKVBWCPFQODN22MY5HUJEJMW5AOMNGAOVZ4QBLJJ5RLOOMS'
export const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const AUTHOR = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const COAUTHOR = 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR'
const PRICE = 0.25

/** Fixture articles: the page's article, a second one, and one with splits. */
export const ARTICLES = {
  main: {
    id: 'k17tipsfixturemain',
    slug: 'on-writing-well',
    title: 'On Writing Well, Again',
    author: 'Ada Lovelace',
    key: 'cc65c9f34cfcab79e7db908c83af037d6e3a5498cff7b507a4c59561b8090aef',
    recipients: 1,
  },
  second: {
    id: 'k17tipsfixturesecond',
    slug: 'notes-on-margins',
    title: 'Notes on Margins',
    author: 'Grace Hopper',
    key: 'ab'.repeat(32),
    recipients: 1,
  },
  shared: {
    id: 'k17tipsfixtureshared',
    slug: 'four-hands',
    title: 'Four Hands: A Shared Essay with an Unusually Long Title to Wrap',
    author: 'Ada Lovelace and co-authors',
    key: 'cd'.repeat(32),
    recipients: 5,
  },
}
type ArticleKey = keyof typeof ARTICLES

// Worst-case data (`?data=worst`): long and non-Latin titles, a long author
// name, and a long unbroken passage, through the same boundary as the demo.
if (new URLSearchParams(location.search).get('data') === 'worst') {
  ARTICLES.main.title =
    'Notes Toward a Unified Theory of Marginalia: Readers, Writers, and the Strange Economics of Paying for a Single Sentence (Part Three of Seven)'
  ARTICLES.main.author = 'Aleksandra Wiśniewska-Kowalczyk-Montgomery III'
  ARTICLES.second.title =
    'Những ghi chú bên lề về việc đọc chậm trong thời đại tốc độ'
  ARTICLES.second.author = 'Nguyễn Thị Phương Thảo'
  ARTICLES.shared.title =
    'ملاحظات حول القراءة البطيئة وكتابة الهوامش في العصر الرقمي'
  ARTICLES.shared.author = '山田 太郎 と 共著者たち'
}
const byId = (id: string): (typeof ARTICLES)[ArticleKey] =>
  Object.values(ARTICLES).find((a) => a.id === id) ?? ARTICLES.main

const params = new URLSearchParams(location.search)
/** What the fixture does; every value has a default. */
export const SCENARIO = {
  v2: params.get('v2') ?? 'on',
  auth: params.get('auth') ?? 'in',
  /** registered | unregistered | pending | payout | own | paused | price | v1-paused */
  article: params.get('article') ?? 'registered',
  /** verified | unverified | none */
  link: params.get('link') ?? 'verified',
  /** ok | below | rate | v2off | config | self | highlight | item | offline */
  prepare: params.get('prepare') ?? 'ok',
  /** ok | balance | paused | below | slow | unknown */
  sim: params.get('sim') ?? 'ok',
  /** ok | error | busy | slow */
  send: params.get('send') ?? 'ok',
  /** confirmed | author | review | late-event | expired | failed | never | batch-review | batch-author */
  result: params.get('result') ?? 'confirmed',
  delay: Number(params.get('delay') ?? 600),
  /** prepared | prepared-hash | submitted | slow | confirmed (a stored tip at load) */
  reload: params.get('reload'),
  /** a number of basket items, or full | transfers */
  basket: params.get('basket'),
}

// --- Wallet ------------------------------------------------------------------

type FixtureLog = {
  prepared: Array<{ name: string; args: Record<string, unknown> }>
  submitted: Array<{ submissionId: string; txHash: string }>
  failed: Array<{ submissionId: string; reason: string; detail?: string }>
  signed: string[]
  sent: string[]
}
declare global {
  interface Window {
    __tipsV2: FixtureLog
  }
}
window.__tipsV2 = {
  prepared: [],
  submitted: [],
  failed: [],
  signed: [],
  sent: [],
}

// A throwaway key for the emulated wallet (e2e/helpers/varialEmulator.ts).
const fixtureKey = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(7))
export const WALLET = fixtureKey.publicKey()
;(window as unknown as { __fixtureWallet: unknown }).__fixtureWallet = {
  address: WALLET,
  signMessage: (message: string) =>
    btoa(String.fromCharCode(...fixtureKey.signMessage(message))),
  signTransaction: (envelope: string) => {
    const tx = TransactionBuilder.fromXDR(
      envelope,
      Networks.TESTNET
    ) as Transaction
    tx.sign(fixtureKey)
    window.__tipsV2.signed.push(tx.toXDR())
    return tx.toXDR()
  },
}

// --- Store ---------------------------------------------------------------------

type Row = {
  articleId: string
  table: 'tips' | 'highlightTips'
  amountCents: number
  gross: string
  status: string
  mismatchReason: string | null
  needsReview: boolean
  clientRef: string
}
type Submission = {
  id: string
  method: 'tip' | 'tip_batch'
  status: string
  mismatchReason: string | null
  needsReview: boolean
  txHash: string | null
  maxTime: number
  rows: Row[]
}
type Store = {
  link: string
  submissions: Record<string, Submission>
}

let store: Store = { link: SCENARIO.link, submissions: {} }
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function update(next: Partial<Store>) {
  store = { ...store, ...next }
  listeners.forEach((listener) => listener())
}
function updateSubmission(id: string, patch: Partial<Submission>) {
  const current = store.submissions[id]
  if (!current) return
  const rows = patch.rows ?? current.rows
  update({
    submissions: {
      ...store.submissions,
      [id]: { ...current, ...patch, rows },
    },
  })
}

const random = (bytes: number) =>
  bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)))
const fee = (gross: string) =>
  ((BigInt(gross) * BigInt(250)) / BigInt(10_000)).toString()
const grossFor = (cents: number) =>
  BigInt(Math.floor((cents * 10_000_000) / (PRICE * 100))).toString()

// --- Convex stand-in ------------------------------------------------------------

/** `api.a.b.c` is a reference whose string form is "a.b.c". */
function reference(path: string): unknown {
  return new Proxy(
    {},
    {
      get: (_, key) =>
        key === Symbol.toPrimitive || key === 'toString'
          ? () => path
          : reference(path ? `${path}.${String(key)}` : String(key)),
    }
  )
}
export const api: unknown = reference('')

function eligibility(articleId: string) {
  const article = byId(articleId)
  const base = {
    eligible: true,
    reason: null as string | null,
    message: null as string | null,
    articleKey: article.key as string | null,
    authorAddress: AUTHOR as string | null,
    recipientCount: article.recipients,
    transferCount: article.recipients + 1,
    maxBatchItems: 10,
    maxBatchTransfers: 24,
    minTipBaseUnits: '1000000',
    minTipCents: 3,
    price: { priceUsd: PRICE, source: 'Fixture', fetchedAt: Date.now() },
    tipperAddress: WALLET as string | null,
  }
  const refuse = (reason: string, patch = {}) => ({
    ...base,
    eligible: false,
    reason,
    message: reason,
    ...patch,
  })
  if (SCENARIO.auth === 'out') {
    return refuse('UNAUTHENTICATED', { tipperAddress: null })
  }
  if (articleId === ARTICLES.main.id) {
    switch (SCENARIO.article) {
      case 'unregistered':
      case 'pending':
        return refuse('ARTICLE_NOT_REGISTERED', {
          articleKey: null,
          transferCount: null,
        })
      case 'payout':
        return refuse('PAYOUT_ADDRESS_CHANGED')
      case 'own':
        return refuse('SELF_TIP')
      case 'paused':
        return refuse('PAUSED')
      case 'price':
        return refuse('PRICE_UNAVAILABLE', { price: null, minTipCents: null })
    }
  }
  if (store.link === 'unverified') {
    return refuse('ADDRESS_UNVERIFIED', { tipperAddress: null })
  }
  if (store.link === 'none') return refuse('NO_WALLET', { tipperAddress: null })
  return base
}

function tipStatus(id: string) {
  const sub = store.submissions[id]
  if (!sub) return null
  const uiState = (s: {
    status: string
    mismatchReason: string | null
    needsReview: boolean
  }) =>
    s.status === 'CONFIRMED'
      ? 'confirmed'
      : s.status === 'MISMATCH'
        ? s.mismatchReason === 'author'
          ? 'mismatch_author'
          : 'mismatch_review'
        : (s.status === 'FAILED' || s.status === 'EXPIRED') && s.needsReview
          ? 'mismatch_review'
          : s.status === 'FAILED'
            ? 'failed'
            : s.status === 'EXPIRED'
              ? 'expired'
              : 'checking'
  const verified = sub.rows.every(
    (r) => r.status === 'CONFIRMED' || r.status === 'MISMATCH'
  )
  const items = sub.rows.map((row, i) => ({
    table: row.table,
    tipId: `${id}-tip-${i}`,
    articleId: row.articleId,
    clientRef: row.clientRef,
    status: row.status,
    uiState: uiState(row),
    mismatchReason: row.mismatchReason,
    needsReview: row.needsReview,
    failureReason: null,
    amountCents: row.amountCents,
    preparedBaseUnits: row.gross,
    expectedAuthorAddress: AUTHOR,
    chain:
      row.status === 'CONFIRMED' || row.status === 'MISMATCH'
        ? {
            grossBaseUnits: row.gross,
            feeBaseUnits: fee(row.gross),
            netBaseUnits: (
              BigInt(row.gross) - BigInt(fee(row.gross))
            ).toString(),
            tokenContractId: TOKEN,
            authorAddress: row.mismatchReason === 'author' ? COAUTHOR : AUTHOR,
            tipperAddress: WALLET,
            contentHash: 'ab'.repeat(32),
            contentVersion: 1,
          }
        : null,
  }))
  const sum = (pick: (r: Row) => string) =>
    sub.rows.reduce((a, r) => a + BigInt(pick(r)), BigInt(0)).toString()
  return {
    submissionId: id,
    method: sub.method,
    status: sub.status,
    uiState: uiState(sub),
    canRetry:
      (sub.status === 'FAILED' || sub.status === 'EXPIRED') && !sub.needsReview,
    needsReview: sub.needsReview,
    mismatchReason: sub.mismatchReason,
    txHash: sub.txHash,
    ledger: verified ? 1_234_567 : null,
    maxTime: sub.maxTime,
    contractId: CORE,
    items,
    chainTotals: verified
      ? {
          grossBaseUnits: sum((r) => r.gross),
          feeBaseUnits: sum((r) => fee(r.gross)),
          netBaseUnits: sum((r) =>
            (BigInt(r.gross) - BigInt(fee(r.gross))).toString()
          ),
        }
      : null,
  }
}

export function useQuery(ref: unknown, args?: unknown) {
  const name = String(ref)
  const current = useSyncExternalStore(subscribe, () => store)
  if (args === 'skip') return undefined
  const a = (args ?? {}) as Record<string, string>
  switch (name) {
    case 'chain.config.getChainConfig':
      return {
        network: 'TESTNET',
        chainEpoch: 'fixture',
        v2Enabled: SCENARIO.v2 !== 'off' && SCENARIO.article !== 'v1-paused',
        coreContractId: CORE,
        tokenContractId: TOKEN,
        minTip: '1000000',
        paused: { core: SCENARIO.article === 'paused' },
      }
    case 'chain.articles.getArticleTipAvailability':
      // v1 preparation paused before v2 is on (cutover step 4, #520).
      if (SCENARIO.article === 'v1-paused') return { status: 'paused' }
      if (SCENARIO.v2 === 'off') return { status: 'disabled' }
      if (a.articleId === ARTICLES.main.id) {
        if (SCENARIO.article === 'unregistered')
          return { status: 'unregistered' }
        if (SCENARIO.article === 'pending') return { status: 'pending' }
        if (SCENARIO.article === 'payout') return { status: 'payout_outdated' }
      }
      return { status: 'registered' }
    case 'tipsV2.getTipEligibility':
      void current
      return eligibility(a.articleId!)
    case 'tipsV2.getTipStatus':
      return tipStatus(a.submissionId!)
    case 'walletLink.getMyWalletLink':
      return current.link === 'verified'
        ? {
            address: WALLET,
            state: 'verified',
            verifiedAt: 1,
            networkPassphrase: Networks.TESTNET,
          }
        : null
  }
  return undefined
}

let counter = 0
const PREPARES = new Set([
  'tipsV2.prepareDirectTip',
  'tipsV2.prepareHighlightTip',
  'tipsV2.prepareBatch',
])

type ItemArgs = {
  articleId: string
  amountCents: number
  highlight?: { text: string; startOffset: number; endOffset: number } | null
}

function refuseFor(scenario: string, isBatch: boolean): never | void {
  const err = (code: string, extra = {}) => {
    throw new ConvexError({ code, message: code, ...extra })
  }
  switch (scenario) {
    case 'below':
      return err('BELOW_MINIMUM', { minTipBaseUnits: '1000000' })
    case 'rate':
      return err('RATE_LIMITED', { retryAfterMs: 42_000 })
    case 'v2off':
      return err('CHAIN_V2_DISABLED')
    case 'config':
      return err('CHAIN_CONFIG_MISSING')
    case 'self':
      return err('SELF_TIP')
    case 'highlight':
      return err('HIGHLIGHT_INVALID')
    case 'price':
      return err('PRICE_UNAVAILABLE')
    case 'paused':
      return err('PAUSED')
    case 'unregistered':
      return err('ARTICLE_NOT_REGISTERED', isBatch ? { itemIndex: 1 } : {})
    case 'item':
      return err('PAYOUT_ADDRESS_CHANGED', { itemIndex: 1 })
    case 'offline':
      throw new TypeError('Failed to fetch')
  }
}

function prepareTip(name: string, args: Record<string, unknown>) {
  const isBatch = name === 'tipsV2.prepareBatch'
  refuseFor(SCENARIO.prepare, isBatch)
  const items: ItemArgs[] = isBatch
    ? (args.items as ItemArgs[])
    : [args as unknown as ItemArgs]
  const id = `sub-${++counter}`
  const maxTime = Math.floor(Date.now() / 1000) + 300
  const rows: Row[] = items.map((item) => ({
    articleId: item.articleId,
    table: item.highlight ? 'highlightTips' : 'tips',
    amountCents: item.amountCents,
    gross: grossFor(item.amountCents),
    status: 'PREPARED',
    mismatchReason: null,
    needsReview: false,
    clientRef: random(16),
  }))
  const method = rows.length === 1 ? 'tip' : 'tip_batch'
  update({
    submissions: {
      ...store.submissions,
      [id]: {
        id,
        method,
        status: 'PREPARED',
        mismatchReason: null,
        needsReview: false,
        txHash: null,
        maxTime,
        rows,
      },
    },
  })
  const prepared = items.map((item, i) => {
    const article = byId(item.articleId)
    const gross = rows[i]!.gross
    return {
      table: rows[i]!.table,
      tipId: `${id}-tip-${i}`,
      articleId: item.articleId,
      tipInput: {
        article_id: article.key,
        amount: gross,
        highlight_id: item.highlight
          ? bytesToHex(
              highlightId(
                article.slug,
                item.highlight.startOffset,
                item.highlight.endOffset,
                item.highlight.text
              )
            )
          : null,
        client_ref: rows[i]!.clientRef,
      },
      legacyHighlightId: null,
      authorAddress: AUTHOR,
      quote: {
        amountCents: item.amountCents,
        priceUsd: PRICE,
        priceSource: 'Fixture',
        priceFetchedAt: Date.now(),
        grossBaseUnits: gross,
        grossXlm: '0',
        feeBaseUnits: fee(gross),
        netBaseUnits: (BigInt(gross) - BigInt(fee(gross))).toString(),
        feeBps: 250,
      },
    }
  })
  const total = (pick: (r: Row) => string) =>
    rows.reduce((a, r) => a + BigInt(pick(r)), BigInt(0)).toString()
  return {
    submissionId: id,
    method,
    status: 'PREPARED',
    existing: false,
    network: 'TESTNET',
    networkPassphrase: Networks.TESTNET,
    chainEpoch: 'fixture',
    contractId: CORE,
    tokenContractId: TOKEN,
    tipperAddress: WALLET,
    maxTime,
    items: prepared,
    totals: {
      amountCents: items.reduce((a, i) => a + i.amountCents, 0),
      grossBaseUnits: total((r) => r.gross),
      grossXlm: '0',
      feeBaseUnits: total((r) => fee(r.gross)),
      netBaseUnits: total((r) =>
        (BigInt(r.gross) - BigInt(fee(r.gross))).toString()
      ),
    },
  }
}

/** The verifier's answer, after `delay` ms. */
function settle(id: string) {
  if (SCENARIO.result === 'never') return
  setTimeout(() => {
    const sub = store.submissions[id]
    if (!sub) return
    const rowsWith = (status: string, reason: string | null = null) =>
      sub.rows.map((r) => ({
        ...r,
        status,
        mismatchReason: reason,
        needsReview: !!reason && reason !== 'author',
      }))
    switch (SCENARIO.result) {
      case 'author':
        return updateSubmission(id, {
          status: 'MISMATCH',
          mismatchReason: 'author',
          rows: rowsWith('MISMATCH', 'author'),
        })
      case 'review':
        return updateSubmission(id, {
          status: 'MISMATCH',
          mismatchReason: 'field:gross',
          needsReview: true,
          rows: rowsWith('MISMATCH', 'field:gross'),
        })
      case 'expired':
        return updateSubmission(id, {
          status: 'EXPIRED',
          rows: rowsWith('EXPIRED'),
        })
      case 'failed':
        return updateSubmission(id, {
          status: 'FAILED',
          rows: rowsWith('FAILED'),
        })
      case 'late-event':
        // FAILED, then an event arrived after all: flagged for review.
        return updateSubmission(id, {
          status: 'FAILED',
          needsReview: true,
          rows: sub.rows.map((r) => ({
            ...r,
            status: 'FAILED',
            needsReview: true,
          })),
        })
      case 'batch-review':
      case 'batch-author': {
        const reason =
          SCENARIO.result === 'batch-review' ? 'field:gross' : 'author'
        return updateSubmission(id, {
          status: 'MISMATCH',
          mismatchReason: reason,
          needsReview: reason !== 'author',
          rows: sub.rows.map((r, i) =>
            i === 1
              ? {
                  ...r,
                  status: 'MISMATCH',
                  mismatchReason: reason,
                  needsReview: reason !== 'author',
                }
              : { ...r, status: 'CONFIRMED' }
          ),
        })
      }
      default:
        return updateSubmission(id, {
          status: 'CONFIRMED',
          rows: rowsWith('CONFIRMED'),
        })
    }
  }, SCENARIO.delay)
}

export function useMutation(ref: unknown) {
  const name = String(ref)
  return async (args: Record<string, unknown>) => {
    if (PREPARES.has(name)) {
      window.__tipsV2.prepared.push({ name, args })
      return prepareTip(name, args)
    }
    if (name === 'tipsV2.recordSubmitted') {
      const { submissionId, txHash } = args as {
        submissionId: string
        txHash: string
      }
      window.__tipsV2.submitted.push({ submissionId, txHash })
      const sub = store.submissions[submissionId]
      if (sub && sub.status === 'PREPARED') {
        updateSubmission(submissionId, {
          status: 'SUBMITTED',
          txHash,
          rows: sub.rows.map((r) => ({ ...r, status: 'SUBMITTED' })),
        })
        settle(submissionId)
      }
      return { submissionId, status: 'SUBMITTED', duplicate: false }
    }
    if (name === 'tipsV2.recordSendFailed') {
      const { submissionId } = args as { submissionId: string }
      window.__tipsV2.failed.push(
        args as { submissionId: string; reason: string; detail?: string }
      )
      const sub = store.submissions[submissionId]
      if (sub) {
        updateSubmission(submissionId, {
          status: 'FAILED',
          rows: sub.rows.map((r) => ({ ...r, status: 'FAILED' })),
        })
      }
      return { submissionId, status: 'FAILED' }
    }
    if (name === 'walletLink.createWalletChallenge') {
      return {
        challengeId: 'challenge-1',
        message: 'Quilltip wallet check (fixture)',
        transactionXdr: '',
        expiresAt: Date.now() + 300_000,
      }
    }
    if (name === 'walletLink.verifyWalletChallenge') {
      update({ link: 'verified' })
      return { ok: true, address: WALLET, verifiedAt: Date.now() }
    }
    return null
  }
}

export function useAuth() {
  return SCENARIO.auth === 'out'
    ? { user: null, isAuthenticated: false, isLoading: false }
    : {
        user: { _id: 'qa-reader', username: 'reader', name: 'Reader' },
        isAuthenticated: true,
        isLoading: false,
      }
}

// --- Reload: a tip this browser started before the page loaded ---------------

export function seedReload() {
  const kind = SCENARIO.reload
  if (!kind) return
  const id = 'sub-reload'
  const status =
    kind === 'submitted' || kind === 'slow'
      ? 'SUBMITTED'
      : kind === 'confirmed'
        ? 'CONFIRMED'
        : 'PREPARED'
  const gross = grossFor(200)
  store.submissions[id] = {
    id,
    method: 'tip',
    status,
    mismatchReason: null,
    needsReview: false,
    txHash: status === 'PREPARED' ? null : 'a7'.repeat(32),
    // `slow`: the time bound passed more than 30 s ago, still unanswered.
    maxTime: Math.floor(Date.now() / 1000) + (kind === 'slow' ? -60 : 300),
    rows: [
      {
        articleId: ARTICLES.main.id,
        table: 'tips',
        amountCents: 200,
        gross,
        status,
        mismatchReason: null,
        needsReview: false,
        clientRef: random(16),
      },
    ],
  }
  localStorage.setItem(
    `quilltip:tip-pending:v2:qa-reader:article:${ARTICLES.main.id}`,
    JSON.stringify({
      submissionId: id,
      txHash: kind === 'prepared-hash' ? 'b8'.repeat(32) : null,
      startedAt: Date.now(),
    })
  )
}

export function seedBasket() {
  const value = SCENARIO.basket
  if (!value) return
  const make = (key: ArticleKey, n: number, highlight = false) => ({
    id: `seed-${n}`,
    articleId: ARTICLES[key].id,
    articleSlug: ARTICLES[key].slug,
    articleTitle: ARTICLES[key].title,
    authorName: ARTICLES[key].author,
    amountCents: 100 + n * 25,
    highlight: highlight
      ? {
          text: `A seeded passage number ${n} from the second article.`,
          startOffset: n * 100,
          endOffset: n * 100 + 52,
        }
      : null,
    transferCount: ARTICLES[key].recipients + 1,
    articleKey: ARTICLES[key].key,
  })
  let items
  if (value === 'sent') {
    // A basket of two tips whose payment the server confirmed, before the
    // reader pressed "Done" (a reload after the result, #547).
    items = [make('second', 0), make('shared', 1)]
    const id = 'sub-basket-sent'
    store.submissions[id] = {
      id,
      method: 'tip_batch',
      status: 'CONFIRMED',
      mismatchReason: null,
      needsReview: false,
      txHash: 'c9'.repeat(32),
      maxTime: Math.floor(Date.now() / 1000) + 300,
      rows: items.map((item) => ({
        articleId: item.articleId,
        table: 'tips' as const,
        amountCents: item.amountCents,
        gross: grossFor(item.amountCents),
        status: 'CONFIRMED',
        mismatchReason: null,
        needsReview: false,
        clientRef: random(16),
      })),
    }
    localStorage.setItem(
      'quilltip:tip-basket:v2:qa-reader',
      JSON.stringify({ items, submissionId: id, sent: items })
    )
    return
  }
  if (value === 'full') {
    items = Array.from({ length: 10 }, (_, n) => make('second', n, n > 0))
  } else if (value === 'transfers') {
    // 3 shared articles (6 transfers each) and 3 plain tips: 24 of 24.
    items = [0, 1, 2].flatMap((n) => [
      {
        ...make('shared', n),
        ...(n > 0
          ? {
              highlight: {
                text: `Shared ${n}`,
                startOffset: n,
                endOffset: n + 8,
              },
            }
          : {}),
      },
      make('second', n + 3, n > 0),
    ])
  } else {
    const n = Number(value)
    items = Array.from({ length: n }, (_, i) =>
      make(i % 2 === 0 ? 'second' : 'shared', i, i > 1)
    )
  }
  localStorage.setItem(
    'quilltip:tip-basket:v2:qa-reader',
    JSON.stringify({ items, submissionId: null, sent: null })
  )
}

// --- lib/stellar/v2/chain-runtime stand-in -------------------------------------

function errorEvent(contractId: string, code: number) {
  return {
    toJSON: () => ({
      event: {
        contract_id: contractId,
        body: {
          v0: { topics: [{ symbol: 'error' }, { error: { contract: code } }] },
        },
      },
    }),
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function v2Runtime() {
  return {
    config: {
      network: 'TESTNET',
      passphrase: Networks.TESTNET,
      rpcUrl: 'http://127.0.0.1:4179/rpc',
      allowHttp: true,
      coreContractId: CORE,
      tabContractId: null,
      nftContractId: null,
      tokenContractId: TOKEN,
    },
    latestLedger: async () => 1_234_567,
    server: {
      getAccount: async (id: string) => new Account(id, '1'),
      getAccountEntry: async () => ({
        balance: BigInt(30_000_000),
        numSubEntries: 0,
        ext: { type: 'v0' },
      }),
      simulateTransaction: async () => {
        if (SCENARIO.sim === 'slow') await wait(2_500)
        const fail = (contract: string, code: number) => ({
          id: '1',
          latestLedger: 1,
          _parsed: true,
          error: `HostError: Error(Contract, #${code})`,
          events: [errorEvent(contract, code)],
        })
        if (SCENARIO.sim === 'balance') return fail(TOKEN, 10)
        if (SCENARIO.sim === 'paused') return fail(CORE, 1000)
        if (SCENARIO.sim === 'below') return fail(CORE, 8)
        if (SCENARIO.sim === 'unknown') return fail(AUTHOR, 3)
        return {
          id: '1',
          latestLedger: 1,
          events: [],
          _parsed: true,
          transactionData: new SorobanDataBuilder(),
          minResourceFee: '100',
          result: { auth: [], retval: xdr.ScVal.scvVoid() },
        }
      },
      sendTransaction: async (tx: Transaction) => {
        if (SCENARIO.send === 'slow') await wait(2_500)
        const hash = bytesToHex(tx.hash())
        window.__tipsV2.sent.push(hash)
        if (SCENARIO.send === 'error') {
          return {
            status: 'ERROR',
            hash,
            errorResult: { result: { type: 'txFailed' } },
          }
        }
        if (SCENARIO.send === 'busy') return { status: 'TRY_AGAIN_LATER', hash }
        return { status: 'PENDING', hash }
      },
      getTransaction: async () => ({ status: 'NOT_FOUND' }),
    },
  }
}

export const stellarClient = {}

/** next/dynamic without Next: React.lazy behind Suspense. */
export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>
) {
  const Lazy = lazy(async () => {
    const mod = await loader()
    return 'default' in (mod as object)
      ? (mod as { default: ComponentType<P> })
      : { default: mod as ComponentType<P> }
  })
  return (props: P) =>
    createElement(Suspense, { fallback: null }, createElement(Lazy, props))
}

/** The v1 flow's direct client; the fixture only renders its button. */
export function useConvex() {
  return { query: async () => null, mutation: async () => null }
}
