// Browser-only collaborators for the wallet fixture. They stand in for Convex,
// auth and Stellar RPC so the real wallet runtime, Wallets Kit and v2 article
// tip dialog can run against an emulated wallet. Nothing is sent to a network.
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
import {
  WALLET_CHALLENGE_TTL_MS,
  challengeMessage,
  challengeTransaction,
  checkWalletProof,
  type WalletChallengeFields,
} from '../../../convex/lib/walletChallenge'

/**
 * Records what reached the backend stand-ins, for assertions. `signedXdr` is
 * the tip envelope the wallet signed, as it reached the RPC send.
 */
type FixtureLog = {
  prepared: number
  signedXdr: string | null
  proofs: string[]
}
declare global {
  interface Window {
    __walletFixture: FixtureLog
  }
}
window.__walletFixture = { prepared: 0, signedXdr: null, proofs: [] }

const params = new URLSearchParams(location.search)

// A throwaway testnet key for the emulated wallet (e2e/helpers/varialEmulator.ts).
// `?secret=` sets it, so a wallet window on another origin (the xBull web
// wallet stand-in) can sign as the same account.
const fixtureKey = params.get('secret')
  ? Keypair.fromSecret(params.get('secret')!)
  : Keypair.random()
;(window as unknown as { __fixtureWallet: unknown }).__fixtureWallet = {
  address: fixtureKey.publicKey(),
  signMessage: (message: string) =>
    btoa(String.fromCharCode(...fixtureKey.signMessage(message))),
  signTransaction: (xdr: string) => {
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction
    tx.sign(fixtureKey)
    return tx.toXDR()
  },
  /** Signs for `passphrase`, as a wallet set to that network does. */
  signTransactionFor: (xdr: string, passphrase: string) => {
    const tx = TransactionBuilder.fromXDR(xdr, passphrase) as Transaction
    tx.sign(fixtureKey)
    return tx.toXDR()
  },
}

// The signed-in writer's link (walletLink.getMyWalletLink), from `?link=`:
// none, unverified (the wallet's address), verified, or other (another
// unverified address).
type Link = {
  address: string | null
  state: 'none' | 'unverified' | 'verified'
  verifiedAt: number | null
  networkPassphrase: string
}
const OTHER = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const initialLink = params.get('link') ?? 'none'
let link: Link = {
  address:
    initialLink === 'none'
      ? null
      : initialLink === 'other'
        ? OTHER
        : fixtureKey.publicKey(),
  state:
    initialLink === 'verified'
      ? 'verified'
      : initialLink === 'none'
        ? 'none'
        : 'unverified',
  verifiedAt: initialLink === 'verified' ? 1 : null,
  networkPassphrase: Networks.TESTNET,
}
const linkListeners = new Set<() => void>()
const subscribeLink = (listener: () => void) => {
  linkListeners.add(listener)
  return () => linkListeners.delete(listener)
}
const challenges = new Map<string, WalletChallengeFields>()

const READER = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
export const AUTHOR = 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR'
// Testnet v2 contract IDs (Core and the native token); nothing calls them.
const CORE = 'CAFCGOIM6SKVBWCPFQODN22MY5HUJEJMW5AOMNGAOVZ4QBLJJ5RLOOMS'
const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
/** The fixture article: registered on Core, one recipient. */
export const ARTICLE = {
  id: 'qa-article',
  slug: 'the-words-we-keep',
  key: 'cc65c9f34cfcab79e7db908c83af037d6e3a5498cff7b507a4c59561b8090aef',
}
/** XLM in US dollars: $1 is 10 XLM. */
const PRICE = 0.1

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

const hold = () => new Promise<never>(() => {})

export function useConvex() {
  return { query: async () => null, mutation: async () => null }
}

// --- v2 tip stand-ins ---------------------------------------------------------

/** One prepared v2 tip at a time; the RPC send holds, so none is submitted. */
let submission: { id: string; status: string; maxTime: number } | null = null
const fee = (gross: string) =>
  ((BigInt(gross) * BigInt(250)) / BigInt(10_000)).toString()
const grossFor = (cents: number) =>
  BigInt(Math.floor((cents * 10_000_000) / (PRICE * 100))).toString()

