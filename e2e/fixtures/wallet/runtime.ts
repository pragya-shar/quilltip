// Browser-only collaborators for the wallet fixture. They stand in for Convex,
// auth and the Stellar RPC client so the real wallet runtime, Wallets Kit and
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
  Operation,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk'
import {
  WALLET_CHALLENGE_TTL_MS,
  challengeMessage,
  challengeTransaction,
  checkWalletProof,
  type WalletChallengeFields,
} from '../../../convex/lib/walletChallenge'

/** Records what reached the backend stand-ins, for assertions. */
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

// `api.x.y` resolves to the string "x.y".
export const api: unknown = new Proxy(
  {},
  {
    get: (_, mod: string) =>
      new Proxy({}, { get: (_, fn: string) => `${mod}.${fn}` }),
  }
)

const hold = () => new Promise<never>(() => {})

export function useConvex() {
  return {
    query: async (name: string) => {
      if (name === 'tips.canTip') return { allowed: true, waitSec: 0 }
      if (name === 'xlmPrice.getCachedXlmPrice') return { price: 0.1 }
      return null
    },
  }
}

export function useMutation(name: string) {
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
    if (name === 'tips.prepareArticleTip') {
      window.__walletFixture.prepared += 1
      return {
        stellarNetwork: 'TESTNET',
        articleSymbol: 'qa_article',
        authorAddress: AUTHOR,
        amountStroops: '10000000',
        amountCents: 10,
        contractId: 'C' + 'A'.repeat(55),
        intentId: 'qa-intent',
        timeBounds: {
          minTime: 0,
          maxTime: Math.floor(Date.now() / 1000) + 300,
        },
      }
    }
    // Registration and verification stay pending: nothing is submitted.
    return hold()
  }
}

/**
 * `?tips=1`: tip history for the signed-in reader, one record per receipt
 * state (#539): a confirmed tip sent with a note, a failed tip received with
 * an amount to review, and a pending passage tip. Testnet records only.
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
    },
  ],
  'highlightTips.getByAuthor': [],
}

export function useQuery(name: string) {
  const current = useSyncExternalStore(subscribeLink, () => link)
  if (name === 'walletLink.getMyWalletLink') return current
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

export const stellarClient = {
  async buildTipTransaction(source: string) {
    const tx = new TransactionBuilder(new Account(source, '1'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.manageData({ name: 'qa-fixture', value: 'tip' }))
      .setTimeout(300)
      .build()
    return { xdr: tx.toXDR() }
  },
  async deriveTipTransactionHash(signedXdr: string) {
    window.__walletFixture.signedXdr = signedXdr
    return 'f'.repeat(64)
  },
  submitTipTransaction: hold,
  getXLMPrice: async () => 0.1,
  getXLMPriceData: async () => ({ price: 0.1, change24h: 0 }),
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
