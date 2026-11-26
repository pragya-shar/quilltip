// Browser-only collaborators for the v2 article NFT fixture. They stand in
// for Convex and Stellar RPC, so the real NFT panel, transfer dialog, flow
// state machine, action runner, call encoder, wallet runtime and Wallets Kit
// run against an emulated wallet (e2e/helpers/varialEmulator.ts). Nothing is
// sent to a network and nothing is written to a backend.
import {
  createElement,
  lazy,
  Suspense,
  useSyncExternalStore,
  type ComponentType,
} from 'react'
import { ConvexError } from 'convex/values'
import {
  Account,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk'
import { bytesToHex } from '../../../lib/stellar/bytes'

export const ARTICLE_ID = 'k17nftv2fixturearticle'
export const AUTHOR_ID = 'u-writer'
export const NFT_ID = 'nft-v2-row'
export const NFT = 'CCOJOXITZQM7R6FSFPICN4Y3GONM4TN4Y6QV64CARDHNNRUT3U5SCYT7'
export const CORE = 'CAFCGOIM6SKVBWCPFQODN22MY5HUJEJMW5AOMNGAOVZ4QBLJJ5RLOOMS'
export const TAB = 'CBNBJ5PFFQ2XG3C7PQLPR3HA4ERHZ6FP3FUTYS3PXTZJZHRNZVDYTC45'
export const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
/** A Quilltip user, "@ada", with a verified wallet. */
export const ADA = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
/** A wallet outside Quilltip. */
export const OUTSIDE =
  'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR'
const KEY = 'c4'.repeat(32)
const THRESHOLD = '500000000'
const TX = 'a7'.repeat(32)

type FixtureLog = {
  prepared: Array<{ name: string; args: Record<string, unknown> }>
  submitted: Array<{ submissionId: string; txHash: string }>
  failed: Array<{ submissionId: string; reason: string; detail?: string }>
  signed: string[]
  eligibilityReads: number
}
declare global {
  interface Window {
    __nftFixture: FixtureLog
    __nftFixtureControl: {
      moveOwner: (to: string) => void
      setStatus: (id: string, patch: Record<string, unknown>) => void
    }
  }
}
window.__nftFixture = {
  prepared: [],
  submitted: [],
  failed: [],
  signed: [],
  eligibilityReads: 0,
}

const params = new URLSearchParams(location.search)
export const state = params.get('state') ?? 'author-eligible'
const server = params.get('server') ?? 'ok'
const confirm = params.get('confirm') ?? 'indexed'
const confirmDelay = Number(params.get('confirmDelay') ?? 600)
// `data=worst`: the longest values the schema allows (20-character
// usernames, the largest u32 token ID, a total far past the threshold);
// `data=empty`: nothing tipped yet.
const data = params.get('data') ?? 'demo'
const LONG_USER = 'bartholomew_fitzgera'
const TOKEN_ID = data === 'worst' ? 4_294_967_295 : 7

// A throwaway key for the emulated wallet: the article's author and, once
// minted, the owner in the owner states.
const fixtureKey = Keypair.random()
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
    window.__nftFixture.signed.push(tx.toXDR())
    return tx.toXDR()
  },
}

// --- Scenario -------------------------------------------------------------

/** The viewer: `viewer=author|owner|reader|other|signed-out` (default by state). */
export function viewerOf(): string {
  const explicit = params.get('viewer')
  if (explicit) return explicit
  if (state.startsWith('reader') || state === 'minted-outside') {
    return 'signed-out'
  }
  if (state.startsWith('not-owner')) return 'other'
  return 'author'
}

function progress(extra: Record<string, unknown> = {}) {
  return {
    state: 'NOT_MINTED',
    network: 'TESTNET',
    articleId: ARTICLE_ID,
    nftContractId: NFT,
    thresholdToken: XLM,
    threshold: THRESHOLD,
    total: '187500000',
    remaining: '312500000',
    reached: false,
    paused: false,
    tokenId: null as number | null,
    nftId: null as string | null,
    ownerAddress: null as string | null,
    configRefreshedAt: 1,
    chainArticleUpdatedAt: 1,
    ...extra,
  }
}

function mintedProgress(owner: string, extra: Record<string, unknown> = {}) {
  return progress({
    state: 'MINTED',
    total: null,
    threshold: null,
    remaining: null,
    reached: null,
    tokenId: TOKEN_ID,
    nftId: NFT_ID,
    ownerAddress: owner,
    ...extra,
  })
}

