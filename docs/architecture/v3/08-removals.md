# 8. Removals

v2 code that this design makes dead on `overhaul/v3`. v1 code is removed by
separate work and is not listed. P8 deletes these files after the UI track
has replaced the screens that import them; until then rule 1 of
[work packages](work-packages.md#rules-for-every-package) keeps them
compiling.

## 8.1 Client

| Path                                                                                                                                                                                              | Replaced by                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `components/tipping/v2/**` (`ArticleTipV2`, `HighlightTipV2`, `TipDialogV2`, `TipDialogLoading`, `LastTipLine`, `TipBasketButton`, `TipBasketPanel`, `TipBasketRow`, `tip-v2.css`)                | The UI track's tip control and sheet on `useTip`                                         |
| `components/tab/**` (every file: the tab home, fund form, close section, device keys, collect panel, tip action and dialog section, notices, history, skeletons, loaders, `tab.css`, `README.md`) | Balance and earnings screens on `useBalance`, `useActivity`, `useEarnings`, `useDevices` |
| `components/payments/**` except `ExplorerLink`, `ShortAddress` and `TestnetLabel` if the UI track keeps them                                                                                      | The UI track's components                                                                |
| `hooks/tab/**` (`TabServicesContext`, `useLiveTabServices`, `useReaderTab`, `useDeviceKey`, `useLedgerClock`, `useTabTip`, `useTabOperation`)                                                     | `SessionProvider` and `lib/payments/live`                                                |
| `hooks/useTipV2Flow.ts`, `hooks/useTipBasket.ts`, `hooks/useLastTipV2.ts`                                                                                                                         | `useTip`, the outbox                                                                     |
| `lib/tab-ui/**` (`amounts`, `device-memory`, `key-plan`, `operation-flow`, `tab-calls`, `tab-status`, `tip-availability`, `tip-flow`, `tip-limits`, `types`)                                      | `lib/payments/route.ts`, `lib/session`                                                   |
| `lib/tip/v2/**` (`amount`, `basket`, `conditions`, `flow`, `gate`, `open-basket`, `pending`, `prepare-errors`)                                                                                    | `lib/payments/tip.ts`, the outbox                                                        |
| `lib/payments/failures.ts`, `lib/payments/format.ts`, `lib/payments/ui-state.ts`                                                                                                                  | `lib/payments/types.ts`, `money.ts`, `BALANCE_ERROR_CODES`                               |
| `lib/stellar/v2/tip-actions.ts` once P3 no longer imports it                                                                                                                                      | `WalletProvider.invoke` and `lib/payments/live`                                          |
| `components/providers/WalletActivationContext.tsx`, `WalletProvider.tsx`, `WalletRuntime.tsx`                                                                                                     | `SessionProvider` (P6 keeps a compatible `useWallet` until P8)                           |
| `lib/copy/tab.ts`, `lib/copy/tip-flow.ts`                                                                                                                                                         | The UI track's copy                                                                      |
| `app/dashboard/tab/**`                                                                                                                                                                            | The UI track's balance screen                                                            |

## 8.2 Convex

| Function or code                                                                                                                        | Replaced by                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `tabs.prepareTip`, `tabs.submitTip`; `prepareTabTip`, `TAB_PREPARE_TTL_MS` and the `tabPrepare` writes in `tabLedger.ts`                | `balance.send`                                                               |
| `tabs.prepareOpen`, `prepareDeposit`, `prepareRegisterKey`, `prepareRevokeKey`, `prepareWithdrawStart`, `prepareWithdraw`               | `balance.prepareDeposit`, `prepareDevice`, `forgetDevice`, `prepareWithdraw` |
| `tabs.getMyTab`, `tabs.getWriterPending`                                                                                                | `balance.session`, `earnings.mine`                                           |
| `tabActivity.getMyTabTips`, `getMyTabEarnings`, `getTabSettlement`                                                                      | `activity.mine`, `earnings.mine`, `balance.session.settlement`               |
| `tipsV2.prepareBatch`                                                                                                                   | none (the basket is removed)                                                 |
| `DEFAULT_TAB_TIP_MAX`, `DEFAULT_TAB_DAILY_LIMIT`, the `TAB_TIP_MAX` and `TAB_DAILY_LIMIT` settings, the `MAX_RECEIPTS_PER_PAIR` refusal | Cent limits, receipt segments                                                |
| `DUE_AGE_MS`, `DUE_AMOUNT` and the `age` and `amount` due reasons in `settler.ts`; the 10 minute settler cron                           | Event-driven scheduling, 5 minute backstop                                   |
| `xlmPriceCache` and `convex/xlmPrice.ts` (with A2)                                                                                      | `prices`                                                                     |

Kept in `convex/tabs.ts`: `getLatestVouchersForWriter` (the writer's
`settle_own` recourse), `sweepUnpaid` and `voidResetEpoch` (operator).

## 8.3 Tests and fixtures

`e2e/tab-session-keys.spec.ts`, `e2e/tab-tip-dialog.spec.ts`,
`e2e/tab-ui-keys.spec.ts`, `e2e/tab-ui.spec.ts`, the basket and v2 dialog
parts of `e2e/tips-v2.spec.ts` and `e2e/payment-states.spec.ts`, their
fixtures, `scripts/tab-ui/*.test.ts`, the basket and flow tests in
`scripts/tip-flow/`, and `scripts/integration/tab-ui-flow.test.ts`. The
`e2e/v3-*` suite (P7) replaces them.

## 8.4 What stays

- Every table and stored field of shipped data. `tabPrepare`, `channel:
'batch'` and the v2 key fields stay readable on old rows; v3 stops writing
  them.
- v2 epoch history: `activity.backfill` also writes rows for the previous
  epoch, marked with that epoch, so readers and writers keep their history
  after the v3 epoch starts.
- `Core.tip_batch` in the contract (no client calls it; removing it would be
  a contract change with no gain).
- The `syncV2TipEarnings` cron, as a backstop.
- The v2 deploy set in `scripts/contracts/deploy-v2/config.ts`, for the
  record of the v2 testnet deployment.