function tipEligibility() {
  return {
    eligible: true,
    reason: null,
    message: null,
    articleKey: ARTICLE.key,
    authorAddress: AUTHOR,
    recipientCount: 1,
    transferCount: 2,
    maxBatchItems: 10,
    maxBatchTransfers: 24,
    minTipBaseUnits: '1000000',
    minTipCents: 3,
    price: { priceUsd: PRICE, source: 'Fixture', fetchedAt: Date.now() },
    tipperAddress: fixtureKey.publicKey(),
  }
}

function prepareDirectTip(args: { articleId: string; amountCents: number }) {
  window.__walletFixture.prepared += 1
  const gross = grossFor(args.amountCents)
  const net = (BigInt(gross) - BigInt(fee(gross))).toString()
  const id = `sub-${window.__walletFixture.prepared}`
  const maxTime = Math.floor(Date.now() / 1000) + 300
  submission = { id, status: 'PREPARED', maxTime }
  linkListeners.forEach((listener) => listener())
  return {
    submissionId: id,
    method: 'tip',
    status: 'PREPARED',
    existing: false,
    network: 'TESTNET',
    networkPassphrase: Networks.TESTNET,
    chainEpoch: 'fixture',
    contractId: CORE,
    tokenContractId: TOKEN,
    tipperAddress: fixtureKey.publicKey(),
    maxTime,
    items: [
      {
        table: 'tips',
        tipId: `${id}-tip-0`,
        articleId: args.articleId,
        tipInput: {
          article_id: ARTICLE.key,
          amount: gross,
          highlight_id: null,
          client_ref: 'ab'.repeat(16),
        },
        legacyHighlightId: null,
        authorAddress: AUTHOR,
        quote: {
          amountCents: args.amountCents,
          priceUsd: PRICE,
          priceSource: 'Fixture',
          priceFetchedAt: Date.now(),
          grossBaseUnits: gross,
          grossXlm: '0',
          feeBaseUnits: fee(gross),
          netBaseUnits: net,
          feeBps: 250,
        },
      },
    ],
    totals: {
      amountCents: args.amountCents,
      grossBaseUnits: gross,
      grossXlm: '0',
      feeBaseUnits: fee(gross),
      netBaseUnits: net,
    },
  }
}

function tipStatus(id: string) {
  if (!submission || submission.id !== id) return null
  const failed = submission.status === 'FAILED'
  return {
    submissionId: id,
    method: 'tip',
    status: submission.status,
    uiState: failed ? 'failed' : 'checking',
    canRetry: failed,
    needsReview: false,
    mismatchReason: null,
    txHash: null,
    ledger: null,
    maxTime: submission.maxTime,
    contractId: CORE,
    items: [],
    chainTotals: null,
  }
}