function v2Row(owner: string) {
  return {
    _id: NFT_ID,
    isMinted: true,
    contractVersion: 'v2',
    recordLabel: null,
    tokenId: String(TOKEN_ID),
    contractAddress: NFT,
    ownerAddress: owner,
    txHash: TX,
    mintedAt: '2026-11-20T10:00:00.000Z',
    ownerInfo:
      owner === WALLET
        ? { id: AUTHOR_ID, username: data === 'worst' ? LONG_USER : 'writer' }
        : owner === ADA
          ? { id: 'u-ada', username: 'ada' }
          : null,
  }
}

const v1Row = {
  _id: 'nft-v1-row',
  isMinted: true,
  contractVersion: 'v1',
  recordLabel: 'v1 record',
  tokenId: '3',
  mintedAt: '2025-06-01T10:00:00.000Z',
  owner: OUTSIDE,
  ownerInfo: { id: AUTHOR_ID, username: 'writer' },
  isEligible: true,
  totalTips: 2500,
  tipThreshold: 1000,
  transferCount: 0,
  rarity: 'rare',
}

function eligibility(stateName: string, extra: Record<string, unknown> = {}) {
  return {
    state: stateName,
    network: 'TESTNET',
    articleId: ARTICLE_ID,
    articleKey: KEY,
    nftContractId: NFT,
    coreContractId: CORE,
    thresholdToken: XLM,
    threshold: THRESHOLD,
    total: data === 'worst' ? '12345678901234567' : '512500000',
    remaining: '0',
    onChainAuthor: WALLET,
    callerAddress: WALLET,
    paused: false,
    tokenId: null,
    nftId: null,
    ownerAddress: null,
    openSubmissionId: null,
    retryAfterMs: null,
    checkedAt: Date.now(),
    ...extra,
  }
}

const below =
  data === 'empty'
    ? { total: '0', remaining: '500000000' }
    : data === 'worst'
      ? { total: '499999999', remaining: '1' }
      : { total: '187500000', remaining: '312500000' }

type Store = {
  config: { v2Enabled: boolean; paused: Record<string, boolean> }
  progress: ReturnType<typeof progress>
  record: unknown
  walletLink: unknown
  eligibility: ReturnType<typeof eligibility> | 'hold' | 'error'
  submissions: Map<string, Record<string, unknown>>
}

function initial(): Store {
  const verified = {
    address: WALLET,
    state: 'verified',
    verifiedAt: 1,
    networkPassphrase: Networks.TESTNET,
  }
  const base: Store = {
    config: { v2Enabled: true, paused: {} },
    progress: progress(),
    record: { isMinted: false },
    walletLink: verified,
    eligibility: eligibility('ELIGIBLE'),
    submissions: new Map(),
  }
  switch (state) {
    case 'v2-disabled':
      return {
        ...base,
        config: { v2Enabled: false, paused: {} },
        record: v1Row,
      }
    case 'reader-below':
      return { ...base, progress: progress(below) }
    case 'reader-unknown-threshold':
      return {
        ...base,
        progress: progress({ threshold: null, total: null, remaining: null }),
      }
    case 'reader-reached':
      return {
        ...base,
        progress: progress({
          total: '512500000',
          remaining: '0',
          reached: true,
        }),
      }
    case 'reader-not-registered':
    case 'author-not-registered':
      return { ...base, progress: progress({ state: 'NOT_REGISTERED' }) }
    case 'reader-v1-record':
      return { ...base, progress: progress(below), record: v1Row }
    case 'author-v1-record':
      return { ...base, record: v1Row }
    case 'author-checking':
      return { ...base, eligibility: 'hold' }
    case 'author-below':
      return {
        ...base,
        progress: progress(below),
        eligibility: eligibility('BELOW_THRESHOLD', {
          total: '187500000',
          remaining: '312500000',
        }),
      }
    case 'author-eligible':
      return base
    case 'author-paused':
      return {
        ...base,
        eligibility: eligibility('PAUSED', { paused: true }),
      }
    case 'author-no-wallet':
      return {
        ...base,
        walletLink: {
          ...verified,
          address: null,
          state: 'none',
          verifiedAt: null,
        },
        eligibility: eligibility('NO_WALLET', { callerAddress: null }),
      }
    case 'author-unverified':
      return {
        ...base,
        walletLink: { ...verified, state: 'unverified', verifiedAt: null },
        eligibility: eligibility('WALLET_NOT_VERIFIED', {
          callerAddress: null,
        }),
      }
    case 'author-other-wallet':
      return {
        ...base,
        eligibility: eligibility('AUTHOR_ADDRESS_MISMATCH', {
          onChainAuthor: OUTSIDE,
        }),
      }
    case 'author-unavailable':
      return { ...base, eligibility: eligibility('UNAVAILABLE') }
    case 'author-rate-limited':
      return {
        ...base,
        eligibility: eligibility('RATE_LIMITED', { retryAfterMs: 30_000 }),
      }
    case 'author-pending': {
      const s = new Map([['sub-open', status('mint', 'SUBMITTED')]])
      return {
        ...base,
        eligibility: eligibility('PENDING', { openSubmissionId: 'sub-open' }),
        submissions: s,
      }
    }
    case 'owner':
      return {
        ...base,
        progress: mintedProgress(WALLET),
        record: v2Row(WALLET),
      }
    case 'owner-paused':
      return {
        ...base,
        progress: mintedProgress(WALLET, { paused: true }),
        record: v2Row(WALLET),
      }
    case 'owner-v1-record':
      return {
        ...base,
        progress: mintedProgress(WALLET),
        record: v2Row(WALLET),
      }
    case 'not-owner':
      return {
        ...base,
        walletLink: { ...verified, address: OUTSIDE },
        progress: mintedProgress(WALLET),
        record: v2Row(WALLET),
      }
    case 'minted-outside':
      return {
        ...base,
        progress: mintedProgress(OUTSIDE),
        record: v2Row(OUTSIDE),
      }
    default:
      return base
  }
}

