/**
 * What the Add money, quick tips and turn off sheets need from the world:
 * the reader's balance and device, Stellar testnet, the wallet. One seam,
 * so the app passes the live services (`./live/services`, loaded with the
 * sheet) and a fixture passes an emulated wallet and chain. Types only.
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

/** A request built and simulated, before the wallet is asked. */
export type PreparedRequest = {
  /** The unsigned envelope, base64 XDR, exactly as it will be signed. */
  xdr: string
  /** Its hash, hex: what the signed envelope must match. */
  hash: string
  /** The network fee the envelope carries, stroops. */
  feeStroops: string
  /** Unix seconds: after this the network refuses it. */
  maxTime: number
  /** The deposit, stroops; "0" for quick tips alone or turn off. */
  amount: string
  /** The device approval it registers, if any. */
  key: { publicKey: string; validUntil: number; spendLimit: string } | null
  /** The ledger clock read when it was built, for the consent's date. */
  clock: LedgerClock
}

/** What the reader asked for. */
export type Operation =
  | {
      kind: 'add'
      amount: string
      withQuickTips: boolean
      balanceAfter: string
    }
  | { kind: 'quick-tips'; balance: string }
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
   * Asks the wallet to sign exactly `prepared`, then checks the signed
   * envelope is the one shown. Throws `StepError`.
   */
  sign(prepared: PreparedRequest, address: string): Promise<string>
  /** Sends a signed envelope; resolves its hash. Throws `StepError`. */
  send(signedXdr: string, prepared: PreparedRequest): Promise<string>
  /** Polls until the network has a result or the time bound passes. */
  poll(
    hash: string,
    maxTime: number,
    signal: AbortSignal
  ): Promise<'SUCCESS' | 'FAILED' | 'TIMEOUT'>
  /** Quilltip stops accepting tips under the key at once, before the
   * wallet confirms it on the network. Throws `StepError`. */
  stopKey(keyId: number): Promise<void>
  /** Client time, ms. */
  now(): number
}
