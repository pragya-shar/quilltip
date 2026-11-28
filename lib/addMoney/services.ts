/**
 * What the Add money, quick tips and turn off sheets need from the world:
 * the reader's balance and device, Stellar testnet, the wallet. One seam,
 * so the app passes the live services (`./live/services`, loaded with the
 * sheet) and a fixture passes an emulated wallet and chain. Types only.
 *
 * Where the money comes from is the wallet steps only (`wallets`,
 * `connect`, `link`, `sign`): the amount, the review with its consent
 * line, the Added state and the return to the line read `Reading` and
 * `PreparedRequest` and do not know the source. A second source (an
 * account that needs no wallet) adds its own approve step beside `sign`.
 */
import type { DeviceKind } from './plan'

/** The latest ledger and when it closed (ms). */
export type LedgerClock = { sequence: number; closedAt: number }

/** One quick-tips approval on the balance, as the server lists it. */
export type DeviceKey = {
  keyId: number
  publicKey: string | null
  validUntilLedger: number
  revoked: boolean
  /** Stroops; null when the server does not return it. */
  spendLimit: string | null
  /** Stroops accepted under this key so far; null when not returned. */
  acceptedTotal: string | null
  /** This browser holds the key. */
  here: boolean
  /** This browser replaced it with a newer approval and deleted it. */
  retired: boolean
}

/** The reader's money as the sheets read it, reactive. */
export type Reading = {
  /** Null while signed out. */
  userId: string | null
  /** The wallet address linked to the account on this network, or null. */
  address: string | null
  /** `none`: no balance yet. `closing`: a withdrawal is under way. */
  status: 'none' | 'open' | 'closing'
  /** The balance on chain, in stroops. */
  confirmed: string
  /** What tips can still use: the balance less accepted tips not yet
   * paid, in stroops. */
  available: string
  /** One XLM in dollars, or null when no price is known. */
  priceUsd: number | null
  /** When the price was read (ms), or null. */
  priceAt: number | null
  /** Quilltip accepts tips from balances (deposits pause otherwise). */
  accepting: boolean
  keys: DeviceKey[]
  /** This device's quick tips, or null while it is read. */
  device: DeviceKind | null
  /** The key this device tips with, when it can. */
  deviceKeyId: number | null
  /** The indexer's latest ledger, for dates; null when unknown. */
  ledger: LedgerClock | null
}

export type WalletRow = {
  id: string
  name: string
  /** How it opens: an extension here, a web wallet, a phone app. */
  access: 'installed' | 'web' | 'mobile' | 'not-installed' | 'unavailable'
  /** The second line ("Opens albedo.link in a new window"). */
  howToUse: string
  icon?: string
  installUrl?: string
  unavailableReason?: string
}

export type WalletConnection = {
  address: string
  walletId: string
  walletName: string
}

/**
 * A balance call prepared and simulated, before anyone is asked to approve
 * it: what the review shows, from the request itself, never a constant.
 * The shape is shared with the passkey account (`BalanceSigner`): only
 * `payload` and who pays the fee differ.
 */
export type PreparedBalanceCall = {
  requestId: string
  call: 'open_session' | 'deposit' | 'register_key' | 'revoke_key'
  /** The balance contract, which the wallet names too. */
  contractId: string
  /** The deposit, stroops; "0" for quick tips alone or turn off. */
  amount: string
  /** The device approval it registers, if any. */
  key: { publicKey: string; validUntil: number; spendLimit: string } | null
  /** The ledger clock read when it was built, for the consent's date. */
  clock: LedgerClock
  /** The network fee, stroops, and who pays it. */
  fee: { stroops: string; paidBy: 'wallet' | 'quilltip' }
  /** Unix seconds: after this the network refuses it. */
  maxTime: number
  /**
   * `tx`: the unsigned envelope, base64 XDR, exactly as it will be signed,
   * and its hash (hex), which the signed envelope must match. `auth`: the
   * auth entries a passkey account signs (not built here).
   */
  payload:
    | { kind: 'tx'; xdr: string; hash: string }
    | {
        kind: 'auth'
        entries: { b64: string; contexts: number; expiration: number }[]
      }
}
/** The name the sheets use. */
export type PreparedRequest = PreparedBalanceCall

export type SignedBalanceCall =
  | { requestId: string; kind: 'tx'; signedXdr: string }
  | { requestId: string; kind: 'auth'; signedEntries: string[] }

