# QuillTip contracts

Soroban contracts for QuillTip payments v2. The specification is
[docs/architecture/v2-spec.md](../docs/architecture/v2-spec.md); the crate
layout and pins are in section 1 and the test and build rules in section 8.

All payment development targets Stellar **testnet**.

## Layout

| Path           | Crate                  | Kind          | Status                                  |
| -------------- | ---------------------- | ------------- | --------------------------------------- |
| `shared/`      | `quilltip-shared`      | rlib          | Constants, identifiers, TTL, fee math   |
| `core/`        | `quilltip-core`        | cdylib + rlib | Skeleton                                |
| `tab/`         | `quilltip-tab`         | cdylib + rlib | Implemented (see below)                 |
| `article-nft/` | `quilltip-article-nft` | cdylib + rlib | Article NFT (replaces the v1 crate)     |
| `tipping/`     | `quilltip-tipping`     | cdylib        | v1, outside the workspace until cutover |

`Cargo.toml` defines the workspace, the exact dependency pins and the shared
release profile. `rust-toolchain.toml` pins Rust 1.94.1 and `wasm32v1-none`.
`Cargo.lock` is committed and every command uses `--locked`.

The v1 article NFT source stays in git history; its last version on
`overhaul/v2` is at commit `c8746e8`.

## Shared crate

`quilltip-shared` is used by all three contracts and mirrors the off-chain
encoders in Convex and the client.

| Module      | Contents                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `constants` | `DAY`, `TTL_THRESHOLD`, `TTL_EXTEND_TO`, `FEE_BPS`, `BPS_DENOMINATOR`, Tab signing domains, `MAX_RECEIPTS_PER_PAIR` |
| `errors`    | Error-code ranges: Core 1–29, Tab 30–69, NFT 70–89, reserved 90–99                                                  |
| `ids`       | Identifier types, `is_zero`, `article_ref`, `article_id`, `highlight_id`                                            |
| `ttl`       | `extend_instance`, `extend_persistent`, `extend_temporary`, `ledgers_until`                                         |
| `fee`       | Checked `fee`, `fee_and_net`, `tab_fee` (cumulative rule) and `share`, with property tests                          |
| `payload`   | `TipReceipt`, `VoucherPayload`, `AcceptancePayload` and their signed bytes                                          |
| `merkle`    | `receipt_leaf`, `merkle_root`, `merkle_proof`, `verify_receipt` (OpenZeppelin `Verifier<Sha256>`)                   |
| `roles`     | Self-administered `upgrader` role: only an upgrader grants, revokes or re-admins it                                 |

### Test vectors

`shared/test-vectors.json` fixes identifiers, voucher payload bytes for G/G,
G/C and C/C reader and writer pairs, acceptance payloads, signatures, receipt
leaves, Merkle roots and proofs. Every key in it is a deterministic test key.
`shared/tests/test_vectors.rs` recomputes every value and verifies every
signature and proof. Canonical article bytes are added by the canonical
article bytes issue.

Regenerate only for an intended encoding change:

```bash
cd contracts && QUILLTIP_WRITE_TEST_VECTORS=1 cargo test -p quilltip-shared --test test_vectors
```

```bash
npx prettier --write contracts/shared/test-vectors.json
```

## Tab contract

`tab/` implements `docs/architecture/v2/03-tab-contract.md`. Tests live in
`tab/src/test/` and name the invariants they cover (`I-n`, section 7.1).

| Path                              | Contents                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `tab/test-vectors.json`           | Settlement sequence: payload and acceptance bytes, signatures and expected contract results  |
| `tab/testdata/upgrade_probe.wasm` | Upgrade test fixture: this crate built with `--features upgrade-probe` (`src/probe.rs`)      |
| `tab/fuzz/`                       | cargo-fuzz targets `settle_vouchers` and `voucher_decode` (own workspace, nightly toolchain) |

The resource figures at the maximum batch print with:

```bash
cargo test -p quilltip-tab resource -- --nocapture
```

The Wasm-mode resource test reads `quilltip_tab.wasm` from `QUILLTIP_WASM_DIR`
(CI sets it to the reproducible build output) or from the file named by
`QUILLTIP_TAB_WASM`:

```bash
QUILLTIP_WASM_DIR=<dir with quilltip_tab.wasm> cargo test -p quilltip-tab resource -- --ignored --nocapture
```

Regenerate the Tab vectors only for an intended encoding change:

```bash
QUILLTIP_WRITE_TAB_VECTORS=1 cargo test -p quilltip-tab tab_settlement_vectors
```

```bash
npx prettier --write contracts/tab/test-vectors.json
```

Rebuild the upgrade fixture only when the storage layout changes:

```bash
stellar contract build --locked --package quilltip-tab --features upgrade-probe --out-dir target/probe && cp target/probe/quilltip_tab.wasm tab/testdata/upgrade_probe.wasm
```

Run a fuzz target (from `tab/fuzz/`):

```bash
cargo +nightly fuzz run settle_vouchers -- -max_total_time=600
```

On macOS, the OpenZeppelin dependencies fail to link with the coverage symbols.
Run with `--sanitizer none` and
`RUSTFLAGS="-C link-arg=-Wl,-undefined,dynamic_lookup"`.

## Commands

Run from `contracts/`:

```bash
cargo fmt --all --check
```

```bash
cargo clippy --workspace --all-targets --locked -- -D warnings
```

