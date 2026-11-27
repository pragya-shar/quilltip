# Payments v3: the payment experience

Status: design for implementation on `overhaul/v3`. Network scope: Stellar
**testnet** only. This design builds on the v2 contracts and Convex ledger
([v2 specification](../v2-spec.md)) and changes them where the experience
needs it. Where this document and the v2 specification disagree, this
document wins on `overhaul/v3`.

Words in **MUST**, **MUST NOT** and **SHOULD** carry their RFC 2119 meaning.

## Goal

One labelled tip button, one balance, no wallet prompt for a tip from the
balance, amounts in dollars, and the reader's balance and the writer's
earnings change within a second of acceptance. On-chain settlement and the
writer's payout run in the background within about a minute.

## Documents

| #   | Document                                    | Covers                                                                     |
| --- | ------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | [One tip pipeline](01-tip-pipeline.md)      | `tip()`, routing, the sheet state machine, limits, idempotency, the hold   |
| 2   | [Instant state](02-instant-state.md)        | Acceptance-driven reads, reconciliation, shortfall                         |
| 3   | [Fast settlement](03-settlement.md)         | Event-driven settler, batching, lease, cost, automatic payout, indexer     |
| 4   | [Persistent session](04-session.md)         | Root session runtime, wallet restore, device key, cache, devices, sign-out |
| 5   | [Accounts without a wallet](05-accounts.md) | Wallet provider seam, passkey accounts, fee sponsor, sign-in               |
| 6   | [Assets](06-assets.md)                      | Token registry, prices, accepted tokens, project profiles                  |
| 7   | [Agent payments](07-agent-payments.md)      | HTTP 402 article endpoint, crediting the writer                            |
| 8   | [Removals](08-removals.md)                  | v2 code that this design makes dead                                        |
| C   | [Contract changes](contracts.md)            | The v3 Tab and Core changes, one redeploy                                  |
| I   | [Interfaces](interfaces.md)                 | View-model types, headless hooks, Convex functions, validators             |
| W   | [Work packages](work-packages.md)           | Packages, file ownership, order, dependencies, tests                       |

