// Browser-only collaborators for the article tips fixture. They stand in for
// Convex, auth and Stellar RPC, so the real tips panel, action runner, call
// encoder, wallet runtime and Wallets Kit run against an emulated wallet.
// Nothing is sent to a network.
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
import { articleId, articleRef } from '../../../lib/stellar/v2/ids'
import { bytesToHex } from '../../../lib/stellar/bytes'

export const ARTICLE_ID = 'k17qafixturearticle'
export const CORE = 'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'
const OTHER = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const COAUTHOR = 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR'
const TX = 'a7'.repeat(32)

type FixtureLog = {
  prepared: Array<{ name: string; args: Record<string, unknown> }>
  submitted: Array<{ submissionId: string; txHash: string }>
  failed: Array<{ submissionId: string; reason: string; detail?: string }>
  signed: string[]
}
declare global {
  interface Window {
    __tipsFixture: FixtureLog
  }
}
window.__tipsFixture = { prepared: [], submitted: [], failed: [], signed: [] }

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'ready'
const server = params.get('server') ?? 'ok'

// A throwaway key for the emulated wallet (e2e/helpers/varialEmulator.ts).
const fixtureKey = Keypair.random()
const WALLET = fixtureKey.publicKey()
;(window as unknown as { __fixtureWallet: unknown }).__fixtureWallet = {
  address: WALLET,
  signMessage: (message: string) =>
    btoa(String.fromCharCode(...fixtureKey.signMessage(message))),
  signTransaction: (xdr: string) => {
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction
    tx.sign(fixtureKey)
    window.__tipsFixture.signed.push(tx.toXDR())
    return tx.toXDR()
  },
}

const REF = bytesToHex(articleRef(ARTICLE_ID))
const KEY = bytesToHex(articleId(WALLET, articleRef(ARTICLE_ID)))

// --- getRegistration stand-in -------------------------------------------

type Submission = {
  id: string
  kind: string
  status: string
  txHash: string | null
  maxTime: number
  needsReview: boolean
  mismatchReason: string | null
  lastError: string | null
  canRetry: boolean
}

function submission(kind: string, status: string, extra = {}): Submission {
  return {
    id: `sub-${kind}`,
    kind,
    status,
    txHash: status === 'PREPARED' ? null : TX,
    maxTime: Math.floor(Date.now() / 1000) + 300,
    needsReview: false,
    mismatchReason: null,
    lastError: null,
    canRetry: status === 'FAILED' || status === 'EXPIRED',
    ...extra,
  }
}

function row(
  status: string,
  extra: Partial<{
    authorAddress: string
    pendingAuthor: string | null
    contentVersion: number
    splits: Array<{ recipient: string; bps: number }>
  }> = {}
) {
  return {
    status,
    articleKey: KEY,
    authorAddress: WALLET,
    pendingAuthor: null,
    pendingAuthorLiveUntil: null,
    contentHash: 'ab'.repeat(32),
    contentVersion: 1,
    arweaveId: null,
    splits: [] as Array<{ recipient: string; bps: number }>,
    registeredLedger: status === 'REGISTERED' ? 1_234_567 : null,
    txHash: status === 'REGISTERED' ? TX : null,
    ...extra,
  }
}

function initial() {
  const base = {
    v2Enabled: true,
    network: 'TESTNET',
    published: true,
    wallet: { state: 'verified', address: WALLET as string | null },
    legacyAnchor: false,
    registration: null as ReturnType<typeof row> | null,
    submission: null as Submission | null,
    contentOutdated: false,
    payoutOutdated: false,
    canAccept: false,
  }
  switch (state) {
    case 'hidden':
      return { ...base, v2Enabled: false }
    case 'loading':
      return undefined
    case 'no-wallet':
      return { ...base, wallet: { state: 'none', address: null } }
    case 'unverified':
      return { ...base, wallet: { state: 'unverified', address: null } }
    case 'failed':
      return {
        ...base,
        registration: row('FAILED'),
        submission: submission('register', 'FAILED'),
      }
    case 'pending':
      return {
        ...base,
        registration: row('SUBMITTED'),
        submission: submission('register', 'SUBMITTED'),
      }
    case 'review':
      return {
        ...base,
        registration: row('FAILED'),
        submission: submission('register', 'MISMATCH', {
          needsReview: true,
          mismatchReason: 'field:content_hash',
        }),
      }
    case 'registered':
      return { ...base, registration: row('REGISTERED') }
    case 'registered-splits':
      return {
        ...base,
        registration: row('REGISTERED', {
          splits: [
            { recipient: WALLET, bps: 7_000 },
            { recipient: COAUTHOR, bps: 3_000 },
          ],
        }),
      }
    case 'outdated':
      return {
        ...base,
        registration: row('REGISTERED'),
        contentOutdated: true,
      }
    case 'move':
      // The article pays the connected wallet; the account's wallet changed.
      return {
        ...base,
        wallet: { state: 'verified', address: OTHER },
        registration: row('REGISTERED'),
        payoutOutdated: true,
      }
    case 'move-wrong-wallet':
      return {
        ...base,
        wallet: { state: 'verified', address: WALLET },
        registration: row('REGISTERED', { authorAddress: OTHER }),
        payoutOutdated: true,
      }
    case 'accept':
      return {
        ...base,
        registration: row('REGISTERED', {
          authorAddress: OTHER,
          pendingAuthor: WALLET,
        }),
        payoutOutdated: true,
        canAccept: true,
      }
    default:
      return base
  }
}

let registration = initial()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function update(next: typeof registration) {
  registration = next
  listeners.forEach((listener) => listener())
}

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