function status(
  action: 'mint' | 'transfer',
  value: string,
  extra: Record<string, unknown> = {}
) {
  return {
    submissionId: 'sub',
    action,
    status: value,
    txHash: value === 'PREPARED' ? null : TX,
    maxTime: Math.floor(Date.now() / 1000) + 300,
    mismatchReason: null,
    needsReview: false,
    canRetry: value === 'FAILED' || value === 'EXPIRED',
    indexed: false,
    nft: null,
    ...extra,
  }
}

let store = initial()

// The server keeps its records across a reload; so does this stand-in.
const SERVER_KEY = 'nft-v2-fixture-server'
try {
  const saved = sessionStorage.getItem(SERVER_KEY)
  if (saved) {
    for (const [id, record] of JSON.parse(saved) as Array<
      [string, Record<string, unknown>]
    >) {
      store.submissions.set(id, record)
    }
  }
} catch {
  // A fresh server.
}
function persist() {
  try {
    sessionStorage.setItem(
      SERVER_KEY,
      JSON.stringify([...store.submissions.entries()])
    )
  } catch {
    // Not kept across a reload.
  }
}

// A reload in the middle: `resume=mint:SUBMITTED` or `resume=transfer:PREPARED`
// seeds the stored submission ID and the server's record of it.
const resume = params.get('resume')
if (resume) {
  const [action, value] = resume.split(':') as ['mint' | 'transfer', string]
  const id = `sub-resume-${action}`
  try {
    localStorage.setItem(
      `qt:nft-v2:${action}:${action === 'mint' ? ARTICLE_ID : NFT_ID}`,
      id
    )
  } catch {
    // Storage blocked: the fixture still shows the server's open record.
  }
  store.submissions.set(
    id,
    status(action, value, {
      submissionId: id,
      ...(value === 'SUBMITTED' && params.get('slow') === '1'
        ? { maxTime: Math.floor(Date.now() / 1000) - 120 }
        : {}),
      ...(value === 'MISMATCH'
        ? { mismatchReason: 'field:to', needsReview: true }
        : {}),
    })
  )
}

const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function update(next: Partial<Store>) {
  store = { ...store, ...next }
  persist()
  listeners.forEach((listener) => listener())
}
function setStatus(id: string, patch: Record<string, unknown>) {
  const current = store.submissions.get(id)
  if (!current) return
  const submissions = new Map(store.submissions)
  submissions.set(id, { ...current, ...patch })
  update({ submissions })
}
window.__nftFixtureControl = {
  // A transfer made outside the app, once the indexer applies it.
  moveOwner: (to: string) =>
    update({
      progress: { ...store.progress, ownerAddress: to },
      record: v2Row(to),
    }),
  setStatus,
}

// --- Convex stand-ins -------------------------------------------------------

// `api.a.b.c` is a reference whose string form is "a.b.c".
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