Documents 5 to 7 are later waves: the core packages (P0 to P8) do not
depend on them.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                         | Detail                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| D1  | One client entry point, `tip({ target, amountCents })`, and one sheet for article and passage tips. The route is chosen by the app: balance, then wallet, then "add funds".                                                                                                                                                                                                      | [01](01-tip-pipeline.md#11-routing)                                         |
| D2  | The per-tip limit is in dollars (`BALANCE_TIP_MAX_CENTS`, default $20), with a daily cap (`BALANCE_DAILY_MAX_CENTS`, default $100). A tip above either goes to the wallet route; it is never refused for the limit alone. The 5 XLM maximum and the XLM daily limit are removed.                                                                                                 | [01](01-tip-pipeline.md#13-limits)                                          |
| D3  | The tip basket is removed. A balance tip needs no approval, so there is nothing to batch for the reader.                                                                                                                                                                                                                                                                         | [01](01-tip-pipeline.md#16-the-basket)                                      |
| D4  | A balance tip is accepted in **one** Convex mutation (`balance.send`). The client signs from reactive pair state; the prepare mutation goes away.                                                                                                                                                                                                                                | [01](01-tip-pipeline.md#14-the-balance-route)                               |
| D5  | No reversal after acceptance. The way back is a client-side hold before sending: presses add up, nothing reaches the server until the hold ends (3 s after the last press, 5 s ceiling), and closing the app during the hold sends nothing. The balance and activity change only when the server accepts. Slice 1 ships without the hold.                                        | [01](01-tip-pipeline.md#17-the-hold)                                        |
| D6  | Every read the reader and writer see is a reactive Convex query keyed by the signed-in user, not by a connected wallet. Acceptance writes the reader's balance, both activity lists and the writer's earnings in the same mutation.                                                                                                                                              | [02](02-instant-state.md)                                                   |
| D7  | Transactions the app sends are verified by hash at once, and each recorded hash wakes the indexer. Deposits show within about 10 seconds; wallet tips confirm within about 10 seconds.                                                                                                                                                                                           | [02](02-instant-state.md#24-transactions-the-app-sends)                     |
| D8  | Settlement is event-driven: the first acceptance schedules a run 15 seconds later; a run takes up to 32 vouchers, sized by the network's footprint limits. The 6 hour and 5 XLM due rules are removed. Target: accept to on-chain within 60 seconds at p95.                                                                                                                      | [03](03-settlement.md)                                                      |
| D9  | `Tab.settle` pays writers directly in the settlement transaction. Earnings arrive in the writer's wallet in the same ledger as settlement, with no writer action. `claim` stays for writers whose address cannot receive a token.                                                                                                                                                | [03](03-settlement.md#35-automatic-payout), [C](contracts.md)               |
| D10 | One session runtime is mounted in the root layout. The wallet link, the device key, the balance snapshot and the ledger clock are loaded once per page load and kept across navigation. No screen asks the reader to connect a wallet to see their own state.                                                                                                                    | [04](04-session.md)                                                         |
| D11 | The wallet is restored without a prompt: the app remembers the wallet id and address, and the first prompt the reader sees is the signature request itself.                                                                                                                                                                                                                      | [04](04-session.md#43-wallet-restore)                                       |
| D12 | One session key per device, registered with a spend limit equal to the Tab's balance cap, lifetime 90 days. Devices are listed and removable in the app without a wallet prompt.                                                                                                                                                                                                 | [04](04-session.md#45-devices)                                              |
| D13 | One v3 contract set, deployed once: one Tab instance per token, direct payout to writers in `settle`, a 90 day key lifetime, and an instant withdrawal countersigned by the acceptor. Core's token cap rises to 16. Nothing else in the contracts changes.                                                                                                                       | [C](contracts.md)                                                           |
| D14 | Code keeps the names `tab`, `voucher` and `session key` for the contract and the ledger. User-facing text says **balance** and **tip**, never "tab", "voucher", "session key", "deposit" or "settle". New client modules and Convex modules use `balance`.                                                                                                                       | [Glossary](#glossary)                                                       |
| D15 | The UI is a separate track. It consumes headless hooks and view-model types fixed in [interfaces](interfaces.md); a fake session lets design work render every state without a backend.                                                                                                                                                                                          | [I](interfaces.md)                                                          |
| D16 | Payment signatures go through one `WalletProvider` interface with `extension`, `walletconnect`, `injected` and `passkey` implementations. Passkey accounts are smart accounts whose fees a server-side sponsor pays, behind the network guard.                                                                                                                                   | [05](05-accounts.md#51-the-wallet-provider-seam)                            |
| D17 | The passkey is also an app sign-in method; an account created with a passkey needs no email or password.                                                                                                                                                                                                                                                                         | [05](05-accounts.md#54-passkey-sign-in)                                     |
| D18 | One token registry entry per asset (`lib/stellar/v2/tokens.ts`) plus a per-deployment `tokenConfig` table, one Tab instance per token, prices per token, amounts shown in dollars. USDC becomes the default token with A2. Writers choose accepted tokens; verified project profiles can accept only their own token. Conversion happens when funds are added, not inside a tip. | [06](06-assets.md)                                                          |
| D19 | Agents pay per read and tip only through the Tab: an agent is a Tab reader with its own key, and the HTTP 402 exchange names our own method, so the split holds on chain and the path is noncustodial. Standard MPP `charge` and x402 are rejected. No doc or screen claims MPP or x402 compatibility until an independent client passes.                                        | [07](07-agent-payments.md)                                                  |
| D20 | Practice money on testnet is a sponsor transfer to the new account, deposited by the account's first `open_session`; it costs no extra prompt.                                                                                                                                                                                                                                   | [05](05-accounts.md#55-funding-without-a-wallet)                            |
| D21 | A tip does nothing else: acceptance writes money state only (no follow, no subscription, no public identity). Public supporter surfaces are opt-in and outside the pipeline.                                                                                                                                                                                                     | [01](01-tip-pipeline.md#12-the-sheet)                                       |
| D22 | The tip control is a labelled button stating the amount, with a visible amount choice that works by tap and keyboard; gestures are only shortcuts, and `TipController` has no gesture-only method.                                                                                                                                                                               | [01](01-tip-pipeline.md#12-the-sheet), [I](interfaces.md#i2-headless-hooks) |
| D23 | Counts say what they count. Article and passage tip counts, cents and distinct readers are running figures moved in the mutation that accepts, fails or reverses a tip, idempotent by a per-row marker. Only signed-in readers count as readers; tips without one count in `unidentifiedTipCount`, and public copy says "N readers" only when that is 0, otherwise "N tips".     | [W](work-packages.md#k1-counts)                                             |

## Targets

| Measure                                                                     | Target                                       | v2 today                                         |
| --------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| End of the hold to the balance and activity changing (server acceptance)    | 300 ms at p95                                | After prepare, sign and submit                   |
| Press to the end of the hold                                                | 3 s after the last press, 5 s at most        | none (no hold)                                   |
| Accepted to the writer's earnings changing (writer's screen)                | 1 s at p95 (reactive push)                   | Pending in base units only                       |
| Accepted to on-chain settlement                                             | 25 s p50, 60 s p95                           | 6 h, or 5 XLM, plus a 10 min cron                |
| On-chain settlement to the writer's wallet                                  | Same transaction                             | A writer action ("collect")                      |
| Wallet approval of a deposit to a usable balance                            | 10 s at p95                                  | Next indexer run, 30 to 45 s                     |
| Wallet approval of a wallet tip to confirmed                                | 10 s at p95                                  | Verifier backoff, then a 1 min cron for earnings |
| Page navigation or reload to "ready to tip" (signed in, device key present) | 0 ms after navigation, 1 s after a cold load | Per-mount key and ledger reads                   |

## Hard constraints (unchanged)

- Stellar testnet only. Testnet activity is labelled as testnet.
- Writers receive 97.5%, the platform 2.5%. The fee rule of the contracts
  (`floor(gross × 250 / 10,000)`, cumulative for balance tips) is unchanged.
- A tip is confirmed by the server from signed or on-chain data, never by the
  client alone. The balance and activity a reader sees change only when the
  server accepts.
- Auth and ownership boundaries, pause guards, transaction verification and
  storage keys of shipped data are kept. A new contract set starts a new
  `CHAIN_EPOCH`; v2 testnet data stays readable as history.
- No Arweave uploads. No secrets in the repository.

## Glossary

| Term in code                | Meaning                                                                        | Term in the UI                         |
| --------------------------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| Tab, tab account            | The Tab contract and the reader's prepaid balance in it, per token             | Balance                                |
| Session key, device key     | An ed25519 key in this browser that signs vouchers without a wallet prompt     | (not shown); "this device" in settings |
| Voucher                     | A signed cumulative amount for one (reader, key, writer, token) pair           | (not shown)                            |
| Receipt                     | One tip inside a voucher                                                       | Tip                                    |
| Acceptance                  | Convex verified and countersigned a voucher                                    | Sent                                   |
| Settlement                  | The settler's `Tab.settle` transaction                                         | (not shown)                            |
| Payout                      | The transfer of a writer's net to the writer's address                         | In your wallet                         |
| Balance route, wallet route | How a tip is paid: from the Tab balance, or from the wallet through `Core.tip` | (not shown)                            |
| Deposit                     | `Tab.deposit` or `Tab.open_session`                                            | Add funds                              |

## Reading order for build sessions

1. This page, then [interfaces](interfaces.md) and [work packages](work-packages.md).
2. The document of your package.
3. The v2 documents your package's files cite, for what this design keeps.
