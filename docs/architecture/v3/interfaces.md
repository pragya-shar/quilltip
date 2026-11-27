# I. Interfaces

The contracts between packages. P0 commits the types in I1 and I2 and the
fake session in I4 before any other package starts, so UI sessions and logic
sessions build against the same shapes. A change to anything here is a
change to this document first.

## I1. View models

`lib/payments/types.ts` (owner P0). Plain data; no React, no Convex imports
except `Id`.

```ts
import type { Id } from '@/convex/_generated/dataModel'

/** Integer US cents. */
export type Cents = number
/** Decimal integer string of a token's smallest unit. */
export type BaseUnits = string
/** Registry id: 'xlm', 'usdc', … ([document 6](06-assets.md)). */
export type TokenId = string

export type Money = { cents: Cents; display: string } // display: "$4.20"

export type PassageRef = {
  text: string
  startOffset: number
  endOffset: number
  startContainerPath?: string
  endContainerPath?: string
}

export type TipTarget =
  | { kind: 'article'; articleId: Id<'articles'> }
  | { kind: 'passage'; articleId: Id<'articles'>; passage: PassageRef }

export type BlockedReason =
  | 'signed-out'
  | 'own-article'
  | 'not-tippable'
  | 'paused'

export type FundingOption =
  | 'add-funds'
  | 'pay-from-wallet'
  | 'connect-wallet'
  | 'create-account'

export type TipRoute =
  | { kind: 'balance'; token: TokenId; setupDevice: boolean }
  | { kind: 'wallet'; token: TokenId; address: string }
  | { kind: 'needs-funds'; shortBy: Money; options: FundingOption[] }
  | { kind: 'blocked'; reason: BlockedReason }

export type SettlementState = 'accepted' | 'on-chain' | 'in-wallet' | 'not-paid'

export type TipErrorCode = string // one of BALANCE_ERROR_CODES or TIP_V2_ERROR_CODES

export type TipPhase =
  | { phase: 'idle' }
  | { phase: 'routed'; route: TipRoute; amount: Money }
  | { phase: 'device-setup'; step: 'approve' | 'confirming' }
  | { phase: 'sending'; requestId: string; amount: Money }
  | { phase: 'undoable'; tipId: string; amount: Money; until: number }
  | {
      phase: 'sent'
      tipId: string
      amount: Money
      via: 'balance' | 'wallet'
      settlement: SettlementState
    }
  | { phase: 'undone'; amount: Money }
  | { phase: 'confirm-wallet'; amount: Money; address: string }
  | { phase: 'signing'; amount: Money }
  | { phase: 'submitted'; tipId: string; amount: Money }
  | {
      phase: 'funding'
      step: 'amount' | 'approve' | 'confirming'
      deposit: Money
      queued: Money | null
    }
  | { phase: 'failed'; code: TipErrorCode; retry: 'same' | 'reroute' | 'none' }
  | { phase: 'blocked'; reason: BlockedReason }

export type TipResult =
  | { ok: true; tipId: string; via: 'balance' | 'wallet' }
  | { ok: false; code: TipErrorCode }

export type BalanceView = {
  status: 'loading' | 'signed-out' | 'none' | 'ready' | 'closing'
  available: Money
  /** Accepted and not yet on chain; for detail views only. */
  pending: Money
  byToken: Array<{
    token: TokenId
    available: BaseUnits
    availableCents: Cents
  }>
  /** True while the first frame shows the stored snapshot. */
  stale: boolean
  /** This device can tip from the balance without a prompt. */
  deviceReady: boolean
  limits: {
    perTip: Money
    dailyLeft: Money
    defaultTip: Money
    quickTipMax: Money
  }
  network: 'testnet'
}

export type ActivityItem = {
  id: string
  role: 'reader' | 'writer'
  counterparty: { name: string; username?: string; avatarUrl?: string }
  article: { title: string; slug: string }
  passage?: string
  amount: Money
  via: 'balance' | 'wallet' | 'agent'
  status: 'sending' | 'sent' | 'on-chain' | 'in-wallet' | 'not-paid' | 'failed'
  at: number
  txHash?: string
}

export type ActivityView = {
  items: ActivityItem[]
  status: 'loading' | 'ready' | 'exhausted'
  loadMore(): void
}

export type EarningsView = {
  status: 'loading' | 'none' | 'ready'
  total: Money
  onTheWay: Money
  inWallet: Money
  toCollect: Money
  tipCount: number
  supporterCount: number
}

export type DeviceView = {
  keyId: number
  label: string
  thisDevice: boolean
  lastUsedAt: number | null
  expiresAt: number
}

export type WalletView =
  | { status: 'none' }
  | { status: 'known'; address: string; kind: WalletKind }
  | { status: 'signing'; address: string; kind: WalletKind }

export type WalletKind = 'extension' | 'walletconnect' | 'injected' | 'passkey'
```