export function useMutation(ref: unknown) {
  const name = String(ref)
  if (name === 'tipsV2.prepareDirectTip') {
    return async (args: { articleId: string; amountCents: number }) =>
      prepareDirectTip(args)
  }
  if (name === 'tipsV2.recordSendFailed') {
    return async (args: { submissionId: string }) => {
      if (submission?.id === args.submissionId) {
        submission = { ...submission, status: 'FAILED' }
        linkListeners.forEach((listener) => listener())
      }
      return { submissionId: args.submissionId, status: 'FAILED' }
    }
  }
  if (name === 'walletLink.createWalletChallenge') {
    return async (args: { address: string; origin: string }) => {
      if (params.get('server') === 'rate-limited') {
        throw new ConvexError('RATE_LIMITED')
      }
      const now = Date.now()
      const fields: WalletChallengeFields = {
        address: args.address,
        userId: 'qa-writer',
        networkPassphrase: Networks.TESTNET,
        origin: args.origin,
        nonce: crypto.randomUUID().replaceAll('-', ''),
        issuedAt: now,
        expiresAt: now + WALLET_CHALLENGE_TTL_MS,
      }
      const challengeId = `challenge-${challenges.size + 1}`
      challenges.set(challengeId, fields)
      return {
        challengeId,
        message: challengeMessage(fields),
        transactionXdr: challengeTransaction(fields).toXDR(),
        networkPassphrase: fields.networkPassphrase,
        expiresAt: fields.expiresAt,
      }
    }
  }
  if (name === 'walletLink.verifyWalletChallenge') {
    return async (args: {
      challengeId: string
      origin: string
      proof:
        | { kind: 'message'; signature: string }
        | { kind: 'transaction'; signedXdr: string }
    }) => {
      const fields = challenges.get(args.challengeId)
      challenges.delete(args.challengeId)
      if (!fields) return { ok: false, reason: 'CHALLENGE_USED' }
      window.__walletFixture.proofs.push(args.proof.kind)
      if (params.get('server') === 'address-in-use') {
        return { ok: false, reason: 'ADDRESS_IN_USE' }
      }
      const check = checkWalletProof(fields, args.proof)
      if (!check.ok) return { ok: false, reason: check.reason }
      link = {
        address: fields.address,
        state: 'verified',
        verifiedAt: Date.now(),
        networkPassphrase: Networks.TESTNET,
      }
      linkListeners.forEach((listener) => listener())
      return { ok: true, address: fields.address, verifiedAt: link.verifiedAt }
    }
  }
  return async () => {
    // `?server=remove-fails`: saving the profile fails, for the error state
    // of the address removal dialog.
    if (
      name === 'users.updateProfile' &&
      params.get('server') === 'remove-fails'
    )
      throw new Error('Couldn’t remove the address. Please try again.')
    // Anything else stays pending: nothing is recorded.
    return hold()
  }
}

/**
 * `?tips=1`: tip history for the signed-in reader, one record per receipt
 * state (#539): a confirmed tip sent with a note, a failed tip received with
 * an amount to review, and a pending passage tip, all recorded by the earlier
 * (v1) contracts; and a confirmed v2 tip. Testnet records only.
 */
const TIP_AT = Date.UTC(2026, 10, 20, 12)
const source = (slug: string, title: string) => ({
  title,
  slug,
  authorUsername: 'writer',
})
const TIPS: Record<string, unknown[]> = {
  'tips.getUserSentTips': [
    {
      _id: 'tip-sent',
      tipperId: 'qa-reader',
      authorId: 'qa-writer',
      authorName: 'Ada Lovelace',
      status: 'CONFIRMED',
      createdAt: TIP_AT,
      amountCents: 100,
      articleTitle: 'The quiet economics of attention',
      sourceArticle: source(
        'quiet-economics',
        'The quiet economics of attention'
      ),
      message: 'Thank you for this one.',
      stellarTxId: 'a'.repeat(64),
      stellarNetwork: 'TESTNET',
      stellarAmountXlm: '10.0000000',
      contractVersion: 'v1',
    },
    {
      _id: 'tip-sent-v2',
      tipperId: 'qa-reader',
      authorId: 'qa-writer',
      authorName: 'Ada Lovelace',
      status: 'CONFIRMED',
      createdAt: TIP_AT + 86_400_000,
      amountCents: 200,
      articleTitle: 'Reading in the margins',
      sourceArticle: source('reading-margins', 'Reading in the margins'),
      stellarTxId: 'c'.repeat(64),
      stellarNetwork: 'TESTNET',
      contractVersion: 'v2',
    },
  ],
  'tips.getUserReceivedTips': [
    {
      _id: 'tip-received',
      tipperId: 'qa-other',
      authorId: 'qa-reader',
      tipperName: 'Grace Hopper',
      status: 'FAILED',
      createdAt: TIP_AT - 86_400_000,
      amountCents: 250,
      amountUsdSuspicious: true,
      articleTitle: 'Notes on slow reading',
      sourceArticle: source('slow-reading', 'Notes on slow reading'),
      failureReason: 'The transaction was not found on Stellar testnet.',
      stellarTxId: 'b'.repeat(64),
      stellarNetwork: 'TESTNET',
      contractVersion: 'v1',
    },
  ],
  'highlightTips.getByTipper': [
    {
      _id: 'passage-sent',
      tipperId: 'qa-reader',
      authorId: 'qa-writer',
      authorName: 'Ada Lovelace',
      status: 'PENDING',
      createdAt: TIP_AT - 2 * 86_400_000,
      amountCents: 50,
      articleTitle: 'Why marginalia matter',
      sourceArticle: source('marginalia', 'Why marginalia matter'),
      highlightText: 'A margin is where a reader answers back.',
      highlightId: 'highlight-1',
      stellarNetwork: 'TESTNET',
      contractVersion: 'v1',
    },
  ],
  'highlightTips.getByAuthor': [],
}