export function useQuery(ref: unknown, args?: unknown) {
  const name = String(ref)
  const current = useSyncExternalStore(subscribe, () => store)
  if (args === 'skip') return undefined
  switch (name) {
    case 'chain.config.getChainConfig':
      return {
        network: 'TESTNET',
        chainEpoch: 'fixture',
        v2Enabled: current.config.v2Enabled,
        coreContractId: CORE,
        tabContractId: TAB,
        nftContractId: NFT,
        tokenContractId: XLM,
        paused: current.config.paused,
      }
    case 'nftsV2.getMintProgress':
      return current.progress
    case 'nfts.getNFTByArticle':
      return current.record
    case 'walletLink.getMyWalletLink':
      return viewerOf() === 'signed-out' ? null : current.walletLink
    case 'nftsV2.getNftSubmissionStatus': {
      const id = (args as { submissionId: string }).submissionId
      return current.submissions.get(id) ?? null
    }
    default:
      return undefined
  }
}

// Convex returns the same function for a reference on every render.
const actions = new Map<string, () => Promise<unknown>>()
const mutations = new Map<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
>()

export function useAction(ref: unknown) {
  const name = String(ref)
  const cached = actions.get(name)
  if (cached) return cached
  const fn = async () => {
    if (name !== 'nftsV2.getMintEligibility') return null
    window.__nftFixture.eligibilityReads += 1
    const e = store.eligibility
    if (e === 'hold') return new Promise(() => {})
    if (e === 'error') throw new Error('unavailable')
    return { ...e, checkedAt: Date.now() }
  }
  actions.set(name, fn)
  return fn
}

let counter = 0
const RECIPIENT_USERS: Record<string, string | null> = {
  ada: ADA,
  [LONG_USER]: ADA,
  nowallet: null,
}

function refuse(code: string, extra: Record<string, unknown> = {}): never {
  throw new ConvexError({ code, message: code, ...extra })
}

function settle(id: string, action: 'mint' | 'transfer', to?: string) {
  const apply = () => {
    switch (confirm) {
      case 'never':
        return
      case 'unindexed':
        setStatus(id, { status: 'CONFIRMED', indexed: false })
        return
      case 'mismatch':
        setStatus(id, {
          status: 'MISMATCH',
          mismatchReason: 'field:to',
          needsReview: true,
        })
        return
      case 'failed':
        setStatus(id, { status: 'FAILED', canRetry: true })
        return
      case 'expired':
        setStatus(id, { status: 'EXPIRED', canRetry: true })
        return
      default:
        // The indexer applies the event: the row and the owner change.
        if (action === 'mint') {
          update({
            progress: mintedProgress(WALLET),
            record: v2Row(WALLET),
          })
        } else if (to) {
          update({
            progress: { ...store.progress, ownerAddress: to },
            record: v2Row(to),
          })
        }
        setStatus(id, {
          status: 'CONFIRMED',
          indexed: true,
          nft: {
            nftId: NFT_ID,
            tokenId: TOKEN_ID,
            ownerAddress: action === 'mint' ? WALLET : to,
            contractId: NFT,
          },
        })
    }
  }
  setTimeout(apply, confirmDelay)
}