/** What the reader asked for. */
export type Operation =
  | {
      kind: 'add'
      amount: string
      withQuickTips: boolean
      balanceAfter: string
      /** Today's price: the approval's cap is set in dollars ($50). */
      priceUsd: number | null
    }
  | { kind: 'quick-tips'; balance: string; priceUsd: number | null }
  | { kind: 'turn-off'; keyId: number }

/**
 * Why a step stopped. `cancelled`: the reader's choice (declined, closed the
 * window, Cancel, no answer in time). Every other kind is not a choice.
 */
export type StepFailure =
  | { kind: 'cancelled' }
  | { kind: 'popup-blocked'; wallet: string }
  | { kind: 'locked'; wallet: string }
  | { kind: 'wrong-network'; when: 'before' | 'after'; network: string | null }
  | { kind: 'unsupported'; wallet: string }
  | { kind: 'wrong-account'; expected: string; actual: string | null }
  | { kind: 'fee-too-high'; feeStroops: string; ceilingStroops: string }
  /** The prepared call is not one this browser can approve. */
  | { kind: 'not-ours' }
  | { kind: 'envelope-changed' }
  | { kind: 'offline' }
  /** The server or the network refused before anything was signed. */
  | { kind: 'refused'; message: string }
  /** Sent, and the network reported a failure. */
  | { kind: 'failed' }
  /** Sent, and not confirmed within the request's time bound. */
  | { kind: 'expired' }
  | { kind: 'wallet-failed'; message: string }

export class StepError extends Error {
  readonly failure: StepFailure
  constructor(failure: StepFailure) {
    super(failure.kind)
    this.name = 'StepError'
    this.failure = failure
  }
}

export type ChainFacts = {
  /** What the linked wallet can spend after its reserve; null if unknown. */
  spendable: string | null
  limits: { minDeposit: string; maxBalance: string } | null
}

export type AddMoneyServices = {
  /** The reader's money, reactive; undefined while loading. */
  useReading(): Reading | undefined
  /** The wallet's spendable funds and the contract's deposit limits. */
  facts(address: string): Promise<ChainFacts>
  /** The wallets this browser can use, in the picker's order. */
  wallets(): Promise<WalletRow[]>
  /** The wallet connected in this page, without a prompt. */
  connection(): WalletConnection | null
  /** Connects a wallet; throws `StepError`. */
  connect(walletId: string): Promise<WalletConnection>
  /** Ends a connection this sheet made. */
  disconnect(): Promise<void>
  /** Proves the connected wallet is the reader's and links it (a message,
   * or a transaction that is never sent). Throws `StepError`. */
  link(): Promise<string>
  /** Builds and simulates the request with the linked address as source:
   * no wallet is asked. Throws `StepError`. */
  prepare(op: Operation, address: string): Promise<PreparedRequest>
  /**
   * Loads what the approval needs (the wallet kit, the envelope checks)
   * while the review is read, so the press reaches the wallet with no
   * network wait: a wallet window must open inside the reader's tap, or
   * Safari blocks it.
   */
  warm(): Promise<void>
  /**
   * The approval (`BalanceSigner.approve`): asks the wallet to sign exactly
   * `prepared`, then checks the signed envelope is the one shown. Called
   * from the tap. Throws `StepError`.
   */
  approve(
    prepared: PreparedBalanceCall,
    address: string
  ): Promise<SignedBalanceCall>
  /** Sends a signed call; resolves its transaction hash. Throws
   * `StepError`. */
  submit(
    signed: SignedBalanceCall,
    prepared: PreparedBalanceCall
  ): Promise<string>
  /** Polls until the network has a result or the time bound passes. */
  poll(
    hash: string,
    maxTime: number,
    signal: AbortSignal
  ): Promise<'SUCCESS' | 'FAILED' | 'TIMEOUT'>
  /** Quilltip stops accepting tips under the key at once, before the
   * wallet confirms it on the network; this browser deletes the key if it
   * holds it. Throws `StepError`. */
  stopKey(keyId: number, address: string): Promise<void>
  /**
   * After a new approval is confirmed: this browser's older keys are
   * stopped in Quilltip and deleted here, so one browser never holds two
   * live approvals. No wallet step. Best effort; never throws.
   */
  retireOtherKeys(address: string, keepPublicKey: string): Promise<void>
  /** Client time, ms. */
  now(): number
}
