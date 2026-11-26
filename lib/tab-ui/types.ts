/**
 * Shapes shared by the tab screens (issue #449): what the screens read from
 * Convex and the chain, and the `TabServices` seam that supplies them. The
 * app passes live services (Convex, the wallet, Stellar RPC); the fixture
 * suite passes stand-ins. Type-only imports, so this file adds no code to a
 * bundle.
 */
import type { FunctionReturnType } from 'convex/server'
import type { api } from '@/convex/_generated/api'
import type { WalletGateState } from '@/lib/payments/ui-state'
import type {
  PreparedTabTip,
  SessionKeyStore,
  SignTabTipDeps,
  SubmitTipArgs,
  SubmittedTabTip,
} from '@/lib/stellar/v2/tab'
import type { PollResult, TxOutcome, TxStep } from '@/lib/stellar/v2/tx'

export type MyTab = NonNullable<FunctionReturnType<typeof api.tabs.getMyTab>>
export type MyTabTips = NonNullable<
  FunctionReturnType<typeof api.tabActivity.getMyTabTips>
>
export type TabTipRow = MyTabTips['tips'][number]
export type MyTabEarnings = NonNullable<
  FunctionReturnType<typeof api.tabActivity.getMyTabEarnings>
>
export type ChainConfigView = FunctionReturnType<
  typeof api.chain.config.getChainConfig
>

/** What every `tabs.prepare*` operation returns. */
export type OperationContext = {
  tabContractId: string
  tokenContractId: string
  readerAddress: string
  networkPassphrase: string
  currentLedger: number
}

export type KeyParams = {
  /** Lowercase hex of the 32-byte ed25519 public key. */
  publicKey: string
  validUntil: number
  /** Base units. */
  spendLimit: string
  extractable: boolean
}

/**
 * A Tab contract call in plain values. The live services encode it with the
 * generated Tab bindings; amounts are base-unit strings.
 */
export type TabCall =
  | {
      method: 'open_session'
      amount: string
      key: Omit<KeyParams, 'extractable'>
    }
  | { method: 'deposit'; amount: string }
  | { method: 'register_key'; key: Omit<KeyParams, 'extractable'> }
  | { method: 'revoke_key'; keyId: number }
  | { method: 'withdraw_start' }
  | { method: 'withdraw' }
  | { method: 'claim' }

export type TabCallRequest = {
  call: TabCall
  /** The reader (or, for `claim`, the writer): signer and transaction source. */
  source: string
  tabContractId: string
  networkPassphrase: string
  /** Unix seconds. */
  maxTime: number
}

/** The latest ledger and when it closed, for ledger-based dates. */
export type LedgerClock = { sequence: number; closedAt: number }

/** What the wallet can spend: balance minus the account reserve. */
export type WalletFunds = {
  balance: string
  reserve: string
  spendable: string
}

/** The Tab contract's deposit limits (`config()`). */
export type TabLimits = { minDeposit: string; maxBalance: string }

/** The wallet and account standing between the user and a signed call. */
export type WalletAccess = {
  gate: WalletGateState
  /** The verified linked address, when there is one. */
  address: string | null
  /** The wallet prompt for the current action is open. */
  busy?: boolean
  onSignIn?: () => void
  onInstall?: () => void
  onConnect?: () => void
  onRecheck?: () => void
  verifyHref?: string
}

/** The client's own network and Tab contract, never taken from a response. */
export type TabClientConfig = { networkPassphrase: string; tabContractId: string }

export type TabServices = {
  /** Null when payments v2 or the Tab contract is not configured here. */
  config(): TabClientConfig | null
  // Reactive reads. `undefined` while loading, `null` when there is none.
  useMyTab(): MyTab | null | undefined
  useMyTabTips(): MyTabTips | null | undefined
  useMyTabEarnings(): MyTabEarnings | null | undefined
  useChainConfig(): ChainConfigView | undefined
  useWalletAccess(): WalletAccess

  // Convex mutations (convex/tabs.ts). They throw `ConvexError` refusals.
  prepareOpen(args: KeyParams & { amount: string }): Promise<OperationContext>
  prepareDeposit(args: { amount: string }): Promise<OperationContext>
  prepareRegisterKey(args: KeyParams): Promise<OperationContext>
  prepareRevokeKey(args: { keyId: number }): Promise<OperationContext>
  prepareWithdrawStart(): Promise<OperationContext>
  prepareWithdraw(): Promise<
    OperationContext & { withdrawUnlockLedger: number | null }
  >
  prepareTip(args: {
    requestId: string
    articleId: string
    amountCents: number
    keyId: number
    highlight?: TabTipHighlight | null
  }): Promise<PreparedTabTip>
  submitTip(args: SubmitTipArgs): Promise<SubmittedTabTip>

  // Stellar.
  latestLedger(): Promise<LedgerClock>
  walletFunds(address: string): Promise<WalletFunds | null>
  tabLimits(): Promise<TabLimits | null>
  claimable(address: string): Promise<string>
  /** Builds, simulates, has the wallet sign, and sends (spec 6.1). */
  send(
    request: TabCallRequest,
    onStep?: (step: TxStep) => void
  ): Promise<TxOutcome>
  /** UI-only polling until a result or `maxTime + 30 s`. */
  poll(hash: string, maxTime: number, signal?: AbortSignal): Promise<PollResult>

  // Session keys (the real library in the app and in the fixture).
  keyStore(): SessionKeyStore
  signingDeps(readerAddress: string): SignTabTipDeps
  /** Server time offset is unknown; this is the device clock. */
  now(): number
  newRequestId(): string
}

export type TabTipHighlight = {
  text: string
  startOffset: number
  endOffset: number
  startContainerPath?: string
  endContainerPath?: string
}