```bash
cargo test --workspace --locked
```

```bash
stellar contract build --locked --optimize
```

Commit any test snapshot that `cargo test` writes under `*/test_snapshots/`.
CI fails when a test changes or adds a file under `contracts/`.

## Reproducible build

```bash
scripts/contracts/build-reproducible.sh
```

The script builds one committed tree in a digest-pinned `rust:1.94.1` container
for `linux/amd64`, with the checksum-verified Stellar CLI 30.0.1 release binary.
It passes `--meta source_repo` and `--meta commit_sha`, writes `SHA256SUMS` and
`sizes.tsv`, and fails when a Wasm exceeds 120,000 bytes. CI runs it twice and
compares the hashes.

Sizes from the reproducible build (Stellar CLI 30.0.1, `--optimize`,
including the `source_repo` and `commit_sha` metadata). Core and Tab are still
skeletons. CI builds each commit twice and compares the hashes.

| Wasm                        | Bytes |
| --------------------------- | ----: |
| `quilltip_core.wasm`        |   576 |
| `quilltip_tab.wasm`         |   572 |
| `quilltip_article_nft.wasm` | 33853 |

## TypeScript bindings

`lib/stellar/v2/bindings/{core,tab,nft}` holds client bindings generated from
the built Wasm with the SDK's `stellar-js generate`. Do not edit them by hand.
After a contract interface change, build the Wasm and regenerate:

```bash
bun scripts/contracts/bindings.ts --wasm-dir contracts/target/wasm32v1-none/release
```

CI regenerates the bindings from the reproducible build with `--check` and
fails when the committed files differ.

`lib/stellar/v2/tab/encoding.ts` builds voucher payloads, acceptance payloads,
tip receipts and Merkle proofs in TypeScript. `scripts/chain/tab-encoding.test.ts`
checks it against the Rust test vectors.

`lib/stellar/v2/ids.ts` derives `article_ref` and the author-bound
`article_id` as bytes for calls through the bindings.
`scripts/chain/v2-ids.test.ts` checks it against the same vectors and against
`convex/lib/chain/ids.ts`.

## Local network integration

The suite in `scripts/integration` deploys Core, Tab and the article NFT to a
local Stellar Quickstart network and runs every flow through the generated
bindings: registration, direct, highlight, split and batch tips, tab deposits,
session keys, vouchers, `settle`, `settle_own`, claims, the withdrawal lock,
NFT mint and transfer, pause, and an upgrade with `migrate`. It asserts events
and balances to the stroop and records fees and resource use. It needs Docker
and the Stellar CLI 30.x.

```bash
bun run test:local-network
```

The runner refuses to start unless the network guard resolves to `LOCAL`
(standalone passphrase, RPC on localhost). It starts a digest-pinned Quickstart
container named `quilltip-local-network` when no local RPC answers. Add
`--stop` to remove the container afterwards. It writes `measurements.json`,
`events.json` and `event-fixtures.json` to `contracts/target/integration`, or
to the directory given with `--out <dir>`.
`scripts/integration/summary.ts <dir>` prints the fee table.
`scripts/chain/fixtures/v2-local-events.json` is a copy of
`event-fixtures.json` for the Convex tests.

A local network cannot reach the 120-day TTL or the three-day withdrawal
delay, so archived-entry restores and completed withdrawals stay covered by
the contract unit tests.

## Testnet deployment

`scripts/contracts/deploy-v2-testnet.ts` deploys one contract set (`--set
integration|live`) and writes `docs/contracts/v2-testnet-deployment.md`
([section 8.4](../docs/architecture/v2/08-testing-and-deployment.md#84-testnet-deployment-procedure)).

- **Guard:** `assertScriptStellarTestnetOnly` runs before any work. Mainnet is
  refused in every form, and every submission first asks the RPC server for
  its passphrase.
- **Steps:** `build` (twice, hashes must match), `keys`, `upload`, `deploy`
  (Core, then Tab and the NFT with the Core address), `verify` (reads back
  every setting and compares the on-chain Wasm with the build), `smoke` (the
  twelve flows) and `evidence`.
- **Resuming:** each step records its result in a state file and is skipped
  on a rerun. Contract addresses come from a fixed salt per set, contract and
  commit, so a rerun finds a contract even if the state file was lost.
- **Keys:** keys are Stellar CLI identities in `--keys-dir/<set>`, which must
  be outside the repository (mode 700 and 600). No secret is printed.

Rehearse on a local network first (Quickstart, `LOCAL` guard mode):

```bash
stellar container start local
```

```bash
QUILLTIP_NETWORK_GUARD_OPT_IN=local NEXT_PUBLIC_STELLAR_NETWORK=LOCAL NEXT_PUBLIC_SOROBAN_RPC_URL=http://localhost:8000/rpc NEXT_PUBLIC_HORIZON_URL=http://localhost:8000 NEXT_PUBLIC_NETWORK_PASSPHRASE='Standalone Network ; February 2017' bun run contracts:deploy-v2 --set integration --commit <sha> --keys-dir <dir outside the repo>
```

On testnet, use `QUILLTIP_NETWORK_GUARD_OPT_IN=testnet`,
`NEXT_PUBLIC_STELLAR_NETWORK=TESTNET`, the testnet RPC URL and passphrase, and
a commit on `origin/overhaul/v2`.