export function useQuery(ref: unknown) {
  const name = String(ref)
  const current = useSyncExternalStore(subscribe, () => registration)
  if (name === 'chain.articles.getRegistration') return current
  if (name === 'walletLink.getMyWalletLink') {
    return {
      address: WALLET,
      state: 'verified',
      verifiedAt: 1,
      networkPassphrase: Networks.TESTNET,
    }
  }
  return undefined
}

let submissionCounter = 0
const preparedKind: Record<string, string> = {
  'chain.articles.prepareRegistration': 'register',
  'chain.articles.prepareContentUpdate': 'content_update',
  'chain.articles.prepareAuthorProposal': 'author_propose',
  'chain.articles.prepareAuthorAccept': 'author_accept',
}

export function useMutation(ref: unknown) {
  const name = String(ref)
  return async (args: Record<string, unknown>) => {
    const kind = preparedKind[name]
    if (kind) {
      window.__tipsFixture.prepared.push({ name, args })
      if (server === 'prepare-error') {
        throw new ConvexError({
          code: 'WALLET_NOT_VERIFIED',
          message: 'Verify your receiving wallet first.',
        })
      }
      const current = registration!
      const signer =
        kind === 'author_propose'
          ? current.registration!.authorAddress
          : kind === 'register'
            ? WALLET
            : (current.wallet.address ?? WALLET)
      return {
        submissionId: `sub-${++submissionCounter}`,
        kind,
        contractId: CORE,
        networkPassphrase:
          server === 'wrong-network' ? Networks.PUBLIC : Networks.TESTNET,
        maxTime: Math.floor(Date.now() / 1000) + 300,
        signer,
        articleKey: KEY,
        articleRef: kind === 'register' ? REF : null,
        author: kind === 'register' ? WALLET : null,
        contentHash: kind === 'author_accept' ? null : 'ab'.repeat(32),
        arweaveId: null,
        splits:
          (args.splits as Array<{ recipient: string; bps: number }>) ?? [],
        newAuthor:
          kind === 'author_propose' || kind === 'author_accept'
            ? (current.wallet.address ?? WALLET)
            : null,
        liveUntilLedger: kind === 'author_propose' ? 1_354_567 : null,
        existing: false,
      }
    }
    if (name === 'chain.submissions.recordSubmitted') {
      const { submissionId, txHash } = args as {
        submissionId: string
        txHash: string
      }
      window.__tipsFixture.submitted.push({ submissionId, txHash })
      const current = registration!
      const last = window.__tipsFixture.prepared.at(-1)!
      const kind = preparedKind[last.name]!
      update({
        ...current,
        registration: current.registration ?? row('SUBMITTED'),
        submission: submission(kind, 'SUBMITTED', { txHash }),
      })
      // The indexer's event confirms it a moment later.
      setTimeout(
        () => {
          const now = registration!
          const confirmed = row('REGISTERED', {
            splits:
              (last.args.splits as Array<{ recipient: string; bps: number }>) ??
              now.registration?.splits ??
              [],
            contentVersion:
              (now.registration?.contentVersion ?? 1) +
              (kind === 'content_update' ? 1 : 0),
            authorAddress:
              kind === 'author_accept'
                ? (now.wallet.address ?? WALLET)
                : (now.registration?.authorAddress ?? WALLET),
            pendingAuthor:
              kind === 'author_propose' ? (now.wallet.address ?? null) : null,
          })
          update({
            ...now,
            registration: {
              ...confirmed,
              txHash: kind === 'register' ? txHash : TX,
            },
            submission: submission(kind, 'CONFIRMED', { txHash }),
            contentOutdated: false,
            payoutOutdated: kind !== 'author_accept' && now.payoutOutdated,
            canAccept: kind === 'author_propose',
          })
        },
        Number(params.get('confirmDelay') ?? 800)
      )
      return { status: 'SUBMITTED', duplicate: false }
    }
    if (name === 'chain.submissions.recordSendFailed') {
      window.__tipsFixture.failed.push(
        args as { submissionId: string; reason: string; detail?: string }
      )
      return { status: 'FAILED' }
    }
    return null
  }
}

export function useAuth() {
  return {
    user: { _id: 'qa-writer', username: 'writer', name: 'Writer' },
    isAuthenticated: true,
    isLoading: false,
  }
}

// --- lib/stellar/v2/chain-runtime stand-in ------------------------------

export function v2Runtime() {
  return {
    config: {
      network: 'TESTNET',
      passphrase: Networks.TESTNET,
      rpcUrl: 'http://127.0.0.1:4178/rpc',
      allowHttp: true,
      coreContractId: CORE,
      tabContractId: null,
      nftContractId: null,
      tokenContractId: null,
    },
    latestLedger: async () => 1_234_567,
    server: {
      getAccount: async (id: string) => new Account(id, '1'),
      simulateTransaction: async () => {
        const code =
          server === 'already-registered'
            ? 2
            : server === 'paused'
              ? 1000
              : null
        if (code !== null) {
          return {
            id: '1',
            latestLedger: 1,
            _parsed: true,
            error: `HostError: Error(Contract, #${code})`,
            // The raising contract, as RPC reports it in diagnostic events.
            events: [
              {
                event: {
                  contract_id: CORE,
                  body: {
                    v0: {
                      topics: [
                        { symbol: 'error' },
                        { error: { contract: code } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        }
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
      sendTransaction: async (tx: Transaction) =>
        server === 'send-error'
          ? { status: 'ERROR', hash: bytesToHex(tx.hash()) }
          : { status: 'PENDING', hash: bytesToHex(tx.hash()) },
      getTransaction: async () => ({ status: 'NOT_FOUND' }),
    },
  }
}

export const stellarClient = {}

/** next/dynamic without Next: React.lazy behind Suspense. */
export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>
) {
  const Lazy = lazy(loader)
  return (props: P) =>
    createElement(Suspense, { fallback: null }, createElement(Lazy, props))
}
