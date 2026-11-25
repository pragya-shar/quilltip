# 7. Security and recovery

[Index](../v2-spec.md)

## 7.1 Invariants

Tests cite these IDs ([section 8.1](08-testing-and-deployment.md#81-test-plan)).

**Core**

| ID   | Invariant                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-1  | For every tip: `fee == floor(gross × 250 / 10,000)` and `fee + Σ shares == gross`.                                                                            |
| I-2  | Recipients together receive `gross − fee`. Each non-primary recipient receives `floor(net × bps / 10,000)`. The primary author receives the remainder.        |
| I-3  | `article_total(article, token)` grows by exactly `gross` per successful tip and never decreases.                                                              |
| I-4  | No tip succeeds while paused, or with a token that is not allowed, an amount ≤ 0 or below `min_tip`, an unregistered article, or a tipper who is a recipient. |
| I-5  | A `client_ref` succeeds in at most one Core tip within `TIP_REF_TTL`.                                                                                         |
| I-6  | Core never holds tokens. Its token balance is unchanged by every call.                                                                                        |
| I-7  | Only the stored author (authorised) can update content or splits. `change_author` needs both the old and the new author.                                      |
| I-8  | Stored splits always satisfy the split rules ([section 2.1](02-core-contract.md#21-types)).                                                                   |
| I-24 | `tip_batch` is atomic, enforces both caps, and emits exactly one `Tipped` per item.                                                                           |

**Tab**

| ID   | Invariant                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| I-10 | Conservation: the Tab's token balance == Σ `ReaderAccount.balance` + Σ `Claimable`.                                           |
| I-11 | For each `(reader, key_id, writer)`, `Paid` never decreases and never exceeds the largest validly signed `cumulative`.        |
| I-12 | A settlement moves at most `min(delta, balance, spend_limit − spent)`.                                                        |
| I-13 | Settled `gross` splits as `fee = floor(gross × 250 / 10,000)` to treasury claimable and `gross − fee` to writer claimable.    |
| I-14 | A voucher verifies only for its own network, Tab contract, reader, writer, key and cumulative.                                |
| I-15 | No settlement under a key after `valid_until + SETTLE_GRACE` (`settle`), or after `valid_until` or revocation (`settle_own`). |
| I-16 | `withdraw` succeeds only `WITHDRAW_DELAY` or more after `withdraw_start`, pays exactly the balance, and pays only the reader. |
| I-17 | `claim` pays exactly the claimable amount, only to the recipient, and leaves it at zero.                                      |
| I-18 | `withdraw_start`, `withdraw`, `revoke_key` and `claim` work while paused.                                                     |

**NFT**

| ID   | Invariant                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-19 | At most one NFT per article. Mint only by the Core author, and only when the Core total ≥ threshold at mint time. The royalty is 1,000 bps to the minting author. |

**Application and all contracts**

| ID   | Invariant                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I-20 | A payment record becomes `CONFIRMED` only by the rule in [section 6.1](06-app-integration.md#61-transaction-lifecycle), never from client input.                                           |
| I-21 | A tab receipt is `ACCEPTED` only with a valid signature, the next `seq`, `cumulative == previous + amount`, and `outstanding + amount ≤ confirmedBalance` and `≤` the remaining key limit. |
| I-22 | Identifier and voucher encodings match across Rust, Convex and client for every shared test vector.                                                                                        |
| I-23 | `migrate` runs once per schema version. Upgrades preserve all stored state.                                                                                                                |
| I-25 | After any state-changing call, the instance and every persistent entry it wrote have TTL ≥ `TTL_THRESHOLD`.                                                                                |
| I-26 | No public `initialize`. Every admin function enforces its role.                                                                                                                            |

## 7.2 Threat model (STRIDE)

| Component              | Threat                                                         | Category               | Mitigation                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core registration      | Someone registers another author's article ID to redirect tips | Spoofing               | `article_id` derives from the Convex article ID. The app tips only articles whose on-chain author equals the article owner's linked address (prepare check). |
| Core tip               | A malicious token contract fakes transfers                     | Tampering              | Token allowlist (I-4). SAC addresses only.                                                                                                                   |
| Core tip               | A replayed or duplicate submission charges twice               | Tampering              | Sequence numbers. `client_ref` dedupe (I-5). Convex unique indexes.                                                                                          |
| Core admin             | Fee raised silently                                            | Elevation              | `FEE_BPS` is a constant. A change needs an upgrade by `upgrader`.                                                                                            |
| Core, Tab and NFT init | Constructor front-running                                      | Elevation              | `__constructor` only (I-26)                                                                                                                                  |
| Tab voucher            | Cross-network or cross-contract replay                         | Spoofing               | Domain, network ID and Tab address in the payload (I-14)                                                                                                     |
| Tab voucher            | Replay of an old voucher                                       | Tampering              | Monotonic `Paid`, which lives as long as the key (I-11, I-15)                                                                                                |
| Tab session key        | Stolen through XSS                                             | Information disclosure | Non-extractable WebCrypto key. Spend limit and expiry (I-12, I-15). Strict CSP. Revocation.                                                                  |
| Tab settler            | Settler key leaked                                             | Elevation              | The settler can only submit reader-signed vouchers; it cannot move funds without them. Role revocable. Testnet-only key.                                     |
| Tab settler            | Settler withholds settlement                                   | Denial of service      | `settle_own` path. Lag alerts. Withdrawal delay longer than the settle cadence.                                                                              |
| Tab reader             | Reader withdraws before writers are settled                    | Repudiation            | `WITHDRAW_DELAY`. Convex settles closing accounts first.                                                                                                     |
| Tab reader             | Reader signs beyond balance                                    | Tampering              | Convex balance check (I-21). The contract caps at the balance and records the shortfall.                                                                     |
| NFT                    | Mint without reaching the threshold                            | Elevation              | The threshold is read from Core (I-19)                                                                                                                       |
| Convex                 | Client claims a tip that did not happen                        | Spoofing               | Server-side RPC verification (I-20)                                                                                                                          |
| Convex                 | Prepare endpoints spammed                                      | Denial of service      | Existing rate limiter (`convex/lib/rateLimit.ts`) on every prepare and submit                                                                                |
| Indexer                | Missed events beyond RPC retention                             | Repudiation            | Lag alert at 1 h. Backfill procedure (7.4).                                                                                                                  |
| All                    | Mainnet misconfiguration                                       | Tampering              | Network guard: mainnet is always refused in this phase.                                                                                                      |
| All                    | Storage growth or archival denies service                      | Denial of service      | No unbounded collections. TTL policy (I-25). Simulation restores archived entries.                                                                           |

## 7.3 Edge cases

| Case                                                            | Expected result                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `amount = 0` or negative (Core, Tab deposit)                    | `InvalidAmount` (Core 7) / `BelowMinimumDeposit` (Tab 31)                                                                                                          |
| `amount = min_tip − 1`                                          | `BelowMinimum`                                                                                                                                                     |
| `amount = min_tip` (40 stroops is the lowest allowed `min_tip`) | Succeeds with `fee ≥ 1`                                                                                                                                            |
| `gross = i128::MAX`, or a total near the maximum                | `Overflow`. Nothing changes.                                                                                                                                       |
| Dust: `gross × 250` not divisible by 10,000                     | `fee` floors, and the writer side gets the remainder (I-1)                                                                                                         |
| Split rounding with 5 recipients                                | Non-primary shares floor. The primary gets the remainder. The sum is exact (I-2).                                                                                  |
| Self-tip, or the tipper is a co-author                          | `SelfTip`                                                                                                                                                          |
| Duplicate `client_ref` (same day, or within a batch)            | `DuplicateClientRef`                                                                                                                                               |
| Unregistered article                                            | `NotRegistered`. The app disables the button.                                                                                                                      |
| Author changed wallet in the app only                           | Prepare refuses with "update the article's payout address". The author runs `change_author`.                                                                       |
| Author changed on chain between prepare and submit              | Simulation passes, but the event `author` differs from the expectation. Convex marks the record `FAILED` (`mismatch:author`). Funds went to the registered author. |
| Batch of 11 items, or more than 24 transfers                    | `BatchTooLarge`                                                                                                                                                    |
| Token not allowlisted, or disabled                              | `TokenNotAllowed`                                                                                                                                                  |
| Settle with a voucher whose signature is bad                    | Whole transaction traps. The settler pre-verifies, so this means a settler bug or tampering.                                                                       |
| Two vouchers for the same pair in one batch                     | The first settles. The second is skipped `STALE` unless its cumulative is higher.                                                                                  |
| Voucher after `withdraw`                                        | `gross = 0`, skipped `SHORTFALL`. Receipts stay `SHORTFALL`.                                                                                                       |
| `register_key` with `valid_until` more than 30 days ahead       | `InvalidKeyExpiry`                                                                                                                                                 |
| Deposit while closing                                           | The withdrawal is cancelled                                                                                                                                        |
| Claim with nothing owed                                         | Returns 0. No transfer.                                                                                                                                            |
| Claim to a G-account without a trustline (non-native token)     | SAC transfer fails and the transaction reverts. The UI asks the writer to add the trustline.                                                                       |
| NFT mint twice                                                  | `AlreadyMinted`                                                                                                                                                    |

## 7.4 Failure recovery

| Failure                                           | Detection                                                                       | Recovery                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simulation failure                                | `prepareTransaction` throws or returns an error                                 | No submission. Show the mapped error, and keep the record `PREPARED` until it expires. Transient RPC errors get one automatic retry.                                                                                                                                                                                                                                                               |
| Expired envelope                                  | `txTOO_LATE`, or `NOT_FOUND` after `maxTime`                                    | Mark `EXPIRED`. The user may retry with a new intent and `client_ref`.                                                                                                                                                                                                                                                                                                                             |
| Duplicate submit                                  | `DUPLICATE` status, or the same hash recorded twice                             | Treat as `PENDING`. Unique indexes stop a second record. On chain, `DuplicateClientRef` stops a second payment.                                                                                                                                                                                                                                                                                    |
| RPC outage                                        | Timeouts, or a `getHealth` failure                                              | Client: show "network busy", with no state change. Convex: the record stays `SUBMITTED`, and `recheckPending` retries for 24 h. The indexer keeps its cursor and resumes. If the outage exceeds 1 h, switch `STELLAR_RPC_URL` to a second testnet RPC provider.                                                                                                                                    |
| Indexer lag beyond retention (`BEHIND_RETENTION`) | `lastLedger < oldestLedger`                                                     | 1. Pause v2 prepares (set `CHAIN_V2_ENABLED=false`). 2. Backfill the missed range from an archive RPC provider or a hosted indexer into `chainEvents`. Handlers are idempotent. 3. Reconcile records. 4. Resume. Direct tips with a known hash still verify by `getTransaction` only while the transaction is inside retention. Otherwise they stay `SUBMITTED` and are flagged for manual review. |
| Archived contract entries                         | Simulation returns restore requirements                                         | Prepared transactions restore automatically. Ops runs a weekly extend script for the instance and Wasm (`stellar contract extend`). Restoring a large footprint uses `RestoreFootprint` through the CLI.                                                                                                                                                                                           |
| Settler outage                                    | Oldest due voucher older than 6 h                                               | Alert. Fix and restart, or rotate the settler role to a second key or relayer. Writers can use `settle_own`. Closing accounts are processed first.                                                                                                                                                                                                                                                 |
| Session-key loss                                  | The client has no key for an active `key_id`                                    | Register a new key. Convex keeps settling the old key's accepted vouchers. The user may revoke the old key.                                                                                                                                                                                                                                                                                        |
| Paused contract                                   | Simulation fails with the OpenZeppelin `PausableError` (1000 range)             | The UI shows "payments paused". Prepares are refused while `chainConfig.paused`. Exit functions stay available (I-18).                                                                                                                                                                                                                                                                             |
| Testnet reset                                     | Contract instances missing (config refresh fails), or the ledger sequence drops | 1. Disable v2 prepares. 2. Mark the current `chainEpoch` closed. Unsettled tab receipts become `VOID` (reset) and keep their history labels. 3. Redeploy from the recorded commit ([section 8.4](08-testing-and-deployment.md#84-testnet-deployment-procedure)). 4. Start a new `chainEpoch` and a new `INDEXER_START_LEDGER`. 5. Prompt authors to enable tips again.                             |
