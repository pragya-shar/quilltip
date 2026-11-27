# W. Work packages

Each package is built by one session in its own worktree, branched from
`overhaul/v3`, with a pull request into `overhaul/v3`. No file is owned by
two packages. Where a package needs another package's file, it uses the
interface named here and in [interfaces](interfaces.md), never an edit.

## W1. Order

```text
Wave 0   P0 interfaces and seams ─────────────────────────────┐ (lands first, about a day)
                                                              ▼
Wave 1   P1 contracts ──┐   P2 settlement   P3 tip pipeline   P4 verification and indexer
                        │   P5 balance ledger                 P6 session runtime
                        │        (all build against P0 and this design; P5 and P2 test with
                        │         the v3 encoder vectors from P1 as soon as they exist)
                        ▼
Wave 2   P7 integration: v3 testnet set, Convex integration backend, end-to-end
                                                              │
UI track (design sessions, parallel from wave 0, on the fake session) ──┤
                                                              ▼
Wave 3   P8 removal of v2 code (after the UI track replaces the v2 screens)

Later    A1 accounts (passkeys)   A2 assets   A3 agent payments   S1 split legs
```

The user-visible core (one pipeline, instant state, fast settlement,
persistent session) is P0 to P7. None of P0 to P7 depends on A1, A2 or A3.
The v3 contracts already support several tokens ([contracts](contracts.md)),
but P0 to P7 use XLM only.

### Rules for every package

1. **Keep the build green.** Until P8, every `api.*` function and module that
   the v2 client imports keeps its export and type. A function whose meaning
   v3 removes may throw `ConvexError({ code: 'V2_RETIRED' })` or return
   `null`; it may not disappear.
2. **No renames** of existing paths before P8. New code goes in the new paths
   listed below.
3. **Environment names** are listed in the package's report; P7 adds them to
   `.env.example` and `docs/SETUP.md`.
4. Checks before each push: `bun run check` (application and tooling) and the
   package's own suites. Docs-only commits: `bun run format:check` and
   `git diff --check`.
5. Testnet only. No Arweave uploads. No push to a cloud Convex deployment
   except P7's new integration deployment.

## W2. Packages

### P0. Interfaces and seams

- **Goal.** Commit the shared types, the hook files, the runtime context, the
  fake runtime and the schema seams, so every other package and the UI track
  start in parallel.
