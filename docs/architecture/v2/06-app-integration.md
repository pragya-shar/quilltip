# 6. Application integration

[Index](../v2-spec.md)

## 6.1 Transaction lifecycle

Every user transaction follows these steps: register, author change, tip,
batch, tab operations, claim and NFT.

1. **Prepare (Convex).** Convex creates the server record with the expected
   values, a `client_ref` where one applies, and `maxTime = server time + 300 s`.
   - The prepare mutation takes a client `requestId`. A repeated call with the
     same `requestId` returns the same record.
2. **Build (client).** The source account is the signer's linked address.
   - The fee starts at `BASE_FEE`. The time bounds are `[0, maxTime]`.
   - The invocation is built from the generated contract bindings.
3. **Simulate (client).** Call `rpc.Server.prepareTransaction`.
   - A simulation error decodes to a contract error code (sections 2.5, 3.10
     and 4.4). `lib/stellar/v2/errors.ts` maps the code to a user message, and
     nothing is submitted.
   - If simulation reports archived entries, the prepared transaction restores
     them automatically (Protocol 23 and later). The integration test MUST
     cover a tip to an article whose entries were archived.
4. **Sign (wallet).** The wallet signs the envelope.
   - Every user-facing entry point authorises exactly one address, and that
     address is the transaction source.
   - In recording mode, simulation gives source-account credentials to an
     address that equals the transaction source. It gives address credentials
     only to other addresses (`soroban-env-host` 28.0.2 `src/auth.rs`, recording
     tracker).
   - So no flow needs `signAuthEntry`. The author change uses two single-signer
     transactions instead ([section 2.2](02-core-contract.md#article-registration)).
5. **Send (client).** Call `sendTransaction`, then act on the returned status:

   | Status            | Action                                                                             |
   | ----------------- | ---------------------------------------------------------------------------------- |
   | `PENDING`         | Record the hash in Convex, then go to step 6.                                      |
   | `DUPLICATE`       | Same as `PENDING`.                                                                 |
   | `TRY_AGAIN_LATER` | Resend the **same** envelope after 2 s, at most 5 times and never after `maxTime`. |
   | `ERROR`           | Decode `errorResult`, then mark the record `FAILED` with the reason.               |

6. **Poll (client, UI only).** Call `getTransaction` every 2 s until `SUCCESS`
   or `FAILED`, or until `maxTime + 30 s`. The client never decides
   confirmation.
7. **Verify (Convex, authoritative).** An internal action calls
   `getTransaction(hash)`.
   - On `FAILED`, it marks the record `FAILED`.
   - On `SUCCESS`, it decodes the events of the expected contract and applies
     [section 6.4](#64-server-side-verification-details). The result is
     `CONFIRMED` or `MISMATCH`.
   - Retries back off at 2, 4, 8 … 60 s, up to `maxTime + 10 min`. After that,
     the `recheckPending` cron takes over. It runs every 2 minutes, for at most
     the RPC retention window.

**Confirmation rule.** A payment record becomes `CONFIRMED` or `MISMATCH` only
when at least one of these holds:

- **(a)** RPC returns `SUCCESS` for its transaction hash, and that transaction
  contains the expected event from the configured contract.
- **(b)** The indexer has stored such an event carrying the record's
  `client_ref`.

Client reports never confirm a payment (I-21).

**Expiry and the no-double-pay rule.**

1. A record may become `EXPIRED` only when both of these hold:
   - The ledger that closed at or after `maxTime` (by ledger close time) is
     older than `chainCursor.lastLedger`. That is, the indexer has processed
     every ledger in which the transaction could have been included.
   - Neither (a) nor (b) found its event.

   This applies whether or not a hash was recorded. Until then the UI shows
   "Checking".

2. A late event moves `EXPIRED` to `CONFIRMED` or `MISMATCH`. Rule 1 makes this
   impossible in normal operation, but the transition is defined so that a
   backfill can apply it.
3. "Try again" is offered only for `FAILED` and `EXPIRED`, and it always uses
   a new `client_ref`.
   - `FAILED` means no payment was applied. It is set only when one of these
     holds:
     - RPC returns `FAILED` for the transaction.
     - `sendTransaction` returned `ERROR`.
     - Simulation failed before submission.
   - A transaction that RPC reports as `SUCCESS` never makes a record
     `FAILED`, whatever its events contain. Money may have moved, so the
     record becomes `MISMATCH` ([section 6.4](#64-server-side-verification-details)).
     The UI never offers a retry for it (I-24).
4. Core rejects a reused `(tipper, client_ref)` for one day
   (`DuplicateClientRef`).

**RPC retention.** Testnet RPC reports `ledgerRetentionWindow` 120,960 ledgers
(about 7 days) from `getHealth`. The window applies to both `getTransaction`
and `getEvents`: on 2026-11-26, a June 2026 transaction returned `NOT_FOUND`,
and the response reported the same `oldestLedger`. Records still unresolved at
the edge of retention are flagged for manual review.

**Status sets:**

| Record kind           | States                                                                                                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct and batch tips | `PREPARED` → `SUBMITTED` → `CONFIRMED` \| `MISMATCH` \| `FAILED` \| `EXPIRED`. Also `PREPARED` → `EXPIRED`, and `EXPIRED` → `CONFIRMED` \| `MISMATCH`. `MISMATCH` carries `mismatchReason` (`author`, `field:<name>`, `no_event`). `field:*` and `no_event` also set `needsReview`. |
| Tab tips              | `ACCEPTED` → `SETTLED`; `ACCEPTED` → `SHORTFALL` → `SETTLED` \| `UNPAID`; `REJECTED` (excluded by settler bisection, for review); `VOID_RESET` (a testnet reset only)                                                                                                               |
| Chain submissions     | As direct tips                                                                                                                                                                                                                                                                      |

`UNPAID` is terminal. It is set when the account is `CLOSED` and the key's
settle window has ended with `paid < cumulative_after`.

## 6.2 Convex schema changes

**Conventions for new tables:**

- Every row carries `network` (`'TESTNET'` | `'MAINNET'`) and `chainEpoch`.
  `chainEpoch` is a string that identifies one deployment of the v2 contracts,
  for example `testnet-2026-12-01`. A testnet reset starts a new epoch
  ([section 7.4](07-security-and-recovery.md#74-failure-recovery)).
- Amounts are decimal strings of base units.

| Table              | Key fields                                                                                                                                                                                                                                                                     | Indexes                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `chainConfig`      | `coreContractId`, `tabContractId`, `nftContractId`, `tokenContractId`, `minTip`, `feeBps`, `nftThreshold`, `paused` (per contract), `refreshedAt`                                                                                                                              | `by_network`                                                                                          |
| `chainArticles`    | `articleId`, `articleKey` (hex), `authorAddress`, `pendingAuthor?`, `contentHash`, `arweaveId?`, `contentVersion`, `splits`, `totals` (per token, from `Tipped.total_after`), `status` (`PREPARED` \| `SUBMITTED` \| `REGISTERED` \| `FAILED`), `registeredLedger?`, `txHash?` | `by_article`, `by_article_key`, `by_author_address`                                                   |
| `chainSubmissions` | `kind`, `userId?`, `contractId`, `requestId`, `clientRefs`, `txHash?`, `maxTime`, `status`, `attempts`, `lastError?`, `related` (ids)                                                                                                                                          | `by_request`, `by_tx`, `by_status_updated`                                                            |
| `chainEvents`      | `eventId` (RPC id), `contractId`, `ledger`, `ledgerCloseTime`, `txHash`, `type`, `topics`, `data` (decoded JSON), `handled` (`pending` \| `done` \| `orphan` \| `error`)                                                                                                       | `by_event_id` (unique by use), `by_type_ledger`, `by_tx`, `by_handled`                                |
| `chainCursor`      | `cursor`, `lastLedger`, `lastLedgerCloseTime`, `latestLedger`, `oldestLedger`, `lagLedgers`, `status` (`OK` \| `LAGGING` \| `BEHIND_RETENTION`), `updatedAt`                                                                                                                   | `by_network`                                                                                          |
| `chainLeases`      | `name`, `holder`, `expiresAt`                                                                                                                                                                                                                                                  | `by_name`                                                                                             |
| `tabAccounts`      | `userId`, `readerAddress`, `tabContractId`, `status` (`OPEN` \| `CLOSING` \| `CLOSED`), `confirmedBalance`, `outstanding`, `acceptedToday`, `withdrawUnlockLedger?`                                                                                                            | `by_user`, `by_reader`                                                                                |
| `tabSessionKeys`   | `tabAccountId`, `keyId`, `publicKey`, `validUntilLedger`, `spendLimit`, `spentOnChain`, `revoked`, `extractable`                                                                                                                                                               | `by_account_key`                                                                                      |
| `tabReceipts`      | `tabAccountId`, `keyId`, `writerAddress`, `authorId`, `articleId`, `highlightId?`, `seq`, `amount`, `cumulativeAfter`, `clientRef`, `contentHash`, `leafHash`, `tipRowId`, `status`, `settlementId?`                                                                           | `by_pair_seq` (`tabAccountId`, `keyId`, `writerAddress`, `seq`), `by_status_created`, `by_client_ref` |
| `tabVouchers`      | `tabAccountId`, `keyId`, `writerAddress`, `cumulative`, `receiptsRoot`, `leafHashes` (at most 256), `signature`, `acceptance`, `seq`, `paidOnChain`, `oldestUnsettledAt?`                                                                                                      | `by_pair`, `by_writer`, `by_due` (`paidOnChain < cumulative`, `oldestUnsettledAt`)                    |
| `tabSettlements`   | `submissionId`, `txHash?`, `voucherIds`, `gross`, `fee`, `ledger?`, `status`                                                                                                                                                                                                   | `by_status`                                                                                           |

**Changed tables:**

1. **`tips` and `highlightTips`.**
   - New optional fields: `contractVersion` (`'v1'` | `'v2'`), `channel`
     (`'direct'` | `'batch'` | `'tab'`), `clientRef`, `tokenContractId`,
     `grossBaseUnits`, `feeBaseUnits`, `netBaseUnits`, `onChainAuthorAddress`,
     `chainEventId`, `tabReceiptId`, `requestId`, `submissionId`.
   - Fields that become optional, because tab tips and batch items have no
     value at insert: `highlightTips.stellarTxId`, `highlightTips.stellarNetwork`,
     `highlightTips.stellarMemo` and `highlightTips.processedAt`.
   - New index `by_client_ref`. `by_stellar_tx` stays, but no longer implies
     uniqueness, because batch rows share a hash.
2. **`articleNFTs`.**
   - Add `contractVersion`, `txHash`, `chainVerifiedAt` and `ownerAddress`. The
     address is the source of truth.
   - `currentOwner` becomes optional. It is set only when `ownerAddress`
     resolves to a QuillTip user.
3. **`nftTransfers`.**
   - `toUserId` becomes optional. Add `toAddress` and `fromAddress`.
   - `transactionId` is required for v2 rows.
4. **`authorEarnings`.**
   - Add `earnedBaseUnits`, `pendingBaseUnits` and `collectedBaseUnits`. Each
     is keyed by token contract ID.
   - Apply these updates per channel and state:

     | Event                                                    | Update                                                                                |
     | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
     | Direct or batch tip `CONFIRMED` or `MISMATCH`            | `earned += net` for the on-chain recipient's user (nothing if the address is unknown) |
     | Tab tip `ACCEPTED`, `TabSettled`, `UNPAID`, `VOID_RESET` | Recompute the pair's figures from the formulas below                                  |
     | `Claimed`                                                | `collected += amount`                                                                 |

   - **Tab figures per `(reader, key_id, writer)` pair.** These use the same
     cumulative fee rule as the contract (I-31), so they leave no rounding
     residue:
     - `netOf(x) = x − floor(x × 250 / 10,000)`
     - `earned_pair = netOf(paidOnChain)`
     - `pending_pair = netOf(acceptedCumulative) − netOf(paidOnChain)`
       while the pair can still settle. It is 0 once the pair is `UNPAID` or
       `VOID_RESET`.
     - A writer's tab `pending` and `earned` are the sums over their pairs.
   - The cent fields (`totalEarnedCents` and so on) are still computed for
     display. They use the price quote stored on each tip row when it reached
     the state above.

**Backfill.** One internal migration, run on the non-production deployment
first, sets `contractVersion: 'v1'` on every existing tip, highlight-tip and
NFT row.

## 6.3 Convex functions

New modules:

| Module                                | Functions                                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `convex/lib/chain/rpc.ts`             | Typed RPC client (`getTransaction`, `getEvents`, `getLatestLedger`, `getHealth`, `simulateTransaction` for views). XDR event decoding by contract spec. Endpoint selection goes through the network guard.                                                   |
| `convex/lib/chain/ids.ts`             | Identifier and `canonicalArticleBytes` derivations ([section 1.4](01-architecture.md#14-identifiers)). They are checked against the shared test vectors.                                                                                                     |
| `convex/lib/chain/voucher.ts`         | Payload bytes, receipt leaf, Merkle root, ed25519 verify and acceptance signing, using `@noble/curves` and `@noble/hashes` in the default Convex runtime                                                                                                     |
| `convex/lib/chain/lease.ts`           | Single-flight leases on `chainLeases` for the indexer, settler and recheck crons                                                                                                                                                                             |
| `convex/chain/config.ts`              | `getChainConfig` (public query: network, contract IDs, `minTip`, pause state); `refreshChainConfig` (internal action, hourly cron)                                                                                                                           |
| `convex/chain/articles.ts`            | `prepareRegistration`, `prepareContentUpdate`, `prepareAuthorProposal`, `prepareAuthorAccept`, `getRegistration` (query)                                                                                                                                     |
| `convex/chain/submissions.ts`         | `recordSubmitted`, `getSubmissionStatus` (query), internal `verifySubmission`, and the `recheckPending` cron with the expiry rule of [section 6.1](#61-transaction-lifecycle)                                                                                |
| `convex/chain/indexer.ts`             | Internal `pollEvents` (cron, every minute, under a lease), `handleEvent` per type, `getIndexerStatus` (query, restricted to `OPS_USER_IDS`)                                                                                                                  |
| `convex/tipsV2.ts`                    | `prepareDirectTip`, `prepareHighlightTip`, `prepareBatch`, `recordSubmitted`, `getTipStatus`                                                                                                                                                                 |
| `convex/tabs.ts`                      | `getMyTab`, `prepareOpen`, `prepareDeposit`, `prepareRegisterKey`, `prepareRevokeKey`, `prepareWithdrawStart`, `prepareWithdraw`, `prepareTip`, `submitTip`, `getWriterPending`, `getLatestVouchersForWriter` (countersigned, for download and `settle_own`) |
| `convex/tabSettler.ts` (`"use node"`) | Internal `settleDue` (cron, every 10 minutes, under a lease, only when `SETTLEMENT_ENABLED=true`), the settler balance alert, and `SettlementSubmitter` (`localKey`, `relayer`)                                                                              |
| `convex/nftsV2.ts`                    | `getMintEligibility` (live from Core), `prepareMint`, `prepareTransfer`, and the metadata query for `/api/nft/[id]`                                                                                                                                          |

**Guard rules for server code:**

- Every server action that touches Stellar calls `assertBackendTestnet()`.
- The settler and acceptor paths also require `SETTLEMENT_ENABLED=true` and
  their secrets to be set.
- They do **not** call `assertNonProductionBackend`. That function refuses the
  live deployment by design (`kind: 'deploy'`), and settlement must run where
  tab tips are accepted.

**Changed functions.** These have their own issue
([section 8.8](08-testing-and-deployment.md#88-issue-map)).

- **Tip queries.** `convex/tips.ts` (`getArticleTips`, `getArticleTipStats`,
  `getUserSentTips`, `getUserReceivedTips`, `getAuthorEarnings`,
  `canTip`) and the `convex/highlightTips.ts` read queries:
  - Read v1 and v2 rows, labelled by `contractVersion`.
  - Earnings follow the `authorEarnings` rules.
  - Article totals come from `chainArticles.totals`, which includes tips made
    outside the app.
  - `canTip` requires `chainArticles.REGISTERED`.
- **`convex/articles.ts` `publishArticle`.** Computes `contentHash` from
  `canonicalArticleBytes`, and exposes the registration state.
- **`convex/arweave.ts`.** Uploads `canonicalArticleBytes` as the body. The
  upload time moves to a tag.
- **`convex/crons.ts`.** Adds `pollEvents` (1 min), `recheckPending` (2 min),
  `settleDue` (10 min) and `refreshChainConfig` (1 h).

**Removed after cutover** ([section 8.6](08-testing-and-deployment.md#86-removal-after-cutover)):

- From `convex/tips.ts`: `prepareArticleTip`, `submitArticleTip`,
  `retryArticleTipVerification`, `sendTip`, `confirmTip` and
  `markArticleTipFraudulent`.
- From `convex/highlightTips.ts`: `prepareHighlightTip`, `submitHighlightTip`,
  `retryHighlightTipVerification`, `getHighlightTipRecoveryStatus` and `create`.
- Whole files: `convex/articleTipVerify.ts`, `convex/stellarVerify.ts`,
  `convex/lib/horizon.ts` and `convex/lib/articleTipExpectation.ts`.
- The v1 functions in `convex/reconcileTips.ts`.
- From `convex/nfts.ts`: `mintNFT` and `transferNFT`.

## 6.4 Server-side verification details

The comparison uses exact integers in base units. Prices never enter
verification. The verifier:

1. Reads the transaction's events from `getTransaction`. Only events from the
   configured contract ID count.
2. Requires exactly one `Tipped` event for each expected `client_ref` in the
   transaction. It ignores unrelated events.
3. Compares the **payment fields**:
   - `article_id`, `tipper`, `token`, `gross`, `client_ref` and `highlight_id`
   - `fee == floor(gross × 250 / 10,000)`

   If a payment field differs, the record becomes `MISMATCH` with
   `mismatchReason = field:<name>` and `needsReview = true`. It never becomes
   `FAILED`, because the transaction succeeded and may have moved money.

   This cannot happen for a transaction built from the record, because the
   contract enforces those values. It therefore means the envelope was
   altered. Earnings follow the decoded event. No retry is offered (I-24).
   - If a `SUCCESS` transaction holds no `Tipped` event for the expected
     `client_ref`, the record becomes `MISMATCH` with `mismatchReason =
no_event` and `needsReview = true`. No retry is offered either.

4. Compares the recipient. If `author` differs from the expected author, the
   money went to the registered on-chain author, for example after an author
   change. The record becomes `MISMATCH` with `onChainAuthorAddress` set.
5. Records `content_hash` and `content_version` for display only.
6. Requires the transaction ledger to be at or after the record's creation
   ledger.
7. Deduplicates on `(txHash, clientRef)`. A batch's rows share one hash, linked
   through `chainSubmissions`.

## 6.5 Event indexer

1. **Lease.** `pollEvents` runs every minute and takes the `indexer` lease
   first, so the cursor never moves backwards.
2. **Request.** It calls `getEvents` with:
   - `filters: [{type: 'contract', contractIds: [core, tab, nft]}]`
   - `limit: 1000`
   - `pagination.cursor` set to the stored cursor. On the first run it uses
     `startLedger = INDEXER_START_LEDGER` instead.
3. **Paging.** It loops until a page holds fewer than `limit` events, with at
   most 10 pages per run.
4. **Storing.** It inserts each event into `chainEvents` if its `eventId` is
   new, then dispatches by type:

   | Event type                                                                                      | Handler action                                                                                                                                                                                                                               |
   | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `Tipped`                                                                                        | Confirm or link the record by `client_ref` (rule (b)). Update `chainArticles.totals` from `total_after`. An unknown `client_ref` is a valid tip made outside the app: mark the event `orphan`. It shows in article totals, not in tip lists. |
   | `TabSettled`, `VoucherSkipped`                                                                  | Update vouchers and receipts                                                                                                                                                                                                                 |
   | `ArticleRegistered`, `ContentUpdated`, `AuthorProposed`, `AuthorChanged`, `SplitsSet`           | Update `chainArticles`                                                                                                                                                                                                                       |
   | `Deposited`, `WithdrawStarted`, `WithdrawCancelled`, `Withdrawn`, `KeyRegistered`, `KeyRevoked` | Update tabs                                                                                                                                                                                                                                  |
   | `Claimed`                                                                                       | Update `authorEarnings.collected`                                                                                                                                                                                                            |
   | `ArticleNftMinted`, OpenZeppelin `transfer`                                                     | Update NFTs                                                                                                                                                                                                                                  |

5. **Cursor.** It saves the new cursor, `lastLedger` and its close time,
   `latestLedger` and `oldestLedger` (both from `getHealth`), and
   `lagLedgers = latestLedger − lastLedger`.
6. **Alerts.**
   - `LAGGING` when `lagLedgers > 720` (1 h).
   - `BEHIND_RETENTION` when `lastLedger < oldestLedger`. Events were missed.
     Recovery is in [section 7.4](07-security-and-recovery.md#74-failure-recovery).

   An alert is a structured `console.error` with code `CHAIN_INDEXER_*`. Ops
   reads the status at `app/ops/chain`, which is restricted to `OPS_USER_IDS`.

**Contract sets and start ledger.** Each Convex deployment uses its own
contract set: Core, Tab and NFT, with their own settler key, acceptor key and
treasury. The sets are deployed separately ([section 8.4](08-testing-and-deployment.md#84-testnet-deployment-procedure)).

- **No sharing between deployments.** No two Convex deployments settle,
  accept or index on the same Tab. Leases, settler sequence numbers,
  `acceptor_keys` slots and indexer cursors therefore never collide.
- **Start ledger.** `INDEXER_START_LEDGER` is the ledger of the Core deploy
  transaction of that deployment's own set.

Handlers are idempotent, keyed by `eventId`, so replaying a range is safe.

## 6.6 Client modules

Modules in `lib/stellar/v2/`:

| File                              | Responsibility                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config.ts`                       | Reads the network, RPC URL, passphrase and contract IDs from env and validates them. Refuses any network other than `TESTNET` while the guard is in place.                           |
| `bindings/{core,tab,nft}/`        | Generated by `stellar contract bindings typescript --wasm <built wasm>`. Committed, and regenerated by a script whenever the Wasm changes. CI checks that they are up to date.       |
| `ids.ts`                          | Identifier derivations, checked against the shared test vectors                                                                                                                      |
| `tx.ts`                           | Lifecycle helpers: simulate, sign, send and poll, following [section 6.1](#61-transaction-lifecycle). Returns typed outcomes.                                                        |
| `wallet.ts`                       | Stellar Wallets Kit 2.x adapter: `StellarWalletsKit.init`, `authModal`, `getAddress` and `signTransaction`. Rejects a wallet whose network passphrase is not the testnet passphrase. |
| `errors.ts`                       | Maps contract error codes to messages, for all three contracts and the OpenZeppelin codes used                                                                                       |
| `tab/session-key.ts`              | Key generation and storage ([section 3.5](03-tab-contract.md#35-session-keys))                                                                                                       |
| `tab/voucher.ts`, `tab/merkle.ts` | Payload and receipt encoding, and the Merkle root                                                                                                                                    |
| `tab/local-ledger.ts`             | IndexedDB record per `(key, writer)`: the last signed cumulative and every leaf hash. Used for the step-2 check in [section 5.6](05-flows-and-admin.md#56-tab-tip).                  |

**Components:**

- `TipButton` and `HighlightTipButton` switch to `tipsV2`. When a tab is open
  with an active key and the article has no splits, they offer "Tip from tab"
  with no wallet prompt.
- New: `components/tab/` (open, balance, top-up, keys and close) and
  `components/earnings/CollectPanel` (claim, voucher download and `settle_own`).
- `components/nft/MintButton` and `TransferModal` submit real transactions.

**Mobile:**

- Mobile wallets connect through the Wallets Kit WalletConnect module. Which
  wallets sign Soroban envelopes over WalletConnect is checked in the Wallets
  Kit issue and listed in the user help.
- Safari can evict IndexedDB data after 7 days without a visit. A reader who
  returns after eviction has lost the session key. The tab UI shows this case
  ("This device's quick-tip key is gone") and offers registering a new key.
  Funds are not affected.

## 6.7 Client SDK upgrade scope

**Decision.** Move to `@stellar/stellar-sdk` 17.4.x and
`@creit.tech/stellar-wallets-kit` 2.8.x before the v2 flows. Do it in two
issues:

1. Port the v1 code to SDK 17, with no UI change.
2. Swap the Wallets Kit 2 adapter.

**Reasons:**

1. Bindings generated by Stellar CLI 30 target the current SDK major.
2. Wallets Kit 2.8 depends on `@stellar/stellar-sdk ^17.0.0`, and it ships the
   current module for the SDF extension wallet, now named Varial.
3. The v1 payment code, which carries most of the XDR API surface, is replaced
   anyway. Upgrading first avoids porting code that will be deleted.

**Credentials.** SDK 17 requests CAP-71 address-bound credentials in
simulation for addresses other than the transaction source. The flows in this
specification never need such an address, as step 4 of
[section 6.1](#61-transaction-lifecycle) explains.

**Constraints the SDK issue verifies:**

- SDK 17 requires Node `>=22.12.0`. The issue confirms the Node version of the
  Vercel build runtime and of the Convex `"use node"` runtime.
- If the Convex Node runtime is older, server code uses only XDR and strkey,
  with RPC over `fetch` in the default runtime.

## 6.8 Environment variables and network guard

| Variable                                               | Where          | Value (testnet)                                                                                                                      |
| ------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_STELLAR_NETWORK`, `STELLAR_NETWORK`       | client, Convex | `TESTNET`                                                                                                                            |
| `NEXT_PUBLIC_STELLAR_RPC_URL`, `STELLAR_RPC_URL`       | client, Convex | `https://soroban-testnet.stellar.org`                                                                                                |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE`, `NETWORK_PASSPHRASE` | client, Convex | `Test SDF Network ; September 2015`                                                                                                  |
| `NEXT_PUBLIC_CORE_CONTRACT_ID`, `CORE_CONTRACT_ID`     | client, Convex | From the deployment evidence for this deployment's own contract set                                                                  |
| `NEXT_PUBLIC_TAB_CONTRACT_ID`, `TAB_CONTRACT_ID`       | client, Convex | Same                                                                                                                                 |
| `NEXT_PUBLIC_NFT_CONTRACT_ID`, `NFT_CONTRACT_ID`       | client, Convex | Same                                                                                                                                 |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID`, `TOKEN_CONTRACT_ID`   | client, Convex | Native XLM SAC on testnet                                                                                                            |
| `CHAIN_V2_ENABLED`                                     | Convex         | Gates v2 prepare functions. `false` until cutover.                                                                                   |
| `CHAIN_V1_PREPARES_ENABLED`                            | Convex         | `true` until cutover step 4. Gates v1 prepare functions. Removed with the v1 code.                                                   |
| `INDEXER_START_LEDGER`                                 | Convex         | Per deployment ([section 6.5](#65-event-indexer))                                                                                    |
| `SETTLEMENT_ENABLED`                                   | Convex         | `true` on every deployment where `CHAIN_V2_ENABLED=true`                                                                             |
| `TAB_SETTLER_SECRET`, `TAB_ACCEPTOR_SECRET`            | Convex         | Testnet keys. Read only after `assertBackendTestnet()`. Set on the live deployment by the owner at cutover. Never in `.env.example`. |
| `TAB_DAILY_LIMIT`, `TAB_TIP_MAX`                       | Convex         | `200000000`, `50000000`                                                                                                              |
| `OPS_USER_IDS`                                         | Convex         | Comma-separated Convex user IDs that may read the ops status                                                                         |

`.env.example` gets placeholders only. The removed variables are listed in
[section 8.6](08-testing-and-deployment.md#86-removal-after-cutover).

**Network guard update.** This work comes before any v2 Stellar code
([section 8.8](08-testing-and-deployment.md#88-issue-map)).

1. `scripts/lib/network-guard.ts` and `convex/lib/networkGuard.ts` also read
   `STELLAR_RPC_URL`, `NEXT_PUBLIC_STELLAR_RPC_URL`, `NETWORK_PASSPHRASE` and
   `NEXT_PUBLIC_NETWORK_PASSPHRASE`. Mainnet hosts and the mainnet passphrase
   are refused, as for the existing variables. Tests cover each new variable.
2. `assertBackendTestnet()` checks the passphrase and the RPC URL, not only
   `STELLAR_NETWORK` and `HORIZON_URL`.
3. A `LOCAL` mode exists for CI and developer machines:
   - It accepts only the standalone passphrase
     `Standalone Network ; February 2017` and RPC URLs on `localhost` or
     `127.0.0.1`.
   - It requires `QUILLTIP_NETWORK_GUARD_OPT_IN=local`.
   - It is never valid for a Convex cloud deployment.
4. Every script that calls the Stellar CLI passes `--network`, `--rpc-url` and
   `--network-passphrase` explicitly. It never relies on CLI defaults.
5. A Stellar-only variant, `assertScriptStellarTestnetOnly(operation)` (with
   `resolveScriptStellarOnlyNetwork`), serves scripts that touch no Convex
   backend, such as deploy, extend, restore and redeploy.
   - It applies control 1 and the `LOCAL` rules: mainnet is always refused.
   - It does not require a Convex target. The existing
     `assertScriptTestnetOnly` refuses a run without one (`UNKNOWN_CONVEX`).
   - It refuses to run when a Convex deploy key or a live-backend approval is
     set. This keeps it from being used to skip control 2.
   - Scripts that write to Convex, such as the backfill, keep using
     `assertScriptTestnetOnly`.

**Content security policy.** `proxy.ts` gets these changes:

- `script-src` uses per-request nonces, not `'unsafe-inline'`.
- `connect-src` lists the configured RPC origins. The CSP issue adds them.
- The Wallets Kit 2.x WalletConnect relay origins are added by the Wallets Kit
  adapter issue, which decides the modules.

## 6.9 Migration, cutover and rollback

**Migration.**

1. **New contract IDs.** The current testnet tipping and NFT contracts are not
   migrated. They stay on testnet unchanged.
2. **v1 rows.** Existing tip, highlight-tip and NFT rows get
   `contractVersion: 'v1'`. History views show them with a "Testnet v1" label.
   NFT eligibility uses only on-chain v2 totals.
3. **Existing articles.** An article is registered when its author presses
   "Enable tips". Until then the article shows tips as unavailable. Authors
   without a linked wallet are prompted to link one.
4. **Database-only NFT rows.** These show as "v1 record". The author can mint
   a v2 NFT when the article meets the v2 threshold.

**Cutover sequence:**

1. Deploy the integration contract set and run the end-to-end QA on the
   integration deployment.
2. Deploy the live contract set with the same release commit and the same
   procedure, using its own keys ([section 8.4](08-testing-and-deployment.md#84-testnet-deployment-procedure)).
3. On the live deployment, the owner sets the v2 env: the live set's contract
   IDs, the settler and acceptor secrets, `SETTLEMENT_ENABLED=true` and the
   live set's `INDEXER_START_LEDGER`.
4. Freeze v1 prepares (`CHAIN_V1_PREPARES_ENABLED=false`). Let v1
   verification drain, until no v1 record is pending or confirming.
5. Set `CHAIN_V2_ENABLED=true`.
6. Pause the v1 contracts if their admin key is available.
7. Keep the v1 code for one release.
8. Remove the v1 code ([section 8.6](08-testing-and-deployment.md#86-removal-after-cutover)).

**Rollback** (before step 8):

1. Set `CHAIN_V2_ENABLED=false` and `CHAIN_V1_PREPARES_ENABLED=true`. New
   payments go to v1 again.
2. Keep the v2 settler, indexer and exit UI running. Tab views, settlement,
   claim, withdrawal and key revocation do not depend on `CHAIN_V2_ENABLED`, so
   accepted vouchers still settle and readers can leave.
3. Pause the v2 Tab. This blocks only new deposits and keys, and leaves
   settlement and exits open (I-27).
