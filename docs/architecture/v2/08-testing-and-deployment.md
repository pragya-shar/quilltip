# 8. Testing, deployment and scope

[Index](../v2-spec.md)

## 8.1 Test plan

Each test names the invariants it covers ([section 7.1](07-security-and-recovery.md#71-invariants)).
Contract tests run with `cargo test --locked` in `contracts/`. Test snapshots
are committed, and CI fails on an uncommitted snapshot diff.

| Layer                     | Scope                                                                                                                                                                                                                                                       | Invariants                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Unit (Core)               | Every entry point: happy path and every error code in [section 2.5](02-core-contract.md#25-errors-coreerror-129), in the documented check order. Split math table tests (1 to 5 recipients, amounts 40 to 10¹²).                                            | I-1, I-2, I-3, I-4, I-7, I-8, I-24 |
| Unit (Tab)                | Every entry point and error. Every skip reason. Short balance. Spend limit. Withdrawal timing at `unlock − 1` and `unlock`. Deposit cancels a withdrawal. Duplicate pairs in one batch.                                                                     | I-10 to I-18                       |
| Unit (NFT)                | Mint below, at and above the threshold. Second mint. Non-author mint. Transfer with owner and approval. Royalty info. Pause blocks mint and transfer.                                                                                                       | I-19                               |
| Auth                      | `mock_auths` with explicit `MockAuth` trees per invocation, never `mock_all_auths`, for every `require_auth` path. Includes `change_author` with each signer missing, and the SAC sub-invocation in the tip auth tree.                                      | I-7, I-26, I-16, I-17              |
| Events                    | Assert the exact topics and data of every event in sections 2.4, 3.9 and 4.4. Assert one `Tipped` per batch item.                                                                                                                                           | I-24                               |
| TTL                       | Advance the ledger past the testnet minimum persistent TTL (120,960) and the temporary TTLs. Assert extensions and the expiry of `Session` and `Paid` after `valid_until + SETTLE_GRACE`.                                                                   | I-25, I-15                         |
| Property (`proptest`)     | Random amounts and splits: I-1 and I-2 exact. Random voucher sequences: I-11 and I-12. Random deposit, settle, claim and withdraw interleavings: I-10 after every step.                                                                                     | I-1, I-2, I-10, I-11, I-12         |
| Fuzz (`cargo-fuzz`)       | Targets: `tip_batch` inputs, `settle` voucher vectors (random fields and signatures), split vectors. Scheduled CI job with a 10-minute budget per target.                                                                                                   | I-4, I-11, I-14                    |
| Upgrade                   | Deploy v1 Wasm, write state, upgrade to a test v2 Wasm, `migrate`, assert the state is unchanged and a second `migrate` fails.                                                                                                                              | I-23                               |
| Resource                  | Run with the SDK's default mainnet limits: Core `tip` with 5 recipients; `tip_batch` at 10 items / 24 transfers; Tab `settle` at 32 distinct-party vouchers (≤ 14,000 event bytes, ≤ 200 write entries); NFT `mint`. Record the numbers in the test output. | caps in sections 2 and 3           |
| Encoding vectors          | `contracts/shared/test-vectors.json`: identifiers, `VoucherPayload` bytes, receipt leaves, Merkle roots, signatures. Checked by Rust, Convex (vitest) and client (vitest).                                                                                  | I-22, I-14                         |
| Local network integration | `stellar container start local` (Quickstart) in CI: deploy all three contracts, run TypeScript tests through the generated bindings for every flow in [section 5](05-flows-and-admin.md).                                                                   | end-to-end                         |
| Convex                    | Vitest with `convex-test`: prepare and submit validation, the state machine, the verifier with recorded RPC fixtures (match, mismatch, `NOT_FOUND`, expired), indexer paging and idempotency, tab acceptance rules, settler selection order.                | I-20, I-21                         |
| Playwright                | Fixture suites with mocked chain responses: tip, highlight tip, basket, open tab, tab tip, close tab, collect, mint. One opt-in live testnet suite against the integration deployment, behind the network guard.                                            | UI states                          |

**CI additions:**

1. A `contracts` job: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --locked`, `stellar contract build --optimize`, the Wasm size gate, and the bindings freshness check.
2. A scheduled fuzz job.
3. A local-network integration job.

## 8.2 Reproducible build

1. Build in the `docker.io/stellar/stellar-cli` image pinned by digest at a 30.0.x tag. Use `--meta source_repo=github:pragya-shar/QuillTip --meta commit_sha=<sha>`.
2. Record each Wasm's SHA-256 in the deployment evidence. A second build of the same commit MUST produce the same hashes.
3. Generate GitHub artifact attestations for the Wasm files in the release workflow.

## 8.3 Contract metadata

Each contract sets `contractmeta!` entries:

- `name`
- `version` (crate version)
- `source_repo`
- `schema_version`

## 8.4 Testnet deployment procedure

A script in `scripts/contracts/deploy-v2-testnet.ts` runs these steps. It is
guarded by `assertScriptTestnetOnly('deploy-v2-testnet')` and is idempotent
per step.

1. Check out the recorded release commit (tag `contracts-v2.0.0-testnet.N`), with a clean tree.
2. Build reproducibly ([section 8.2](#82-reproducible-build)) and compare the hashes with the release attestation.
3. `stellar contract upload` each Wasm, and record the Wasm hashes.
4. Deploy Core with constructor arguments: admin, pauser, upgrader, treasury, native XLM SAC, `min_tip = 1_000_000` (0.1 XLM).
5. Deploy Tab: admin, pauser, upgrader, settler public key, native XLM SAC, treasury, `max_balance = 10_000_000_000`, `min_deposit = 10_000_000`.
6. Deploy the NFT: admin, pauser, upgrader, Core ID, native XLM SAC, `threshold = 500_000_000`, `base_uri`.
7. Read back every view (`fee_bps`, `min_tip`, `config`, `threshold`, roles), and compare them with the expected values.
8. Run the smoke flows with test accounts funded by Friendbot:
   1. register
   2. tip
   3. highlight tip
   4. batch tip
   5. open tab
   6. tab tip
   7. settle
   8. claim
   9. withdraw start
   10. mint
   11. transfer
9. Write `docs/contracts/v2-testnet-deployment.md`. It is committed and contains no secrets, and records:
   - the commit, the tool versions and the image digest
   - the Wasm hashes
   - the contract IDs, and the deploy and constructor transaction hashes with ledgers
   - the role holders' public keys
   - the configuration values
   - the smoke transaction hashes
   - `INDEXER_START_LEDGER`
10. Set the env values ([section 6.8](06-app-integration.md#68-environment-variables)) on the non-production deployment only.

## 8.5 Mainnet release differences

The design is unchanged. Before any mainnet step:

1. **SDK and library gate:** an OpenZeppelin release on a supported `soroban-sdk` major, with all tests re-run ([section 1.3](01-architecture.md#13-dependency-pins)).
2. **Independent security review** of the three contracts and the tab protocol, with the findings resolved.
3. **Keys:**
   - Admin and treasury become a 2-of-3 multisig.
   - The upgrader becomes an OpenZeppelin timelock.
   - The settler moves to a hosted relayer or a KMS-backed key.
   - The deployer key is separate and unused after deploy.
4. **Configuration:**
   - USDC (or another stable asset) is added with `set_token`, plus a second Tab instance for it.
   - Limits and thresholds are reviewed.
   - Note that the mainnet minimum persistent TTL is 120 days, against 7 days on testnet.
5. **Network guard:** the mainnet refusal is lifted only by a separate, reviewed change.
6. **Infrastructure:** a paid mainnet RPC provider, plus an archive source for backfill.
7. **Product:** the UI labels move from testnet to production wording, the terms are updated, and a pause drill runs.

## 8.6 Removal after cutover

After v2 is live on testnet and verified:

**Contracts:**

- `contracts/tipping/` (the crate is removed).
- The v1 `contracts/article-nft` code, replaced in place.

**Convex:** the functions listed in [section 6.3](06-app-integration.md#63-convex-functions).

**Tables:**

- `articleTipIntents` and `highlightTipIntents`, once no v1 record is pending.
- `withdrawals` (unused).

**Client:**

- `lib/stellar/client.ts` (v1 builders, including the batch builders).
- `lib/stellar/memo-utils.ts`.
- The v1 parts of `lib/stellar/nft-client.ts`.
- `lib/stellar/wallet-adapter.ts`, replaced by `lib/stellar/v2/wallet.ts`.

**Env:**

- `NEXT_PUBLIC_TIPPING_CONTRACT_ID`, `NEXT_PUBLIC_PLATFORM_ADDRESS`, `NEXT_PUBLIC_HORIZON_URL`, `NEXT_PUBLIC_SOROBAN_RPC_URL` (renamed), `TIPPING_CONTRACT_ID`, `HORIZON_URL`, `RECONCILE_TIPS_ENABLED`.

**Docs:**

- `docs/tipping-contract-testnet-deploy.md` and `docs/highlight-tipping.md` are replaced by v2 documents.

**Kept:** v1 data rows, labelled `contractVersion: 'v1'`.

## 8.7 Feature map

| Stated payment feature                                    | v2 design element                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tip an article                                            | `Core.tip` ([2.2](02-core-contract.md#tipping)), flow [5.2](05-flows-and-admin.md#52-direct-article-tip)                                                           |
| Tip a highlighted passage, with a unique ID per selection | `highlight_id` in `Core.tip` and the `Tipped` event ([1.4](01-architecture.md#14-identifiers), [5.3](05-flows-and-admin.md#53-highlight-tip))                      |
| Bind each tip to the highlight and the content            | `highlight_id` and `content_hash` in contract events; tab tips through receipts and `receipts_root`. Soroban transactions carry no memo, so events take that role. |
| Writers receive 97.5%, platform 2.5%                      | Constant `FEE_BPS = 250` in Core and Tab (I-1, I-13)                                                                                                               |
| Payment channels for efficient micropayments              | Tab contract: prepaid balance, off-chain signed vouchers, batched settlement ([section 3](03-tab-contract.md))                                                     |
| Batched micropayments                                     | `Core.tip_batch` (up to 10 tips per signature); `Tab.settle` (up to 32 vouchers per transaction, each covering any number of tips)                                 |
| Fewer on-chain transactions                               | Tab tips need no transaction per tip. The ratio is measured on testnet and reported in the deployment evidence; it is not assumed.                                 |
| Content anchoring (hash, Arweave)                         | `content_hash` and `arweave_id` in `Core.register_article` with author auth                                                                                        |
| Article NFT at a tip threshold                            | `Nft.mint` reads the Core total ([section 4](04-nft-contract.md))                                                                                                  |
| NFT royalty                                               | OpenZeppelin `royalties`, 1,000 bps                                                                                                                                |
| Revenue splits between collaborators                      | Core co-author splits, up to 5 recipients                                                                                                                          |
| Transaction monitoring and indexing                       | RPC verification and the Convex event indexer ([6.4](06-app-integration.md#64-server-side-verification-details), [6.5](06-app-integration.md#65-event-indexer))    |
| Wallet integration                                        | Stellar Wallets Kit 2.x ([6.6](06-app-integration.md#66-client-modules))                                                                                           |
| Mainnet readiness                                         | Configuration-only changes listed in [8.5](#85-mainnet-release-differences)                                                                                        |
