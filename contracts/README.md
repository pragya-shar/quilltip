# QuillTip contracts

Soroban contracts for QuillTip payments v2. The specification is
[docs/architecture/v2-spec.md](../docs/architecture/v2-spec.md); the crate
layout and pins are in section 1 and the test and build rules in section 8.

All payment development targets Stellar **testnet**.

## Layout

| Path           | Crate                  | Kind          | Status                                    |
| -------------- | ---------------------- | ------------- | ----------------------------------------- |
| `shared/`      | `quilltip-shared`      | rlib          | Constants, identifiers, TTL, fee math     |
| `core/`        | `quilltip-core`        | cdylib + rlib | Skeleton                                  |
| `tab/`         | `quilltip-tab`         | cdylib + rlib | Skeleton                                  |
| `article-nft/` | `quilltip-article-nft` | cdylib + rlib | Skeleton (replaces the v1 crate in place) |
| `tipping/`     | `quilltip-tipping`     | cdylib        | v1, outside the workspace until cutover   |

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
| `ids`       | Identifier types, `is_zero`, `article_id` and `highlight_id` derivations                                            |
| `ttl`       | `extend_instance`, `extend_persistent`, `extend_temporary`, `ledgers_until`                                         |
| `fee`       | Checked `fee`, `fee_and_net`, `tab_fee` (cumulative rule) and `share`, with property tests                          |
| `payload`   | `TipReceipt`, `VoucherPayload`, `AcceptancePayload` and their signed bytes                                          |
| `merkle`    | `receipt_leaf`, `merkle_root`, `merkle_proof`, `verify_receipt` (OpenZeppelin `Verifier<Sha256>`)                   |

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

Skeleton sizes from the reproducible build (Stellar CLI 30.0.1, `--optimize`,
including the `source_repo` and `commit_sha` metadata). Two builds of one
commit produced identical hashes.

| Wasm                        | Bytes |
| --------------------------- | ----: |
| `quilltip_core.wasm`        |   576 |
| `quilltip_tab.wasm`         |   572 |
| `quilltip_article_nft.wasm` |   580 |
