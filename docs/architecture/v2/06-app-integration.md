# 6. Application integration

[Index](../v2-spec.md)

## 6.1 Transaction lifecycle

Every user transaction (register, tip, batch, tab operations, claim, NFT)
follows these steps.

1. **Prepare (Convex).** Convex creates the server record with the expected values, a `client_ref` where one applies, and `maxTime = now + 300 s`.
   - The prepare mutation takes a client `requestId`. A repeated call with the same `requestId` returns the same record.
2. **Build (client).** The source account is the signer's linked address.
   - The fee starts at `BASE_FEE`, and time bounds are `[0, maxTime]`.
   - The invocation is built from the generated contract bindings.
3. **Simulate (client).** `rpc.Server.prepareTransaction`.
   - A simulation error decodes to a contract error code (sections 2.5, 3.10, 4.4) and maps to a user message in `lib/stellar/v2/errors.ts`. No submission happens.
   - If simulation reports archived entries, the prepared transaction restores them automatically (Protocol 23 and later). The integration test MUST cover a tip to an article whose entries were archived.
4. **Sign (wallet).**
   - **Default:** the wallet signs the envelope. The signer is both the source and the only authorizer, so source-account credentials cover `require_auth`.
   - **`change_author`:** the second address signs its auth entry with `signAuthEntry`.
5. **Send (client).** `sendTransaction`, then act on the returned status:

   | Status            | Action                                                                             |
   | ----------------- | ---------------------------------------------------------------------------------- |
   | `PENDING`         | Record the hash in Convex, then go to step 6.                                      |
   | `DUPLICATE`       | Same as `PENDING`.                                                                 |
   | `TRY_AGAIN_LATER` | Resend the **same** envelope after 2 s, at most 5 times and never after `maxTime`. |
   | `ERROR`           | Decode `errorResult`. Mark `FAILED` with the reason.                               |

6. **Poll (client, for UI only).** Call `getTransaction` every 2 s until `SUCCESS` or `FAILED`, or until `maxTime + 30 s`. The client never decides confirmation.
7. **Verify (Convex, authoritative).** An internal action calls `getTransaction(hash)` and requires `SUCCESS`. It then decodes the events of the expected contract and compares them with the prepared record ([section 5](05-flows-and-admin.md)). If the record matches, it is marked `CONFIRMED`. If it differs, it is marked `FAILED` with `mismatch:<field>`.
   - Retries back off 2, 4, 8 … 60 s up to `maxTime + 10 min`.
   - After that, the `chainSubmissions.recheckPending` cron (every 2 minutes, up to 24 h) takes over.

**Confirmation rule.** A payment record becomes `CONFIRMED` only when at least
one of these holds:

- **(a) Transaction check:** RPC returns `SUCCESS` for its transaction hash, and that transaction contains the expected event from the configured contract with every expected field equal.
- **(b) Indexer check:** the indexer has stored such an event carrying the record's `client_ref`.

Client reports never confirm a payment (invariant I-20).

**Expiry and the no-double-pay rule.**

1. A record still `SUBMITTED` with `NOT_FOUND` at `maxTime + 10 min` becomes `EXPIRED`. The transaction can no longer be included in a ledger.
2. The UI offers "Try again" only for `EXPIRED` or `FAILED` records, and it uses a new `client_ref`.
3. Core also rejects a reused `client_ref` for one day (`DuplicateClientRef`).

**Status sets:**

| Record kind           | States                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Direct and batch tips | `PREPARED` → `SUBMITTED` → `CONFIRMED` \| `FAILED` \| `EXPIRED`                           |
| Tab tips              | `ACCEPTED` → `SETTLED`, or `SHORTFALL` → `SETTLED`, or `VOID` (an alert; must not happen) |
| Chain submissions     | `PREPARED` → `SUBMITTED` → `CONFIRMED` \| `FAILED` \| `EXPIRED`                           |

## 6.2 Convex schema changes

**New tables.**