## I2. Headless hooks

Hooks return view models only. The UI track never imports Convex, the wallet
kit or `lib/stellar` directly.

The hook files are thin readers of one React context, `PaymentsRuntime`
(`lib/payments/runtime.ts`), so the fake (I4) and the live runtime are
swapped by the provider, not by editing hooks. P0 writes the context, the
hook files and the fake. P3 and P6 write the live runtime parts.

```ts
export type PaymentsRuntime = {
  useSession(): SessionState
  useWalletLink(): WalletLink
  useDevices(): DevicesController
  useBalance(): BalanceView
  useTip(target: TipTarget): TipController
  useAddFunds(): AddFundsController
  useActivity(role: 'reader' | 'writer'): ActivityView
  useEarnings(): EarningsView
}
```

| Hook (file owner P0) | File                             | Live implementation (owner)          | Returns              |
| -------------------- | -------------------------------- | ------------------------------------ | -------------------- |
| `useSession()`       | `hooks/session/useSession.ts`    | `lib/session/live.ts` (P6)           | `SessionState`       |
| `useWalletLink()`    | `hooks/session/useWalletLink.ts` | `lib/session/live.ts` (P6)           | `WalletLink`         |
| `useDevices()`       | `hooks/session/useDevices.ts`    | `lib/session/live.ts` (P6)           | `DevicesController`  |
| `useBalance()`       | `hooks/payments/useBalance.ts`   | `lib/payments/live/balance.ts` (P3)  | `BalanceView`        |
| `useTip(target)`     | `hooks/payments/useTip.ts`       | `lib/payments/live/tip.ts` (P3)      | `TipController`      |
| `useAddFunds()`      | `hooks/payments/useAddFunds.ts`  | `lib/payments/live/funds.ts` (P3)    | `AddFundsController` |
| `useActivity(role)`  | `hooks/payments/useActivity.ts`  | `lib/payments/live/activity.ts` (P3) | `ActivityView`       |
| `useEarnings()`      | `hooks/payments/useEarnings.ts`  | `lib/payments/live/earnings.ts` (P3) | `EarningsView`       |

`SessionProvider` (P6) composes the live runtime from P3's and P6's parts and
provides it. `FakePaymentsProvider` (P0) provides the fake.

```ts
export type WalletLink = {
  wallet: WalletView
  connect(): Promise<boolean>
  forget(): void
}
export type DevicesController = {
  devices: DeviceView[]
  forget(keyId: number): Promise<void>
}
export type AddFundsController = {
  state: {
    phase: 'idle' | 'amount' | 'approve' | 'confirming' | 'done' | 'failed'
    code?: string
  }
  start(amountCents: Cents): Promise<boolean>
  cancel(): void
}
```

