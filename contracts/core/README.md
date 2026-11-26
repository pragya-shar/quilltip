# quilltip-core

Article registry, co-author splits and direct tips. Specification:
[02-core-contract.md](../../docs/architecture/v2/02-core-contract.md), with the
shared conventions in [01-architecture.md](../../docs/architecture/v2/01-architecture.md)
(sections 1.4 and 1.5) and the invariants in
[07-security-and-recovery.md](../../docs/architecture/v2/07-security-and-recovery.md)
(section 7.1).

## Source layout

| File              | Contents                                                                 |
| ----------------- | ------------------------------------------------------------------------ |
| `src/contract.rs` | Entry points, OpenZeppelin `AccessControl`, `Pausable` and `Upgradeable` |
| `src/storage.rs`  | Types, storage keys, constants and accessors with TTL extension          |
| `src/events.rs`   | One `#[contractevent]` per state change                                  |
| `src/errors.rs`   | `CoreError`, codes 1 to 21                                               |
| `src/split.rs`    | Split rules and the per-tip split                                        |
| `src/test/`       | Tests, each citing the invariants it covers                              |

## Tests

```bash
cd contracts && cargo test -p quilltip-core --locked
```

Tests marked `#[ignore]` run the CLI-built Wasm: the resource tests and the
upgrade test. CI runs them after the reproducible build. To run them locally,
build both Wasm files and point `QUILLTIP_WASM_DIR` at them:

```bash
scripts/contracts/build-reproducible.sh --out /tmp/core-wasm
```

```bash
scripts/contracts/build-reproducible.sh --package quilltip-core --features upgrade-test --out /tmp/core-wasm-v2
```

```bash
cp /tmp/core-wasm-v2/quilltip_core.wasm /tmp/core-wasm/quilltip_core_upgrade_test.wasm
```

```bash
cd contracts && QUILLTIP_WASM_DIR=/tmp/core-wasm cargo test -p quilltip-core --locked -- --ignored --nocapture
```

The `upgrade-test` feature builds a layout-compatible schema version 2 with
one added view. It exists only for the upgrade test. Never deploy it.

## Measured resources

Under the SDK's default mainnet limits (`InvocationResourceLimits::mainnet()`),
with Rust 1.94.1, soroban-sdk 28.0.0 and Stellar CLI 30.0.1. Every recipient
and article is distinct, the worst case for writes.

| Call                                            | Mode   | Instructions | Memory bytes | Write entries | Write bytes | Event bytes |
| ----------------------------------------------- | ------ | -----------: | -----------: | ------------: | ----------: | ----------: |
| `tip`, 5 recipients, highlight                  | Wasm   |    2,062,934 |    1,445,402 |            10 |       1,980 |       2,052 |
| `tip`, 5 recipients, highlight                  | native |    1,279,477 |      201,869 |            10 |       1,980 |       2,052 |
| `tip_batch`, 10 items, 24 transfers, highlights | Wasm   |   11,038,600 |    2,660,465 |            37 |       7,056 |      12,024 |
| `tip_batch`, 10 items, 24 transfers, highlights | native |    7,940,991 |    1,378,233 |            37 |       7,056 |      12,024 |
| `register_article`, 5 recipients, Arweave ID    | Wasm   |      799,860 |    1,261,445 |             2 |         940 |         780 |

Mainnet per-transaction limits: 400,000,000 instructions, 200 write entries,
132,096 write bytes and 16,384 event bytes. The full batch uses 73% of the
event limit.

Wasm size from the reproducible build: 30,272 bytes (size gate 120,000).