export function useQuery(ref: unknown, args?: unknown) {
  const name = String(ref)
  const current = useSyncExternalStore(subscribeLink, () => link)
  // Re-read the tip record when it changes.
  useSyncExternalStore(subscribeLink, () => submission)
  if (args === 'skip') return undefined
  if (name === 'walletLink.getMyWalletLink') return current
  if (name === 'chain.config.getChainConfig') {
    return {
      network: 'TESTNET',
      chainEpoch: 'fixture',
      v2Enabled: true,
      coreContractId: CORE,
      tokenContractId: TOKEN,
      minTip: '1000000',
      paused: { core: false },
    }
  }
  // The wallet page reads the reader's tab for its tip history (#643); these
  // readers have none.
  if (name === 'tabs.getMyTab') return null
  if (name === 'tipsV2.getTipEligibility') return tipEligibility()
  if (name === 'tipsV2.getTipStatus') {
    return tipStatus((args as { submissionId: string }).submissionId)
  }
  return params.get('tips') === '1' ? TIPS[name] : undefined
}

// Signed in unless `?auth=out`; the spec signs out and in again through
// `window.__fixtureAuth`, as the header menu and the sign-in page would.
let signedIn = params.get('auth') !== 'out'
const authListeners = new Set<() => void>()
const subscribeAuth = (listener: () => void) => {
  authListeners.add(listener)
  return () => authListeners.delete(listener)
}
const setSignedIn = (next: boolean) => {
  signedIn = next
  authListeners.forEach((listener) => listener())
}
;(window as unknown as { __fixtureAuth: unknown }).__fixtureAuth = {
  signOut: () => setSignedIn(false),
  signIn: () => setSignedIn(true),
}

export function useAuth() {
  const isAuthenticated = useSyncExternalStore(subscribeAuth, () => signedIn)
  return {
    user: isAuthenticated
      ? { _id: 'qa-reader', username: 'reader', name: 'Reader' }
      : null,
    isAuthenticated,
    isLoading: false,
  }
}

export function useConvexAuth() {
  const isAuthenticated = useSyncExternalStore(subscribeAuth, () => signedIn)
  return { isAuthenticated, isLoading: false }
}

/**
 * lib/stellar/v2/chain-runtime stand-in: simulation succeeds, and the send
 * records the signed envelope, then holds. Nothing is submitted.
 */
export function v2Runtime() {
  return {
    config: {
      network: 'TESTNET',
      passphrase: Networks.TESTNET,
      rpcUrl: 'http://127.0.0.1:4177/rpc',
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
        balance: BigInt(300_000_000),
        numSubEntries: 0,
        ext: { type: 'v0' },
      }),
      simulateTransaction: async () => ({
        id: '1',
        latestLedger: 1,
        events: [],
        _parsed: true,
        transactionData: new SorobanDataBuilder(),
        minResourceFee: '100',
        result: { auth: [], retval: xdr.ScVal.scvVoid() },
      }),
      sendTransaction: async (tx: Transaction) => {
        window.__walletFixture.signedXdr = tx.toXDR()
        return hold()
      },
      getTransaction: async () => ({ status: 'NOT_FOUND' }),
    },
  }
}

export { READER }

/** The signed-in writer for `?view=dashboard`, with the linked address. */
export function fixtureUser() {
  return {
    _id: 'qa-writer',
    username: 'writer',
    name: 'Writer',
    stellarAddress: link.address ?? undefined,
  }
}

/** next/dynamic without Next: React.lazy behind Suspense. */
export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>
) {
  const Lazy = lazy(loader)
  return (props: P) =>
    createElement(Suspense, { fallback: null }, createElement(Lazy, props))
}