```ts
export type SessionState = {
  auth: 'loading' | 'signed-out' | 'signed-in'
  userId: Id<'users'> | null
  accountAddress: string | null
  wallet: WalletView
  device: {
    status: 'loading' | 'none' | 'ready' | 'expiring' | 'unavailable'
    keyId: number | null
  }
}

export type TipController = {
  state: TipPhase
  /** Synchronous; recomputed when the session or the target changes. */
  quote(amountCents: Cents): TipRoute
  /** The default amount when omitted. Runs the route `quote` returns. */
  tip(amountCents?: Cents): Promise<TipResult>
  payFromWallet(): Promise<TipResult>
  addFundsAndTip(depositCents: Cents): Promise<TipResult>
  undo(): Promise<boolean>
  reset(): void
}
```

`lib/payments/tip.ts` exports the pure orchestrator the hook wraps:

```ts
export function tip(
  input: { target: TipTarget; amountCents: Cents },
  deps: TipDeps,
  onPhase: (phase: TipPhase) => void
): Promise<TipResult>

export type TipDeps = {
  route(amountCents: Cents): TipRoute
  sendFromBalance(args: BalanceSendArgs): Promise<BalanceSendResult>
  signBalanceTip(args: SignBalanceTipArgs): Promise<SignedBalanceTip> // P5's library
  setupDevice(): Promise<void> // P6
  payFromWallet(args: WalletTipArgs): Promise<WalletTipResult> // P3 over tipsV2
  addFunds(amountCents: Cents): Promise<void> // P3 over balance deposit
  outbox: Outbox // P6
  newRequestId(): string
  now(): number
}
```

## I3. Convex functions

Owner P5 unless marked. Validators are given in the form the code uses.

### `convex/balance.ts`

```ts
export const session = query({
  args: {},
  returns: v.union(v.null(), sessionValidator), // null when signed out
})

const sessionValidator = v.object({
  userId: v.id('users'),
  accountAddress: v.union(v.string(), v.null()),
  network: v.literal('testnet'),
  status: v.union(v.literal('none'), v.literal('open'), v.literal('closing')),
  tokens: v.array(v.object({
    token: v.string(),                  // registry id
    contractId: v.string(),
    confirmed: v.string(),
    outstanding: v.string(),
    reserved: v.string(),
    available: v.string(),
    availableCents: v.number(),
  })),
  availableCents: v.number(),
  pendingCents: v.number(),
  limits: v.object({
    perTipCents: v.number(),
    dailyCents: v.number(),
    acceptedTodayCents: v.number(),
    quickTipMaxCents: v.number(),
    defaultTipCents: v.number(),
  }),
  prices: v.array(v.object({ token: v.string(), usd: v.number(), at: v.number() })),
  devices: v.array(v.object({
    keyId: v.number(),
    publicKey: v.string(),
    label: v.string(),
    validUntilLedger: v.number(),
    revoked: v.boolean(),
    lastUsedAt: v.union(v.number(), v.null()),
  })),
  wallet: v.union(v.null(), v.object({ address: v.string(), verifiedAt: v.number() })),
  ledger: v.object({ sequence: v.number(), closedAt: v.number() }),
  settlement: v.object({ enabled: v.boolean() }),
})

export const tipContext = query({
  args: { articleId: v.id('articles'), keyId: v.optional(v.number()), token: v.optional(v.string()) },
  returns: v.object({
    tippable: v.boolean(),
    reason: v.union(v.null(), v.string()),   // BlockedReason or a TIP_V2 eligibility reason
    ownArticle: v.boolean(),
    articleKey: v.union(v.string(), v.null()),
    contentHash: v.union(v.string(), v.null()),
    writerAddress: v.union(v.string(), v.null()),
    recipientCount: v.number(),
    acceptedTokens: v.array(v.string()),
    minTip: v.array(v.object({ token: v.string(), baseUnits: v.string() })),
    pair: v.union(v.null(), v.object({
      seq: v.number(), segment: v.number(), cumulative: v.string(), leafHashes: v.array(v.string()),
    })),
  }),
})

export const send = mutation({
  args: {
    requestId: v.string(),
    articleId: v.id('articles'),
    highlight: v.union(highlightValidator, v.null()),
    token: v.string(),
    keyId: v.number(),
    amountCents: v.number(),
    priceAt: v.number(),
    receipt: receiptValidator,   // v2 shape plus `segment`; the token is the Tab's
    signature: v.string(),
  },
  returns: v.object({
    status: v.literal('ACCEPTED'),
    tipId: v.string(),
    receiptId: v.id('tabReceipts'),
    undoUntil: v.number(),
    alreadyAccepted: v.boolean(),
  }),
  // Throws ConvexError { code: BALANCE_ERROR_CODES[number], message, data? }
})

export const undo = mutation({ args: { tipId: v.string() }, returns: v.object({ undone: v.boolean() }) })

export const prepareDeposit = mutation({
  args: {
    token: v.string(),
    amountBaseUnits: v.string(),
    newKey: v.optional(v.object({ publicKey: v.string(), validUntil: v.number(), label: v.string(), extractable: v.boolean() })),
  },
  returns: v.object({
    method: v.union(v.literal('deposit'), v.literal('open_session')),
    tabContractId: v.string(), tokenContractId: v.string(), readerAddress: v.string(),
    networkPassphrase: v.string(), currentLedger: v.number(),
  }),
})

export const prepareDevice = mutation({        // register_key for a new device
  args: { publicKey: v.string(), validUntil: v.number(), label: v.string(), extractable: v.boolean() },
  returns: /* same as prepareDeposit without method */,
})

export const recordTransaction = mutation({
  args: { txHash: v.string(), kind: v.union(v.literal('deposit'), v.literal('open_session'),
          v.literal('register_key'), v.literal('revoke_key'), v.literal('withdraw_now'),
          v.literal('withdraw_start'), v.literal('withdraw')) },
  returns: v.object({ recorded: v.boolean() }),
})

export const forgetDevice = mutation({ args: { keyId: v.number() }, returns: v.null() })

export const prepareWithdraw = mutation({
  args: { token: v.string(), amountBaseUnits: v.string() },
  returns: v.object({ nonce: v.string(), validUntil: v.number(), acceptor: v.string(),
                      signature: v.string(), tabContractId: v.string(), tokenContractId: v.string() }),
})
```