- Every row carries `network: 'TESTNET' | 'MAINNET'` and `chainEpoch`, a string that identifies one deployment of the v2 contracts (for example `testnet-2026-12-01`).
- A testnet reset starts a new epoch ([section 7.4](07-security-and-recovery.md#74-failure-recovery)).
- Amounts are decimal strings of base units.

| Table              | Key fields                                                                                                                                                                                                  | Indexes                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `chainConfig`      | `coreContractId`, `tabContractId`, `nftContractId`, `tokenContractId`, `minTip`, `feeBps`, `nftThreshold`, `paused` (per contract), `refreshedAt`                                                           | `by_network`                                                                                          |
| `chainArticles`    | `articleId`, `articleKey` (hex), `authorAddress`, `contentHash`, `arweaveId?`, `contentVersion`, `splits`, `status` (`PREPARED` \| `SUBMITTED` \| `REGISTERED` \| `FAILED`), `registeredLedger?`, `txHash?` | `by_article`, `by_article_key`, `by_author_address`                                                   |
| `chainSubmissions` | `kind`, `userId?`, `contractId`, `requestId`, `clientRef?`, `txHash?`, `maxTime`, `status`, `attempts`, `lastError?`, `related` (ids)                                                                       | `by_request`, `by_tx`, `by_status_updated`, `by_client_ref`                                           |
| `chainEvents`      | `eventId` (RPC id), `contractId`, `ledger`, `txHash`, `type`, `topics`, `data` (decoded JSON), `handled` (`pending` \| `done` \| `orphan` \| `error`)                                                       | `by_event_id` (unique by use), `by_type_ledger`, `by_tx`, `by_handled`                                |
| `chainCursor`      | `cursor`, `lastLedger`, `latestLedger`, `oldestLedger`, `lagLedgers`, `status` (`OK` \| `LAGGING` \| `BEHIND_RETENTION`), `updatedAt`                                                                       | `by_network`                                                                                          |
| `tabAccounts`      | `userId`, `readerAddress`, `tabContractId`, `status` (`OPEN` \| `CLOSING` \| `CLOSED`), `confirmedBalance`, `outstanding`, `withdrawUnlockLedger?`                                                          | `by_user`, `by_reader`                                                                                |
| `tabSessionKeys`   | `tabAccountId`, `keyId`, `publicKey`, `validUntilLedger`, `spendLimit`, `spentOnChain`, `revoked`, `extractable`                                                                                            | `by_account_key`                                                                                      |
| `tabReceipts`      | `tabAccountId`, `keyId`, `writerAddress`, `authorId`, `articleId`, `highlightId?`, `seq`, `amount`, `cumulativeAfter`, `clientRef`, `contentHash`, `leafHash`, `tipRowId`, `status`, `settlementId?`        | `by_pair_seq` (`tabAccountId`, `keyId`, `writerAddress`, `seq`), `by_status_created`, `by_client_ref` |
| `tabVouchers`      | `tabAccountId`, `keyId`, `writerAddress`, `cumulative`, `receiptsRoot`, `signature`, `seq`, `paidOnChain`, `oldestUnsettledAt?`                                                                             | `by_pair`, `by_due` (`paidOnChain < cumulative`, `oldestUnsettledAt`)                                 |
| `tabSettlements`   | `submissionId`, `txHash?`, `voucherIds`, `gross`, `fee`, `ledger?`, `status`                                                                                                                                | `by_status`                                                                                           |

**Changed tables:**

- **`tips` and `highlightTips`.** New optional fields:
  - `contractVersion` (`'v1'` | `'v2'`)
  - `channel` (`'direct'` | `'batch'` | `'tab'`)
  - `clientRef`
  - `tokenContractId`
  - `grossBaseUnits`, `feeBaseUnits`, `netBaseUnits`
  - `chainEventId`
  - `tabReceiptId`
  - `requestId`

  New index `by_client_ref`. The status set is widened per [section 6.1](#61-transaction-lifecycle). The v1 fields stay readable until removal.

- **`articleNFTs`.** Add `contractVersion`, `txHash`, `chainVerifiedAt`, and `ownerAddress` (the address is the source of truth; `currentOwner` resolves from it).
- **`nftTransfers`.** `transactionId` becomes required for v2 rows.

**Backfill** (one internal migration, run on the non-production deployment
first): set `contractVersion: 'v1'` on every existing tip, highlight tip and
NFT row.

## 6.3 Convex functions

New modules:

| Module                                | Functions                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `convex/lib/chain/rpc.ts`             | Typed RPC client (`getTransaction`, `getEvents`, `getLatestLedger`, `getHealth`, `simulateTransaction` for views). XDR event decoding by contract spec. Network-guarded endpoint selection.                               |
| `convex/lib/chain/ids.ts`             | Identifier derivations ([section 1.4](01-architecture.md#14-identifiers)), shared with the client by duplicated code and shared test vectors.                                                                             |
| `convex/lib/chain/voucher.ts`         | Payload bytes, receipt leaf, Merkle root, ed25519 verify                                                                                                                                                                  |
| `convex/chain/config.ts`              | `getChainConfig` (query), `refreshChainConfig` (internal action, hourly cron; reads `min_tip`, `fee_bps`, `threshold`)                                                                                                    |
| `convex/chain/articles.ts`            | `prepareRegistration`, `prepareContentUpdate`, `prepareAuthorChange`, `getRegistration` (query)                                                                                                                           |
| `convex/chain/submissions.ts`         | `recordSubmitted`, `getSubmissionStatus` (query), internal `verifySubmission`, `recheckPending` (cron)                                                                                                                    |
| `convex/chain/indexer.ts`             | Internal `pollEvents` (cron, every minute), `handleEvent` per type, `getIndexerStatus` (query, for ops)                                                                                                                   |
| `convex/tipsV2.ts`                    | `prepareDirectTip`, `prepareHighlightTip`, `prepareBatch`, `recordSubmitted`, `getTipStatus`                                                                                                                              |
| `convex/tabs.ts`                      | `getMyTab`, `prepareOpen`, `prepareDeposit`, `prepareRegisterKey`, `prepareRevokeKey`, `prepareWithdrawStart`, `prepareWithdraw`, `prepareTip`, `submitTip`, `getWriterPending`, `getVoucherForWriter` (for `settle_own`) |
| `convex/tabSettler.ts` (`"use node"`) | Internal `settleDue` (cron, every 10 minutes when `SETTLEMENT_ENABLED=true`), `SettlementSubmitter` (`localKey`, `relayer`)                                                                                               |
| `convex/nftsV2.ts`                    | `getMintEligibility` (live from Core), `prepareMint`, `prepareTransfer`, metadata query for `/api/nft/[id]`                                                                                                               |

Every server action that touches Stellar calls `assertBackendTestnet()`. The
settler additionally calls `assertNonProductionBackend('tab-settlement')`.

**Changed functions:**

- `convex/tips.ts` queries (`getArticleTips`, `getArticleTipStats`, `getUserSentTips`, `getUserReceivedTips`, `getAuthorEarnings`): read v1 and v2 rows and label them by `contractVersion`. Earnings count only `CONFIRMED` and `SETTLED` rows. `canTip` requires `chainArticles.REGISTERED`.
- `convex/highlightTips.ts` read queries: the same change.
- `convex/articles.ts` `publishArticle`: compute `contentHash` when it is missing, and expose registration state.
- `convex/crons.ts`: add `pollEvents` (1 min), `recheckPending` (2 min), `settleDue` (10 min), `refreshChainConfig` (1 h).

**Removed at cutover** ([section 8.6](08-testing-and-deployment.md#86-removal-after-cutover)):

- From `convex/tips.ts`: `prepareArticleTip`, `submitArticleTip`, `retryArticleTipVerification`, `sendTip`, `confirmTip`, `markArticleTipFraudulent`.
- From `convex/highlightTips.ts`: `prepareHighlightTip`, `submitHighlightTip`, `retryHighlightTipVerification`, `getHighlightTipRecoveryStatus`, `create`.
- Whole files: `convex/articleTipVerify.ts`, `convex/stellarVerify.ts`, `convex/lib/horizon.ts`, `convex/lib/articleTipExpectation.ts`.
- From `convex/reconcileTips.ts`: the v1 functions.
- From `convex/nfts.ts`: `mintNFT`, `transferNFT`.

## 6.4 Server-side verification details

The decoded event comparison uses exact base-unit integers. Prices never
enter verification. The verifier:

1. Reads the transaction's events from `getTransaction` (`events.contractEventsXdr` in the RPC response). Only events from the configured contract ID count.
2. Requires exactly one matching `Tipped` per expected `client_ref`. Extra unrelated events are ignored.
3. Requires the transaction ledger to be at or after the record's creation ledger.
4. Rejects a hash already linked to another record (`by_stellar_tx`).

## 6.5 Event indexer

1. **Cron:** `pollEvents` runs every minute.
2. **Request:** `getEvents` with:
   - `filters: [{type: 'contract', contractIds: [core, tab, nft]}]`
   - `limit: 1000`
   - `pagination.cursor` = the stored cursor, or `startLedger = INDEXER_START_LEDGER` on first run.
3. **Paging:** loop until a page holds fewer than `limit` events, capped at 10 pages per run.
4. **Storing:** for each event, insert into `chainEvents` if `eventId` is new, then dispatch the handler by type:
   - `Tipped`: confirm or link a record by `client_ref`. An unknown `client_ref` is a valid on-chain tip made outside the app: store it as `orphan` and count it in article totals.
   - `TabSettled` and `VoucherSkipped`: update vouchers and receipts.
   - `ArticleRegistered`, `ContentUpdated`, `AuthorChanged`: update `chainArticles`.
   - `Deposited`, `WithdrawStarted`, `WithdrawCancelled`, `Withdrawn`, `KeyRegistered`, `KeyRevoked`: update tabs.
   - `Claimed`: update earnings.
   - `ArticleNftMinted` and OpenZeppelin `transfer`: update NFTs.
5. **Cursor:** save the new cursor, `lastLedger`, `latestLedger` and `oldestLedger` (from `getHealth`), and `lagLedgers = latestLedger - lastLedger`.
6. **Alerts:**
   - `LAGGING` when `lagLedgers > 720` (1 h).
   - `BEHIND_RETENTION` when `lastLedger < oldestLedger`. Events were missed; [section 7.4](07-security-and-recovery.md#74-failure-recovery) describes recovery.

   An alert is a structured `console.error` with code `CHAIN_INDEXER_*` (log streams) plus `getIndexerStatus` for the ops page.

Handlers are idempotent (keyed by `eventId`), so replaying a range is safe.

## 6.6 Client modules

`lib/stellar/v2/`:

| File                              | Responsibility                                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`                       | Network, RPC URL, passphrase and contract IDs from env, validated. Refuses any network other than `TESTNET` while the guard is in place.                                                           |
| `bindings/{core,tab,nft}/`        | Generated by `stellar contract bindings typescript --wasm <built wasm>`. Committed and regenerated by a script whenever the Wasm changes. CI checks they are up to date.                           |
| `ids.ts`                          | Identifier derivations (shared test vectors)                                                                                                                                                       |
| `tx.ts`                           | Lifecycle helpers: simulate, sign, send and poll with the rules of [section 6.1](#61-transaction-lifecycle). Typed outcomes.                                                                       |
| `wallet.ts`                       | Stellar Wallets Kit 2.x adapter: `StellarWalletsKit.init`, `authModal`, `getAddress`, `signTransaction`, `signAuthEntry`. Rejects a wallet whose network passphrase is not the testnet passphrase. |
| `errors.ts`                       | Contract error code → message map for all three contracts and the OpenZeppelin codes used                                                                                                          |
| `tab/session-key.ts`              | Key generation and storage ([section 3.5](03-tab-contract.md#35-session-keys))                                                                                                                     |
| `tab/voucher.ts`, `tab/merkle.ts` | Payload and receipt encoding, Merkle root                                                                                                                                                          |
| `tab/local-ledger.ts`             | IndexedDB record of the last signed cumulative per (key, writer), used for the step-2 check in [section 5.6](05-flows-and-admin.md#56-tab-tip)                                                     |

**Components:**

- `TipButton` and `HighlightTipButton` switch to `tipsV2`. When a tab is open with an active key, they offer "Tip from tab" with no wallet prompt.
- New: `components/tab/` (open, balance, top-up, keys, close) and `components/earnings/CollectPanel`.
- `components/nft/MintButton` and `TransferModal` use the real transactions.

## 6.7 Client SDK upgrade scope

**Decision:** move to `@stellar/stellar-sdk` 17.4.x and
`@creit.tech/stellar-wallets-kit` 2.8.x as the first client issue, before the
v2 flows.

**Reasons:**

1. Bindings generated by Stellar CLI 30 target the current SDK major.
2. SDK 17 requests CAP-71 address-bound credentials in simulation by default.
3. Wallets Kit 2.8 ships the current module for the SDF extension wallet (renamed to Varial) and requires SDK 17 since 2.6.
4. The v1 payment code that carries most of the XDR API surface is replaced by v2 anyway, so upgrading first avoids porting code that will be deleted.

**Constraints to verify in that issue:**

- SDK 17 requires Node `>=22.12.0`.
- Confirm the Vercel build runtime and the Convex `"use node"` runtime versions. If the Convex Node runtime is older, server-side code uses only the parts of the SDK that run in the default Convex runtime (XDR and strkey), with RPC over `fetch`.
- The v1 code paths that remain until cutover are ported mechanically: `toXDR` → `toXdr`, `Buffer` → `Uint8Array`, and `bigint` fields.

## 6.8 Environment variables

| Variable                                             | Where          | Value (testnet)                                                                            |
| ---------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_STELLAR_NETWORK`, `STELLAR_NETWORK`     | client, Convex | `TESTNET`                                                                                  |
| `NEXT_PUBLIC_STELLAR_RPC_URL`, `STELLAR_RPC_URL`     | client, Convex | `https://soroban-testnet.stellar.org`                                                      |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE`                     | client         | `Test SDF Network ; September 2015`                                                        |
| `NEXT_PUBLIC_CORE_CONTRACT_ID`, `CORE_CONTRACT_ID`   | client, Convex | From the deployment evidence                                                               |
| `NEXT_PUBLIC_TAB_CONTRACT_ID`, `TAB_CONTRACT_ID`     | client, Convex | Same                                                                                       |
| `NEXT_PUBLIC_NFT_CONTRACT_ID`, `NFT_CONTRACT_ID`     | client, Convex | Same                                                                                       |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID`, `TOKEN_CONTRACT_ID` | client, Convex | Native XLM SAC on testnet                                                                  |
| `CHAIN_V2_ENABLED`                                   | Convex         | `false` until cutover; gates v2 prepare functions                                          |
| `INDEXER_START_LEDGER`                               | Convex         | The ledger of the Core deploy transaction                                                  |
| `SETTLEMENT_ENABLED`                                 | Convex         | `true` only on the non-production integration deployment until cutover                     |
| `TAB_SETTLER_SECRET`                                 | Convex         | Testnet settler secret. Read only after `assertBackendTestnet()`. Never in `.env.example`. |

`.env.example` gets placeholders only. The removed variables are listed in
[section 8.6](08-testing-and-deployment.md#86-removal-after-cutover).

## 6.9 Migration from the current contracts

1. **New contract IDs.** The current testnet tipping and NFT contracts are not migrated. They stay on testnet unchanged.
2. **Labelling v1 rows.** Existing tip, highlight-tip and NFT rows get `contractVersion: 'v1'`. History views show them with a "Testnet v1" label. Their totals stay in app history, but NFT eligibility uses only on-chain v2 totals.
3. **Existing articles.** Articles are registered when their author presses "Enable tips". Until then the article shows tips as unavailable. Authors without a linked wallet are prompted to link one.
4. **Existing database-only NFT rows.** These are shown as "v1 record". An author can mint a v2 NFT when the v2 threshold is met.
5. **Cutover sequence:**
   1. Deploy v2 to testnet ([section 8.4](08-testing-and-deployment.md#84-testnet-deployment-procedure)).
   2. Set the env on the integration deployment.
   3. Run the end-to-end QA.
   4. Set `CHAIN_V2_ENABLED=true` where approved.
   5. Pause the v1 contracts if their admin key is available.
   6. Remove the v1 code ([section 8.6](08-testing-and-deployment.md#86-removal-after-cutover)).
