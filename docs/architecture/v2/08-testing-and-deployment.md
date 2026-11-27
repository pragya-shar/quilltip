# 8. Testing, deployment and scope

[Index](../v2-spec.md)

## 8.1 Test plan

Each test names the invariants it covers ([section 7.1](07-security-and-recovery.md#71-invariants)).

- Contract tests run with `cargo test --locked` in `contracts/`.
- Resource tests run against the CLI-built Wasm. Native-mode instruction counts are about 35% lower.
- Test snapshots are committed. CI fails when a snapshot changes without being committed.

| Layer                     | Scope                                                                                                                                                                                                                                                                                                                                          | Invariants                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Unit (Core)               | Every entry point: the happy path and every error code in [section 2.5](02-core-contract.md#25-errors-coreerror-129), in the documented check order. Split-math table tests: 1 to 5 recipients, amounts 40 to 10¹², zero shares. Author proposal and acceptance, including expiry.                                                             | I-1 to I-9                       |
| Unit (Tab)                | Every entry point, error, skip reason and abort condition. Short balance. Spend limit. Withdrawal timing at `unlock − 1` and at `unlock`. A deposit cancels a withdrawal. Duplicate pairs in one batch. Pause scope. Acceptor rotation.                                                                                                        | I-10 to I-18, I-27, I-28, I-31   |
| Unit (NFT)                | Mint below, at and above the threshold. Second mint. Mint by a non-author. Mint after an author change. Transfer with owner and with approval. Royalty info and immutability. Pause.                                                                                                                                                           | I-19, I-20                       |
| Auth                      | `mock_auths` with explicit `MockAuth` trees per invocation, never `mock_all_auths`, for every `require_auth` path. Includes the SAC sub-invocation in the tip auth tree and the `renounce_admin` override.                                                                                                                                     | I-7, I-16, I-17, I-18, I-26      |
| Events                    | Assert the exact topics and data of every event in sections 2.4, 3.9 and 4.4. Assert one `Tipped` per batch item.                                                                                                                                                                                                                              | I-9                              |
| TTL                       | Advance the ledger past the testnet minimum persistent TTL (120,960 ledgers) and past the temporary TTLs. Assert the extensions. Assert that `Session` and `Paid` stay live until `valid_until + SETTLE_GRACE`, including after a revocation, and then expire.                                                                                 | I-25, I-15, I-29                 |
| Property (`proptest`)     | Random amounts and splits: I-1 and I-2 hold exactly. Random voucher sequences: I-11, I-12 and I-31. Random interleavings of deposit, settle, claim and withdraw: I-10 holds after every step.                                                                                                                                                  | I-1, I-2, I-10, I-11, I-12, I-31 |
| Fuzz (`cargo-fuzz`)       | Targets: `tip_batch` inputs, `settle` and `settle_own` voucher vectors (random fields and signatures), and split vectors. A scheduled CI job runs each target for 10 minutes.                                                                                                                                                                  | I-4, I-11, I-14, I-18            |
| Upgrade                   | Deploy the v1 Wasm, write state, upgrade to a test v2 Wasm with a layout-compatible change, then `migrate`. Assert the state is unchanged and a second `migrate` fails. Repeat through the upgrader-contract path.                                                                                                                             | I-28, I-30                       |
| Resource                  | Under the SDK's default mainnet limits, on the built Wasm: Core `tip` with 5 recipients and a highlight; `tip_batch` with 10 items, 24 transfers and highlights; Tab `settle` and `settle_own` with 32 distinct-party vouchers (at most 14,000 event bytes and 200 write entries each); NFT `mint`. Record the figures.                        | caps in sections 2 and 3         |
| Encoding vectors          | `contracts/shared/test-vectors.json` holds identifiers, canonical article bytes, `VoucherPayload` bytes for G/G, G/C and C/C address pairs, acceptance payloads, receipt leaves, Merkle roots and signatures. Rust, Convex (vitest) and the client (vitest) all check them.                                                                    | I-14, I-23                       |
| Local network integration | Quickstart runs in the guard's `LOCAL` mode. The test deploys all three contracts and runs TypeScript tests through the generated bindings for every flow in [section 5](05-flows-and-admin.md). It records event fixtures for the Convex tests.                                                                                               | end to end                       |
| Convex                    | Vitest with `convex-test`. Covers: prepare and submit validation; the state machine, including `MISMATCH` and expiry before and after indexer coverage; the verifier with recorded fixtures; indexer paging, leases and idempotency; tab acceptance rules and concurrency; settler selection order, bisection and shortfall; earnings updates. | I-21, I-22, I-24                 |
| Playwright                | Fixture suites with mocked chain responses: registration, author change, tip, highlight tip, basket, open tab, tab tip, close tab, collect, settle-own, mint and transfer. One opt-in live testnet suite runs against the integration deployment, behind the network guard.                                                                    | UI states                        |

**CI additions:**

1. A `contracts` job: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --locked`, `stellar contract build --optimize`, the Wasm size gate, and the bindings freshness check.
2. A scheduled fuzz job.
3. A local-network integration job.

## 8.2 Reproducible build

1. Build in the `docker.io/stellar/stellar-cli` image, pinned by digest at a 30.0.x tag. Pass `--meta source_repo=github:pragya-shar/QuillTip --meta commit_sha=<sha>`.
2. Record each Wasm's SHA-256 and size in the deployment evidence. A second build of the same commit MUST produce the same hashes.
3. The release workflow generates GitHub artifact attestations for the Wasm files.

## 8.3 Contract metadata

Each contract sets these `contractmeta!` entries:

- `name`
- `version` (the crate version)
- `source_repo`
- `schema_version`

## 8.4 Testnet deployment procedure

The script `scripts/contracts/deploy-v2-testnet.ts` runs these steps.

- It takes `--set integration|live`. Each Convex deployment gets its own contract set, with its own admin, settler, acceptor and treasury keys ([section 6.5](06-app-integration.md#65-event-indexer)).
- It is guarded by `assertScriptStellarTestnetOnly('deploy-v2-testnet')`. The script touches no Convex backend.
- Steps 8 and 9 use the TypeScript bindings and the voucher and acceptance encoders from the local-network integration issue.
- It passes the network, RPC URL and passphrase to the Stellar CLI explicitly.
- Each step is idempotent.

Steps:

1. Check out the recorded release commit (tag `contracts-v2.0.0-testnet.N`) with a clean tree.
2. Build reproducibly ([section 8.2](#82-reproducible-build)). Compare the hashes with the release attestation.
3. Run `stellar contract upload` for each Wasm. Record the Wasm hashes.
4. Deploy Core with these constructor arguments: admin, pauser, upgrader, treasury, the native XLM SAC, and `min_tip = 1_000_000` (0.1 XLM).
5. Deploy Tab with: admin, pauser, upgrader, the settler public key, the native XLM SAC, treasury, `max_balance = 10_000_000_000`, `min_deposit = 10_000_000`, and the acceptor public key.
6. Deploy the NFT with: admin, pauser, upgrader, the Core ID, the native XLM SAC, `threshold = 500_000_000`, and `base_uri`.
7. Read back every view (`fee_bps`, `min_tip`, `config`, `threshold`, roles) and compare each with its expected value.
8. Run the smoke flows with test accounts funded by Friendbot:
   1. register
   2. tip
   3. highlight tip
   4. batch tip
   5. open tab
   6. tab tip
   7. settle
   8. `settle_own`
   9. claim
   10. withdraw start
   11. mint
   12. transfer
9. Write `docs/contracts/v2-testnet-deployment.md`, with one section per contract set. It is committed and contains no secrets. It records:
   - the commit, tool versions and image digest
   - the Wasm hashes and sizes
   - the contract IDs, and the deploy and constructor transaction hashes with their ledgers
   - the role and acceptor public keys
   - the configuration values
   - the smoke transaction hashes
   - the set's `INDEXER_START_LEDGER`
10. For the integration set, set the env values on the integration deployment ([section 6.8](06-app-integration.md#68-environment-variables-and-network-guard)). For the live set, run steps 1 to 9 at cutover and list the values that the owner sets on the live deployment ([section 6.9](06-app-integration.md#69-migration-cutover-and-rollback)).

## 8.5 Mainnet release differences

A mainnet release needs no contract redesign. It does need the following:

1. **SDK and library gate.** Move to an OpenZeppelin release on a supported `soroban-sdk` major, then re-run every test ([section 1.3](01-architecture.md#13-dependency-pins)). This is a dependency migration.
2. **Independent security review** of the three contracts and the tab protocol, with the findings resolved.
3. **Keys:**
   - Admin and treasury become 2-of-3 multisig accounts.
   - The upgrader becomes an OpenZeppelin timelock whose minimum delay exceeds `WITHDRAW_DELAY + 2 days`.
   - The settler moves to a hosted relayer or a KMS-backed key, and so does the acceptor.
   - The deployer key is separate and unused after deploy.
4. **Configuration:**
   - Add USDC, or another stable asset, with `set_token`, plus a second Tab instance for it.
   - Review the limits and thresholds.
   - The mainnet minimum persistent TTL is 120 days, against 7 days on testnet.
5. **Network guard.** Only a separate, reviewed code change lifts the mainnet refusal.
6. **Infrastructure:** a paid mainnet RPC provider, plus an archive source for backfill.
7. **Product:**
   - UI labels change from testnet to production wording.
   - The terms are updated.
   - A pause drill runs.

## 8.6 Removal after cutover

One release after cutover ([section 6.9](06-app-integration.md#69-migration-cutover-and-rollback)), once v2 is verified on testnet, remove the following. The cutover runbook (`docs/operations/payments-v2-cutover.md`, sections 5 stage 8 and 8) sets the order.

- **Contracts:** `contracts/tipping/` (the whole crate), its CI step and its `test:contracts` part. The v1 `contracts/article-nft` code is already replaced in place.
- **Convex:** the functions listed in [section 6.3](06-app-integration.md#63-convex-functions), after the client that calls them is removed and deployed.
- **Tables:**
  - `articleTipIntents` and `highlightTipIntents` stay as a read-only audit trail: existing tip rows refer to them.
  - `withdrawals` (unused).
- **Client:**
  - The v1 fallbacks and what only they render: `TipButtonV1`, `HighlightTipButtonV1`, `NFTIntegrationV1`, `MintButton`, `TransferModal`, `NFTBadge`, the v1 tip steps and `WalletTooltip`. `TipButton`, `HighlightTipButton` and `NFTIntegration` stay and render only v2.
  - `lib/stellar/client.ts` (the v1 builders, including the batch builders), `nft-client.ts` (the whole file is v1), `types.ts`, `sdk-loader.ts`, `memo-utils.ts`, `is-valid-stellar-account-id.ts`, `price-fallback.ts`, `stellar-flow-emitter.ts` and `tip-error-messages.ts`.
  - The v1 sign-in resume (the v1 files in `lib/tip/`, not `lib/tip/v2/`, and `hooks/useArticleTipResume.ts`; the auth forms that read `pendingTipIntent` change with it) and the stored v1 receipts (`pendingArticleTipReceipt`, `pendingHighlightTipReceipt`).
  - The v1 fields of `lib/stellar/config.ts`. The network fields stay.
  - `lib/stellar/wallet-adapter.ts` is already gone; `lib/stellar/v2/wallet.ts` replaced it.
- **Env:**
  - `NEXT_PUBLIC_TIPPING_CONTRACT_ID`
  - `NEXT_PUBLIC_PLATFORM_ADDRESS`
  - `NEXT_PUBLIC_NFT_CONTRACT_ID` (the v1 NFT; v2 reads `NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID`)
  - `NEXT_PUBLIC_NFT_METADATA_URL`
  - `NEXT_PUBLIC_HORIZON_URL`
  - `NEXT_PUBLIC_SOROBAN_RPC_URL` (renamed)
  - `TIPPING_CONTRACT_ID`
  - `HORIZON_URL`
  - `RECONCILE_TIPS_ENABLED`
  - `CHAIN_V1_PREPARES_ENABLED`

  Some of these have readers outside the v1 code (the network guard, the content security policy, CI); the runbook's section 8 lists them.

- **Docs:** v2 documents replace `docs/tipping-contract-testnet-deploy.md` and `docs/highlight-tipping.md`.

**Kept:** v1 data rows, labelled `contractVersion: 'v1'`, and the reads that show them (section 6.3).

## 8.7 Feature map

| Stated payment feature                                    | v2 design element                                                                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tip an article                                            | `Core.tip` ([2.2](02-core-contract.md#tipping)), flow [5.2](05-flows-and-admin.md#52-direct-article-tip)                                                                   |
| Tip a highlighted passage, with a unique ID per selection | `highlight_id` in `Core.tip` and the `Tipped` event ([1.4](01-architecture.md#14-identifiers), [5.3](05-flows-and-admin.md#53-highlight-tip)); tab receipts                |
| Bind each tip to the highlight and the content            | `highlight_id` and `content_hash` in contract events. Tab tips use receipts and `receipts_root`. Soroban transactions carry no memo, so contract events take that role.    |
| Writers receive 97.5%, platform 2.5%                      | Constant `FEE_BPS = 250` in Core and Tab (I-1, I-13, I-31)                                                                                                                 |
| Payment channels for efficient micropayments              | Tab contract: prepaid balance, off-chain signed and countersigned vouchers, batched settlement, writer self-settlement, withdrawal delay ([section 3](03-tab-contract.md)) |
| Batched micropayments                                     | `Core.tip_batch` (up to 10 tips per signature). `Tab.settle` (up to 32 vouchers per transaction, each covering up to 256 tips).                                            |
| Fewer on-chain transactions                               | Tab tips need no transaction per tip. The ratio is measured on testnet and reported in the deployment evidence. It is not assumed.                                         |
| Content anchoring (hash, Arweave)                         | `content_hash` over canonical article bytes and `arweave_id`, set in `Core.register_article` with author authorisation                                                     |
| Article NFT at a tip threshold                            | `Nft.mint` reads the Core total of direct tips ([section 4](04-nft-contract.md)). Tab tips do not count.                                                                   |
| NFT royalty                                               | OpenZeppelin `royalties`, 1,000 bps, fixed at mint                                                                                                                         |
| Revenue splits between collaborators                      | Core co-author splits, up to 5 recipients, for direct tips. Articles with splits accept direct tips only.                                                                  |
| Transaction monitoring and indexing                       | RPC verification and the Convex event indexer ([6.4](06-app-integration.md#64-server-side-verification-details), [6.5](06-app-integration.md#65-event-indexer))            |
| Wallet integration                                        | Stellar Wallets Kit 2.x ([6.6](06-app-integration.md#66-client-modules))                                                                                                   |
| Mainnet readiness                                         | No contract redesign. A dependency upgrade, a security review, key custody changes and a reviewed guard change ([8.5](#85-mainnet-release-differences)).                   |

## 8.8 Issue map

Issues can start as soon as their dependencies are merged. Issues in the same
group can run in parallel.

| Group | Issues                                                                                                                                      | Needs                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1     | #439 contract workspace and CI · #440 SDK 17 port · #452 network guard update · #453 canonical article bytes · #454 content security policy | the specification                        |
| 2     | #442 Core · #443 Tab · #444 NFT                                                                                                             | #439                                     |
| 2     | #441 Convex chain layer                                                                                                                     | #452                                     |
| 2     | #455 Wallets Kit 2.8 adapter                                                                                                                | #440                                     |
| 3     | #445 bindings and local network                                                                                                             | #442, #443, #444, #440, #452             |
| 3     | #456 event indexer: dispatcher, Core and article handlers                                                                                   | #441                                     |
| 3     | #457 read queries and earnings for direct and batch tips                                                                                    | #441                                     |
| 4     | #446 testnet deployment (one contract set per Convex deployment)                                                                            | #442, #443, #444, #452, #445             |
| 4     | #447 Convex tab ledger and voucher acceptance, tab event handlers and tab earnings                                                          | #441, #456, #439, #443, #445             |
| 4     | #458 registration and author change                                                                                                         | #441, #445, #453, #455                   |
| 5     | #465 Convex tab settler                                                                                                                     | #447                                     |
| 5     | #459 operations scripts                                                                                                                     | #446, #452, #456                         |
| 5     | #448 client tip flows                                                                                                                       | #458, #456, #457                         |
| 5     | #450 NFT UI and NFT event handlers                                                                                                          | #458, #456, #445                         |
| 6     | #449 tab UI                                                                                                                                 | #447, #448, #454                         |
| 7     | #451 cutover and removal                                                                                                                    | #446, #448, #449, #450, #459, #457, #465 |

**Handler ownership.**

- #456 provides the dispatcher, the cursor, the leases and the handlers for Core events.
- #447 registers the Tab handlers. #450 registers the NFT handlers.
- Tab earnings rules belong to #447. Direct and batch earnings rules belong to #457.