`BALANCE_ERROR_CODES` (exported from `convex/lib/chain/balanceErrors.ts`):
`BALANCE_UNAUTHENTICATED`, `BALANCE_NO_ACCOUNT`, `BALANCE_CLOSING`,
`BALANCE_SETTLEMENT_OFF`, `BALANCE_PAUSED`, `BALANCE_TARGET_CHANGED`,
`BALANCE_NOT_TIPPABLE`, `BALANCE_SELF_TIP`, `BALANCE_SPLITS`,
`BALANCE_KEY_UNKNOWN`, `BALANCE_KEY_REVOKED`, `BALANCE_KEY_EXPIRED`,
`BALANCE_BELOW_MINIMUM`, `BALANCE_TIP_MAX`, `BALANCE_DAILY_MAX`,
`BALANCE_OVER_AVAILABLE`, `BALANCE_PAIR_CHANGED`, `BALANCE_PRICE_CHANGED`,
`BALANCE_INVALID_SIGNATURE`, `BALANCE_RECEIPT_MISMATCH`,
`BALANCE_DUPLICATE_REQUEST`, `BALANCE_ACCEPTOR_MISMATCH`, `BALANCE_TOKEN_NOT_ACCEPTED`.

### `convex/activity.ts` and `convex/earnings.ts` (P5)

```ts
export const mine = query({   // activity.mine
  args: { role: v.union(v.literal('reader'), v.literal('writer')), paginationOpts: paginationOptsValidator },
  returns: /* PaginationResult of activityItemValidator (ActivityItem without Money.display) */,
})

export const mine = query({   // earnings.mine
  args: {},
  returns: v.union(v.null(), v.object({
    totalCents: v.number(), onTheWayCents: v.number(), inWalletCents: v.number(),
    toCollectCents: v.number(), tipCount: v.number(), supporterCount: v.number(),
    toCollect: v.array(v.object({ token: v.string(), baseUnits: v.string() })),
  })),
})
```