- **Files (creates):** `lib/payments/types.ts`, `lib/payments/money.ts`,
  `lib/payments/runtime.ts`, `hooks/session/useSession.ts`,
  `hooks/session/useWalletLink.ts`, `hooks/session/useDevices.ts`,
  `hooks/payments/useBalance.ts`, `hooks/payments/useTip.ts`,
  `hooks/payments/useAddFunds.ts`, `hooks/payments/useActivity.ts`,
  `hooks/payments/useEarnings.ts`, `lib/payments/fake/**`,
  `convex/lib/chain/settleSchema.ts` (then P2's), `convex/lib/chain/kickSchema.ts`
  (then P4's), `scripts/payments-fake/*.test.ts`.
- **Files (one edit, then handed over):** `convex/schema.ts` (spread
  `settleTables` and `kickTables`; then P5's), `scripts/unit.config.mts` (add
  `scripts/payments-fake/*.test.ts`, `scripts/pipeline/*.test.ts`,
  `scripts/session/*.test.ts`; then P0 keeps it and others ask).
- **Interfaces:** I1, I2, I4; the two schema files of
  [section 3.2](03-settlement.md#32-scheduling) and [3.7](03-settlement.md#37-indexer-cadence).
- **Tests:** `formatMoney` (rounding, negative, zero, large); every fake
  scenario reaches each phase it claims; the hooks throw a clear error with
  no provider.
- **Depends on:** nothing. **Size:** S.

### P1. Contracts v3

- **Goal.** The Tab and Core changes of [contracts](contracts.md), the encoder
  test vectors, regenerated bindings, the deploy set, and the v3 set deployed
  on testnet.
- **Files:** `contracts/tab/**`, `contracts/shared/**`,
  `contracts/core/src/storage.rs`, `contracts/core/src/test/**` (only for the
  token cap), `contracts/README.md`, `contracts/tab/test-vectors/v3.json` (new),
  `lib/stellar/v2/bindings/tab/**`, `lib/stellar/v2/bindings/core/**`,
  `scripts/contracts/**` (deploy set `v3`, bindings, ops scripts:
  `set_limits` becomes `set_token`).
- **Interfaces provided:** contract entry points and events (C2, C3);
  `v3.json` vectors (voucher, acceptance, withdraw payloads, receipt leaves,
  segment roots); deployed ids and epoch in the deploy evidence (outside the
  repository, as v2).
- **Tests:** [contracts C5](contracts.md#c5-tests); `cargo test --locked`
  for `tab`, `core`, `shared`; the deploy script's tests
  (`scripts/contracts/*.test.ts`).
- **Depends on:** nothing. **Size:** L.

### P2. Settlement

- **Goal.** Event-driven settlement with payouts ([document 3](03-settlement.md)).
- **Files:** `convex/tabSettler.ts`, `convex/tabSettlement.ts`,
  `convex/lib/chain/settler.ts`, `convex/lib/chain/settlementStore.ts`
  (the settlement record; the ledger half moves to P5's
  `settlementLedger.ts`), `convex/lib/chain/settlementSubmitter.ts`,
  `convex/lib/chain/settleSchedule.ts` (new), `convex/lib/chain/settleSchema.ts`,
  `convex/crons.ts`, `scripts/chain/tab-settler.test.ts`,
  `scripts/chain/settle-schedule.test.ts` (new).
- **Interfaces provided:** `requestSettlement(ctx, now)`.
- **Interfaces used:** `applySettlementOutcomes` (P5),
  `internal.chain.indexer.kick` (P4), the v3 `settle` entry point (P1).
- **Tests:** [section 3.8](03-settlement.md#38-tests).
- **Depends on:** P0; P1 for the settle argument shape (build against the
  spec, test against bindings when they land). **Size:** M.

### P3. Tip pipeline and payment hooks

- **Goal.** `tip()`, `routeTip()`, the state machine, the wallet route over
  `tipsV2`, add funds, and the live parts of `useBalance`, `useTip`,
  `useAddFunds`, `useActivity`, `useEarnings` ([document 1](01-tip-pipeline.md)).
- **Files (new):** `lib/payments/route.ts`, `lib/payments/tip.ts`,
  `lib/payments/live/**`, `scripts/pipeline/*.test.ts`.
- **Interfaces provided:** the live `PaymentsRuntime` parts (I2).
- **Interfaces used:** `api.balance.*`, `api.activity.mine`,
  `api.earnings.mine` (P5); `api.tipsV2.prepareDirectTip`,
  `prepareHighlightTip`, `recordSubmitted`, `recordSendFailed`,
  `getTipStatus` (P4, unchanged signatures); `signBalanceTip`,
  `commitAcceptedTip`, `commitUndo` (P5); `setupDevice`, `Outbox`,
  `WalletProvider` (P6); `lib/stellar/v2/tip-calls.ts` and `tx.ts` (read
  only).
- **Tests:** [section 1.11](01-tip-pipeline.md#111-tests) for the routing and
  pipeline; optimistic update tests of [2.7](02-instant-state.md#27-tests).
- **Depends on:** P0. Integration with P5 and P6 at P7. **Size:** M.

### P4. Verification, indexer kick, wallet tips

- **Goal.** Verify app-sent transactions by hash at once, kick the indexer,
  confirm wallet tips in seconds with earnings and activity in the same
  mutation, remove the basket's server function ([2.3, 2.4](02-instant-state.md#23-wallet-tips),
  [3.7](03-settlement.md#37-indexer-cadence)).
- **Files:** `convex/chain/submissions.ts`, `convex/lib/chain/submissionStore.ts`,
  `convex/chain/indexer.ts`, `convex/lib/chain/indexerStore.ts`,
  `convex/lib/chain/kickSchema.ts`, `convex/tipsV2.ts` (`prepareBatch` throws
  `V2_RETIRED`), `convex/lib/chain/tipPrepare.ts`,
  `convex/lib/chain/coreEventHandlers.ts`, `convex/lib/v2Earnings.ts`,
  `convex/tipEarnings.ts`, `scripts/chain/chain-submissions.test.ts`,
  `scripts/chain/indexer.test.ts`, `scripts/tips/tips-v2.test.ts`.
- **Interfaces provided:** `internal.chain.indexer.kick`,
  `scheduleVerification(ctx, submissionId)`; a `chainSubmissions.kind`
  `tab_op` record type for P5's `recordTransaction` (P5 adds the schema value).
- **Interfaces used:** `writeActivity`, `updateActivity`,
  `adjustEarningsCents` (P5).
- **Tests:** verification cadence with a fake clock and RPC; kick dedupe and
  rerun; wallet tip `sending` rows and `incomingCents` at record, credit once
  at confirm with the cron running; failure and expiry remove incoming.
- **Depends on:** P0. **Size:** M.

### P5. Balance ledger

- **Goal.** The v3 ledger in Convex: one-mutation acceptance, undo, segments,
  cent limits, tokens on every row, user-keyed reads, activity, earnings
  cents, deposits and devices, the withdrawal attestation, the v3 Tab event
  handlers, and the client voucher library ([1.4 to 1.10](01-tip-pipeline.md#14-the-balance-route),
  [document 2](02-instant-state.md), [4.4, 4.5](04-session.md#44-server-state-keyed-by-the-user)).
- **Files:** `convex/balance.ts` (new), `convex/activity.ts` (new),
  `convex/earnings.ts` (new), `convex/tabs.ts`, `convex/tabActivity.ts`,
  `convex/lib/chain/tabLedger.ts`, `convex/lib/chain/voucher.ts`,
  `convex/lib/chain/tabEventHandlers.ts`, `convex/lib/chain/events.ts`,
  `convex/lib/chain/schema.ts`, `convex/schema.ts` (after P0),
  `convex/lib/chain/env.ts`, `convex/lib/chain/settlementLedger.ts` (new),
  `convex/lib/chain/balanceErrors.ts` (new), `convex/lib/activity.ts` (new),
  `convex/lib/earnings.ts` (new), `convex/lib/authorEarnings.ts`,
  `lib/stellar/v2/tab/**`, `scripts/chain/tab-ledger.test.ts`,
  `scripts/chain/tab-encoding.test.ts`, `scripts/chain/balance*.test.ts`,
  `scripts/chain/activity.test.ts`, `scripts/chain/earnings.test.ts`,
  `scripts/tab/*.test.ts`.
- **Interfaces provided:** I3 (`convex/balance.ts`, `activity.mine`,
  `earnings.mine`), `applySettlementOutcomes`, `writeActivity`,
  `updateActivity`, `adjustEarningsCents`, `signBalanceTip`,
  `commitAcceptedTip`, `commitUndo`, `BALANCE_ERROR_CODES`.
- **Interfaces used:** `requestSettlement` (P2), `scheduleVerification` (P4),
  `v3.json` vectors (P1).
- **Tests:** [1.11](01-tip-pipeline.md#111-tests) server parts,
  [2.7](02-instant-state.md#27-tests) server parts, [4.8](04-session.md#48-tests)
  `convex-test` parts; encoder against `v3.json`; event handlers for every
  changed and new Tab event; withdrawal attestation (reserve, expiry,
  acceptance blocked by the reserve); `activity.backfill` idempotent.
- **Depends on:** P0; P1's vectors for the encoder tests. **Size:** L.

### P6. Session runtime

- **Goal.** `SessionProvider` in the root layout, wallet restore without a
  prompt, the `WalletProvider` interface with the `extension`,
  `walletconnect` and `injected` implementations, the device key loaded once,
  `setupDevice`, the outbox, the snapshot, sign-out cleanup
  ([document 4](04-session.md)).
- **Files:** `components/providers/**` (except `ThemeProvider.tsx`),
  `lib/session/**` (new), `lib/wallet/**` (new files only; the v1
  `connectWalletFromOverlay.ts` is P8's), `lib/stellar/v2/wallet.ts`,
  `lib/stellar/v2/wallet-kit.ts`, `lib/stellar/v2/wallet-picker.ts`,
  `lib/stellar/v2/wallet-signature.ts`, `lib/stellar/v2/wallet-errors.ts`,
  `lib/stellar/v2/walletconnect-*.ts`, `lib/stellar/v2/wallet-ownership.ts`,
  `hooks/useStellarWallet.ts`, `hooks/useWalletOwnership.ts`,
  `scripts/session/*.test.ts`, `scripts/wallet/*.test.ts`.
- **Interfaces provided:** the live session parts of `PaymentsRuntime`,
  `WalletProvider`, `setupDevice()`, `Outbox`.
- **Interfaces used:** `api.balance.session`, `prepareDevice`,
  `recordTransaction`, `forgetDevice` (P5); `createSessionKeyStore` (P5's
  library, v2 API).
- **Tests:** [section 4.8](04-session.md#48-tests).
- **Depends on:** P0. **Size:** M.

### P7. Integration

- **Goal.** A v3 integration backend on testnet with the P1 set, the
  end-to-end suite, and the measured targets of the [README](README.md#targets).
- **Files:** `scripts/integration/**`, `e2e/v3-*.spec.ts` (new),
  `e2e/fixtures/v3/**` (new), `.env.example`, `docs/SETUP.md`,
  `docs/DEPLOYMENT.md`.
- **Steps.** Deploy the P1 set if P1 did not; create a new Convex deployment
  for v3 integration (not `efficient-tern-39`); set its env from the deploy
  evidence and every package's report; run the local network suite and the
  Playwright suite at 390 × 844 first, then 768 and 1440.
- **Tests:** two readers and one writer on testnet: tap tip, undo, navigation
  and reload without prompts, second device setup, add funds and queued tip,
  wallet tip, settlement within 60 s, writer's wallet balance rises by the
  net, a forced shortfall path on the local network.
- **Depends on:** P1 to P6. **Size:** M.

### P8. Removal of v2 code

- **Goal.** Delete what [document 8](08-removals.md) lists, after the UI track
  has replaced the v2 screens on `overhaul/v3`.
- **Files:** the deletions of document 8, plus the edits that remove their
  imports.
- **Depends on:** P7 and the UI track's replacement screens. **Size:** M.

### Later waves

| Package            | Goal                                                                                           | Document                             |
| ------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------ |
| A1. Accounts       | Passkey smart accounts, fee sponsor, passkey sign-in                                           | [5](05-accounts.md)                  |
| A2. Assets         | Token registry, prices per asset, accepted tokens, project profiles                            | [6](06-assets.md)                    |
| A3. Agent payments | HTTP 402 article endpoint and crediting                                                        | [7](07-agent-payments.md)            |
| S1. Split legs     | Balance tips for articles with splits: one receipt per recipient, signed and accepted together | [1.1](01-tip-pipeline.md#11-routing) |

Later packages start after P5 and P6 have merged. They may then edit P5's
and P6's files, one later package at a time per file, in the order A1, A2,
A3, S1 unless the coordinator orders otherwise. A1, A2 and A3 touch
disjoint new files and can run in parallel; their edits to shared files are
listed so the coordinator can sequence them.

#### A1. Accounts

- **New files:** `lib/wallet/passkey.ts`, `convex/accounts.ts`,
  `convex/sponsor.ts`, `convex/lib/webauthn.ts`, `convex/lib/sponsorStore.ts`,
  `scripts/accounts/*.test.ts`, `e2e/v3-passkey.spec.ts`.
- **Edits:** `convex/auth.ts` (the `passkey` provider), `convex/schema.ts`
  (`passkeyCredentials`, `sponsorRequests`, `practiceGrants`,
  `tabAccounts.tipOnly`), `convex/balance.ts` (`tipOnly` in `available` for
  the withdrawal), `lib/session/live.ts` (provider choice).
- **Interfaces:** `WalletProvider` (5.1), `sponsor.prepare`,
  `sponsor.submit`, `accounts.createPasskeyAccount`.
- **Depends on:** P5, P6, the Stellar rails decision on the smart account.
  **Size:** L.

#### A2. Assets

- **New files:** `lib/stellar/v2/tokens.ts`, `convex/prices.ts`,
  `convex/projectProfiles.ts`, `scripts/assets/*.test.ts`,
  `scripts/contracts/ops-v2/tokens-sync.ts`.
- **Edits:** `convex/schema.ts` (`tokenConfig`, `prices`, `projectProfiles`,
  `users.acceptedTokens`), `convex/chain/config.ts` (token views),
  `convex/crons.ts` (price refresh), `convex/balance.ts` (`tipContext`
  tokens, prices), `lib/payments/route.ts` (token choice).
- **Interfaces:** `TokenEntry`, `tokenById`, `tokenContractId`, the
  `prices` rows in `balance.session`.
- **Depends on:** P5, P3, P1's multi-token Tab. **Size:** M.

#### A3. Agent payments

- **New files:** `app/api/agents/**`, `lib/agents/**` (the store adapter and
  challenge helpers), `convex/agents.ts`, `convex/lib/agentForwarder.ts`,
  `scripts/agents/*.test.ts`.
- **Edits:** `convex/schema.ts` (`agentPayments`, `mppChallenges`,
  `users.agentAccess`, `users.agentPriceCents`, `tips.agentPaymentId`),
  `convex/lib/chain/coreEventHandlers.ts` (link forwarded tips),
  `convex/crons.ts` (forwarder backstop), the article page head (UI track,
  one `<link>`).
- **Dependencies to add:** `@stellar/mpp`, `mppx`, at exact versions
  published at least two weeks before the package starts.
- **Depends on:** P4, P5. **Size:** M.

#### S1. Split legs

- **Edits:** `convex/balance.ts`, `convex/lib/chain/tabLedger.ts`,
  `lib/stellar/v2/tab/sign-tip.ts`, `lib/payments/route.ts` (drop condition
  R4.5).
- **Goal:** a balance tip to an article with splits becomes one receipt per
  recipient (`floor(amount × bps / 10,000)`, the remainder to the first
  recipient), signed together and accepted in one mutation; undo and
  activity treat them as one tip.
- **Depends on:** P5, P3. **Size:** S.

## W3. The UI track

Design sessions own `app/**`, `components/**` except
`components/providers/**`, `lib/copy/**` and all CSS. They build against the
hooks of [I2](interfaces.md#i2-headless-hooks) and the fake session of
[I4](interfaces.md#i4-fake-session), and they never import `convex/_generated/api`,
`lib/stellar/**` or the wallet kit for payment screens. Screens the core
needs:

| Screen or control                | Hooks                                                  |
| -------------------------------- | ------------------------------------------------------ |
| Tip control (article, passage)   | `useTip`, `useBalance`                                 |
| Tip sheet (amounts, every route) | `useTip`, `useBalance`, `useAddFunds`, `useWalletLink` |
| Balance screen                   | `useBalance`, `useActivity('reader')`, `useAddFunds`   |
| Writer earnings screen           | `useEarnings`, `useActivity('writer')`                 |
| Settings: devices, wallet        | `useDevices`, `useWalletLink`                          |

When a screen needs data no hook returns, the design session asks for an
interface change here; it does not read Convex directly.

## W4. File ownership index

| Path                                                                                                                                                                                                                                                                                         | Owner                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `contracts/**`, `lib/stellar/v2/bindings/**`, `scripts/contracts/**`                                                                                                                                                                                                                         | P1                                                             |
| `convex/tabSettler.ts`, `convex/tabSettlement.ts`, `convex/crons.ts`, `convex/lib/chain/settler.ts`, `settlementStore.ts`, `settlementSubmitter.ts`, `settleSchedule.ts`, `settleSchema.ts`                                                                                                  | P2                                                             |
| `lib/payments/route.ts`, `lib/payments/tip.ts`, `lib/payments/live/**`                                                                                                                                                                                                                       | P3                                                             |
| `convex/chain/submissions.ts`, `convex/chain/indexer.ts`, `convex/tipsV2.ts`, `convex/tipEarnings.ts`, `convex/lib/chain/submissionStore.ts`, `indexerStore.ts`, `kickSchema.ts`, `tipPrepare.ts`, `coreEventHandlers.ts`, `convex/lib/v2Earnings.ts`                                        | P4                                                             |
| `convex/balance.ts`, `activity.ts`, `earnings.ts`, `tabs.ts`, `tabActivity.ts`, `convex/schema.ts`, `convex/lib/chain/{tabLedger,voucher,tabEventHandlers,events,schema,env,settlementLedger,balanceErrors}.ts`, `convex/lib/{activity,earnings,authorEarnings}.ts`, `lib/stellar/v2/tab/**` | P5                                                             |
| `components/providers/**` (not `ThemeProvider.tsx`), `lib/session/**`, `lib/wallet/**` (new files), `lib/stellar/v2/wallet*.ts`, `lib/stellar/v2/walletconnect-*.ts`, `hooks/useStellarWallet.ts`, `hooks/useWalletOwnership.ts`                                                             | P6                                                             |
| `lib/payments/{types,money,runtime}.ts`, `lib/payments/fake/**`, `hooks/session/**`, `hooks/payments/**`, `scripts/unit.config.mts`                                                                                                                                                          | P0                                                             |
| `scripts/integration/**`, `e2e/v3-*`, `.env.example`, `docs/SETUP.md`, `docs/DEPLOYMENT.md`                                                                                                                                                                                                  | P7                                                             |
| `app/**`, `components/**` (rest), `lib/copy/**`, CSS                                                                                                                                                                                                                                         | UI track                                                       |
| Everything else in the v2 payment client (`hooks/tab/**`, `lib/tab-ui/**`, `lib/tip/v2/**`, `components/tab/**`, `components/tipping/v2/**`, `components/payments/**`, `hooks/useTipV2Flow.ts`, `hooks/useTipBasket.ts`)                                                                     | Frozen until P8 deletes it; the UI track may stop rendering it |