export function useMutation(ref: unknown) {
  const name = String(ref)
  const cached = mutations.get(name)
  if (cached) return cached
  const fn = async (args: Record<string, unknown>) => {
    if (name === 'nftsV2.prepareMint' || name === 'nftsV2.prepareTransfer') {
      window.__nftFixture.prepared.push({ name, args })
      if (server === 'prepare-hold') return new Promise(() => {})
      if (server.startsWith('prepare-error:')) {
        const code = server.slice('prepare-error:'.length)
        refuse(code, code === 'PENDING' ? { submissionId: 'sub-open' } : {})
      }
    }
    if (name === 'nftsV2.prepareMint') {
      const id = `sub-${++counter}`
      store.submissions.set(
        id,
        status('mint', 'PREPARED', { submissionId: id })
      )
      return {
        submissionId: id,
        existing: false,
        network: 'TESTNET',
        networkPassphrase:
          server === 'wrong-network' ? Networks.PUBLIC : Networks.TESTNET,
        contractId: NFT,
        maxTime: Math.floor(Date.now() / 1000) + 300,
        signer: WALLET,
        action: 'mint',
        method: 'mint',
        args: { article_id: KEY },
        articleId: ARTICLE_ID,
        articleKey: KEY,
      }
    }
    if (name === 'nftsV2.prepareTransfer') {
      const recipient = args.recipient as
        | { kind: 'address'; address: string }
        | { kind: 'user'; username: string }
      let to: string
      let username: string | null = null
      if (recipient.kind === 'user') {
        const handle = recipient.username.replace(/^@/, '').toLowerCase()
        if (!(handle in RECIPIENT_USERS)) refuse('RECIPIENT_NOT_FOUND')
        const address = RECIPIENT_USERS[handle]
        if (!address) refuse('RECIPIENT_NO_WALLET')
        to = address
        username = handle
      } else {
        to = recipient.address
        if (
          !StrKey.isValidEd25519PublicKey(to) &&
          !StrKey.isValidContract(to)
        ) {
          refuse('INVALID_RECIPIENT')
        }
        if ([NFT, CORE, TAB, XLM].includes(to)) refuse('INVALID_RECIPIENT')
      }
      if (to === WALLET) refuse('SELF_TRANSFER')
      const id = `sub-${++counter}`
      store.submissions.set(
        id,
        status('transfer', 'PREPARED', {
          submissionId: id,
          _to: server === 'swap' ? OUTSIDE : to,
        })
      )
      return {
        submissionId: id,
        existing: false,
        network: 'TESTNET',
        networkPassphrase: Networks.TESTNET,
        contractId: NFT,
        maxTime:
          Math.floor(Date.now() / 1000) +
          Number(params.get('reviewSeconds') ?? 300),
        signer: WALLET,
        action: 'transfer',
        method: 'transfer',
        // `swap` plays a server that prepared another recipient.
        args: {
          from: WALLET,
          to: server === 'swap' ? OUTSIDE : to,
          token_id: TOKEN_ID,
        },
        nftId: NFT_ID,
        tokenId: TOKEN_ID,
        recipient: {
          address: server === 'swap' ? OUTSIDE : to,
          userId: username ? `u-${username}` : null,
          username,
        },
      }
    }
    if (name === 'chain.submissions.recordSubmitted') {
      const { submissionId, txHash } = args as {
        submissionId: string
        txHash: string
      }
      window.__nftFixture.submitted.push({ submissionId, txHash })
      setStatus(submissionId, { status: 'SUBMITTED', txHash })
      const record = store.submissions.get(submissionId)
      settle(
        submissionId,
        record?.action === 'transfer' ? 'transfer' : 'mint',
        record?._to as string | undefined
      )
      return { status: 'SUBMITTED', duplicate: false }
    }
    if (name === 'chain.submissions.recordSendFailed') {
      const entry = args as {
        submissionId: string
        reason: string
        detail?: string
      }
      window.__nftFixture.failed.push(entry)
      setStatus(entry.submissionId, { status: 'FAILED', canRetry: true })
      return { status: 'FAILED' }
    }
    return null
  }
  mutations.set(name, fn)
  return fn
}

// --- v1 stand-ins (the v1 panel when v2 is off) ----------------------------

export function useNFTByArticle() {
  return store.record
}
export const useWalletActivation = () => ({ activateWallet: () => {} })
export const stellarClient = { getXLMPrice: async () => 0.2 }
export const nftClient = {}
export const InstallWalletDialog = () => null

// --- lib/stellar/v2/chain-runtime stand-in -----------------------------------

function errorEvent(contractId: string, code: number) {
  return {
    in_successful_contract_call: false,
    event: {
      contract_id: contractId,
      type: 'diagnostic',
      body: {
        v0: { topics: [{ symbol: 'error' }, { error: { contract: code } }] },
      },
    },
  }
}

function simulationError(contractId: string, code: number) {
  return {
    id: '1',
    latestLedger: 1,
    _parsed: true,
    events: [errorEvent(contractId, code)],
    error: `HostError: Error(Contract, #${code})`,
  }
}

const hold = () => new Promise<never>(() => {})

export function v2Runtime() {
  return {
    config: {
      network: 'TESTNET',
      passphrase: Networks.TESTNET,
      rpcUrl: 'http://127.0.0.1:4182/rpc',
      allowHttp: true,
      coreContractId: CORE,
      tabContractId: TAB,
      nftContractId: NFT,
      tokenContractId: XLM,
    },
    latestLedger: async () => 1_234_567,
    server: {
      getAccount: async (id: string) => new Account(id, '1'),
      simulateTransaction: async () => {
        if (server === 'simulate-hold') return hold()
        if (server === 'paused') return simulationError(NFT, 1000)
        if (server === 'below') return simulationError(NFT, 70)
        if (server === 'already-minted') return simulationError(NFT, 71)
        return {
          id: '1',
          latestLedger: 1,
          _parsed: true,
          events: [],
          transactionData: new SorobanDataBuilder(),
          minResourceFee: '0',
          result: { auth: [], retval: xdr.ScVal.scvVoid() },
        }
      },
      sendTransaction: async (tx: Transaction) => {
        if (server === 'send-hold') return hold()
        if (server === 'send-error') {
          return { status: 'ERROR', hash: bytesToHex(tx.hash()) }
        }
        return { status: 'PENDING', hash: bytesToHex(tx.hash()) }
      },
      getTransaction: async () => ({ status: 'NOT_FOUND' }),
    },
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