`Money.display` is formatted on the client (`lib/payments/money.ts`, P0).

### Cross-package internal functions

| Function                                                                       | Owner | Called by | Signature                                                                                                  |
| ------------------------------------------------------------------------------ | ----- | --------- | ---------------------------------------------------------------------------------------------------------- |
| `requestSettlement(ctx, now)`                                                  | P2    | P5        | `(ctx: MutationCtx, now: number) => Promise<void>` in `convex/lib/chain/settleSchedule.ts`                 |
| `internal.chain.indexer.kick`                                                  | P4    | P2, P4    | `internalMutation({ args: {}, returns: v.null() })`                                                        |
| `scheduleVerification(ctx, submissionId)`                                      | P4    | P5        | `(ctx: MutationCtx, id: Id<'chainSubmissions'>) => Promise<void>` in `convex/lib/chain/submissionStore.ts` |
| `writeActivity(ctx, row)`, `updateActivity(ctx, tip, patch)`                   | P5    | P4        | `convex/lib/activity.ts`                                                                                   |
| `adjustEarningsCents(ctx, { userId, incoming?, pending?, earned?, paidOut? })` | P5    | P2, P4    | `convex/lib/earnings.ts`                                                                                   |
| `applySettlementOutcomes(ctx, settlementId, result)`                           | P5    | P2        | replaces the ledger half of v2 `finishSettlement`; P2 keeps the record half                                |

### Client libraries

| Function                                                                                    | Owner | File                                |
| ------------------------------------------------------------------------------------------- | ----- | ----------------------------------- |
| `signBalanceTip(args): Promise<SignedBalanceTip>`                                           | P5    | `lib/stellar/v2/tab/sign-tip.ts`    |
| `commitAcceptedTip(accepted, deps)`, `commitUndo(tipId, deps)`                              | P5    | `lib/stellar/v2/tab/sign-tip.ts`    |
| `createSessionKeyStore()` (v2, unchanged API)                                               | P5    | `lib/stellar/v2/tab/session-key.ts` |
| `WalletProvider` interface and the `extension`, `walletconnect`, `injected` implementations | P6    | `lib/wallet/`                       |
| `routeTip(input): TipRoute`                                                                 | P3    | `lib/payments/route.ts`             |
| `formatMoney(cents): string`                                                                | P0    | `lib/payments/money.ts`             |

```ts
export type SignBalanceTipArgs = {
  scope: { tabContractId: string; readerAddress: string }
  keyId: number
  token: { id: TokenId; contractId: string }
  writerAddress: string
  articleKey: string
  contentHash: string
  highlightKey: string | null
  amountBaseUnits: BaseUnits
  requestId: string
  pair: {
    seq: number
    segment: number
    cumulative: BaseUnits
    leafHashes: string[]
  } | null
}
export type SignedBalanceTip = {
  receipt: {
    seq: number
    segment: number
    amount: BaseUnits
    cumulativeAfter: BaseUnits
    articleId: string
    contentHash: string
    highlightId: string | null
    clientRef: string
  }
  signature: string
}
```

## I4. Fake session

`lib/payments/fake/` (owner P0): an in-memory `PaymentsRuntime`, provided by
`<FakePaymentsProvider scenario="…">` in stories and Playwright, and by
`SessionProvider` when `NEXT_PUBLIC_PAYMENTS_FAKE=1` (development builds
only; the build refuses the flag in production). Scenarios:
`signed-out`, `new-reader` (no balance, no wallet), `wallet-only`,
`balance-ready`, `balance-low`, `device-setup`, `writer-earning`,
`not-paid`, `slow-network`, `errors` (each refusal code once). The UI track
builds and tests every screen against it; logic packages replace the fake
with the real hooks without changing the exports.
