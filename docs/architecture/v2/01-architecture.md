# 1. Architecture and toolchain

[Index](../v2-spec.md)

## 1.1 Components and boundaries

```text
 reader wallet ──sign──► Core.tip / tip_batch ───────────► writer(s), treasury   (direct)
 reader wallet ──sign──► Tab.deposit / register_key
 reader browser (session key) ──voucher──► Convex ──settle (settler key)──► Tab
 writer wallet ──────────► Tab.claim (or anyone triggers claim for the writer)
 author wallet ──sign──► Core.register_article / NFT.mint ──read──► Core totals
 Convex ◄── RPC getTransaction / getEvents ── Stellar testnet
```

| Component              | Owns                                                                                                                                                                   | Does not own                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `quilltip-core`        | Article registration and author binding, content anchor, co-author splits, token allowlist, minimum tip, direct and batch tips, cumulative totals per (article, token) | Tip history, prices, profile data                |
| `quilltip-tab`         | Reader deposits, session keys, voucher verification, per-key replay state, writer and treasury claimable balances, withdrawal delay                                    | Article data. The Tab does not call Core.        |
| `quilltip-article-nft` | One NFT per article, threshold check against Core, royalty data, transfers                                                                                             | Metadata content. `token_uri` points to the app. |
| Treasury account       | Receives the 2.5% fee (directly from Core, by claim from Tab)                                                                                                          | No contract code                                 |
| Convex                 | Intents, idempotency, verification, event index, tab ledger mirror, receipts, settler action                                                                           | Money. The contracts are the source of truth.    |
| Client                 | Wallet signing, session-key custody, voucher signing, UI states                                                                                                        | Verification decisions                           |

Cross-contract calls:

- NFT reads Core: `article_author`, `article_total`.
- Core and Tab call only the token contracts (SAC `transfer`).
- No contract calls another contract that can call back.

## 1.2 Crate layout

```text
contracts/
  Cargo.toml                 # workspace; shared [profile.release]; exact dependency pins
  rust-toolchain.toml        # channel = "1.94.1", targets = ["wasm32v1-none"]
  shared/                    # crate quilltip-shared (rlib only): constants, ids, ttl helpers
  core/                      # crate quilltip-core (cdylib + rlib)
    src/{lib.rs, contract.rs, storage.rs, events.rs, errors.rs, split.rs, test/…}
  tab/                       # crate quilltip-tab
    src/{lib.rs, contract.rs, storage.rs, events.rs, errors.rs, voucher.rs, test/…}
  article-nft/               # crate quilltip-article-nft (replaces the current crate in place)
    src/{lib.rs, contract.rs, storage.rs, events.rs, errors.rs, test/…}
  fuzz/                      # cargo-fuzz targets (nightly, not in the workspace default members)
```

- The current `contracts/tipping` crate stays unchanged until cutover ([section 8.6](08-testing-and-deployment.md#86-removal-after-cutover)).
- `contracts/article-nft` is rewritten in place on the v2 branch. The v1 NFT Wasm stays reproducible from its git tag.

Release profile, shared by all crates:

```toml
[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
```

## 1.3 Dependency pins

| Item                     | Pin                                                      |
| ------------------------ | -------------------------------------------------------- |
| `soroban-sdk`            | `=28.0.0` (dev: `features = ["testutils"]`)              |
| `stellar-access`         | `=0.8.0` from crates.io                                  |
| `stellar-contract-utils` | `=0.8.0`                                                 |
| `stellar-macros`         | `=0.8.0`                                                 |
| `stellar-tokens`         | `=0.8.0` (NFT only)                                      |
| Rust                     | 1.94.1 (`rust-toolchain.toml`), target `wasm32v1-none`   |
| Stellar CLI              | 30.0.x. Build with `stellar contract build --optimize`.  |
| Dev crates               | `ed25519-dalek = "2"`, `proptest = "1"`, `sha2 = "0.10"` |
| `Cargo.lock`             | Committed. CI uses `--locked`.                           |

**Release gate (mainnet only).** OpenZeppelin 0.8.0 depends on `soroban-sdk`
28.0.0. Before any mainnet step:

1. Move to an OpenZeppelin release built on a supported SDK major.
2. Re-run the full test plan.
3. Complete an independent security review.

Testnet work proceeds on the pins above.

**Wasm size gate.** The ledger limit for contract code is 131,072 bytes. CI MUST:

1. Build with `stellar contract build --optimize`.
2. Record each size.
3. Fail a build whose Wasm exceeds 120,000 bytes.

The feasibility builds were not shaken by the CLI and not passed through
`wasm-opt`. In the NFT build, 73,211 of 124,152 bytes were the
`contractspecv0` section, which the CLI build shakes. The optimised sizes are
first measured by the contracts CI issue.

## 1.4 Identifiers

All identifiers on chain are fixed-size bytes. They are derived as follows.
Every implementation (Rust tests, Convex, client) MUST use these exact rules,
and shared test vectors live in `contracts/shared/test-vectors.json`.

| Name            | Type                 | Derivation                                                                                                                                                                                                                                                                                                                                    |
| --------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `article_id`    | `BytesN<32>`         | `SHA-256(UTF-8("quilltip:article:v1:" + <Convex articles _id>))`                                                                                                                                                                                                                                                                              |
| `highlight_id`  | `Option<BytesN<32>>` | Full SHA-256 of the existing highlight string `"{slug}:{start}:{end}:{text[0..50]}"` (`convex/lib/highlightHash.ts`). The stored 28-hex Convex ID is the first 14 bytes of this digest in hex. The mapping is one way: a v1 row can only be matched by prefix, because recomputing the full digest needs the original slug, offsets and text. |
| `content_hash`  | `BytesN<32>`         | SHA-256 of `canonicalArticleBytes(article)` ([below](#canonical-article-bytes))                                                                                                                                                                                                                                                               |
| `arweave_id`    | `Option<BytesN<32>>` | base64url-decoded Arweave transaction ID (43 characters decode to 32 bytes)                                                                                                                                                                                                                                                                   |
| `client_ref`    | `BytesN<16>`         | 16 random bytes generated by Convex per payment intent (the idempotency key)                                                                                                                                                                                                                                                                  |
| `receipts_root` | `BytesN<32>`         | Merkle root of tab receipts ([section 3.6](03-tab-contract.md#36-receipts-and-merkle-root))                                                                                                                                                                                                                                                   |

The zero value (32 zero bytes) is invalid for `article_id`, `content_hash` and
`arweave_id`. Contracts reject it with `InvalidHash`.

### Canonical article bytes

`canonicalArticleBytes(article)` is the UTF-8 encoding of the JSON
Canonicalization Scheme (RFC 8785) serialisation of this object:

```json
{
  "schema": "quilltip-article-v1",
  "articleId": "<Convex articles _id>",
  "authorId": "<Convex users _id>",
  "title": "<title>",
  "content": "<stored TipTap JSON document, unchanged>",
  "contentVersion": 1
}
```

The rules:

- The object has no timestamp and no display fields such as username, avatar or excerpt.
- `contentVersion` is the article's content version: 1 at first publish, plus 1 for each content update.
- With Arweave upload enabled, the upload body is exactly these bytes. Upload time and other metadata go into Arweave tags, not the body.
- With Arweave upload disabled, Convex computes the same bytes for registration.
- The shared test vectors include two articles: one with nested TipTap marks and one with non-ASCII text.

## 1.5 Shared conventions

- **Ledger time:** `DAY = 17_280` ledgers at the 5-second target close time.
- **TTL policy:**
  - Every state-changing entry point extends the instance TTL with `extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO)`.
  - Every persistent write extends that entry with the same constants.
  - Temporary entries get an explicit TTL ([sections 2](02-core-contract.md) and [3](03-tab-contract.md)).

  | Constant        | Value       |
  | --------------- | ----------- |
  | `TTL_THRESHOLD` | `30 * DAY`  |
  | `TTL_EXTEND_TO` | `120 * DAY` |
  | Network maximum | 180 days    |

  The testnet minimum persistent TTL is 7 days, against 120 days on mainnet. Tests MUST advance the ledger past the testnet minimum.

- **Amounts:** `i128` in the token's base units (stroops for XLM). Every amount argument MUST be `> 0`. The one exception is `Tab.open_session`, which takes `amount >= 0`. Arithmetic uses checked operations, and an overflow fails with `Overflow`.
- **Split rounding:**
  1. `fee = gross * 250 / 10_000` (floor).
  2. `net = gross - fee`.
  3. With co-author splits: `share_i = net * bps_i / 10_000` (floor) for each recipient after the first. The first recipient receives `net - Σ others`.

  So `fee + Σ shares == gross` always holds. A share of 0 produces no transfer.
  The Tab computes its fee from the cumulative amount paid
  ([section 3.2](03-tab-contract.md#settlement)).

- **Constructors:** all configuration is set in `__constructor`. No contract has a public `initialize`.
- **Events:** one `#[contractevent]` per state change. Every type name is unique across the three crates. Events use `data_format = "map"` unless noted.
- **Errors:** each contract defines one `#[contracterror] #[repr(u32)]` enum. Codes stay below 100, the range OpenZeppelin leaves to contract-specific errors. Ranges never collide across QuillTip contracts, because a failed call reports only `Error(Contract, #N)`:

  | Contract | Range |
  | -------- | ----- |
  | Core     | 1–29  |
  | Tab      | 30–69 |
  | NFT      | 70–89 |
  | Reserved | 90–99 |

  OpenZeppelin codes used here: `NonFungibleTokenError` 200–299, `PausableError` 1000–1099, `AccessControlError` 2000–2099 and `RoleTransferError` 2200–2299. Two-step admin transfer failures come from `RoleTransferError`. The lowest OpenZeppelin code in 0.8.0 is 100 (OpenZeppelin `Architecture.md` at tag v0.8.0).

- **Roles:** OpenZeppelin `access_control` with `Symbol` roles.

  | Role       | Granted to             | Purpose             |
  | ---------- | ---------------------- | ------------------- |
  | Admin      | OpenZeppelin admin     | Configuration       |
  | `pauser`   | Pauser key             | Pause               |
  | `upgrader` | Upgrader key           | Upgrade and migrate |
  | `settler`  | Settler key (Tab only) | Settlement          |
  - Admin transfer is two-step: `transfer_admin_role`, then `accept_admin_transfer`.
  - Every contract overrides the OpenZeppelin `renounce_admin` to fail with `AdminRenounceDisabled`. A renounce would otherwise make a pause permanent.

- **Pause:**
  - Blocks:
    - Core: tips, batch tips and registration changes.
    - Tab: deposits, `open_session` and key registration.
    - NFT: mints and transfers.
  - Never blocks: views, or the Tab functions `settle`, `settle_own`, `claim`, `revoke_key`, `withdraw_start` and `withdraw` (I-27). Accepted vouchers keep settling, and readers and writers can always leave with what they own.
  - The `pauser` role pauses. The admin unpauses.
- **Upgrade:**
  - `upgrade(new_wasm_hash, operator)` with the `upgrader` role.
  - `migrate(operator)`, also `upgrader` role, runs once per schema version. It reads `upgradeable::get_schema_version` and fails with `AlreadyMigrated` when the stored version is not below the target.
  - Between the two calls the new code runs on old state. Upgrades MUST therefore keep the stored layout readable:
    - new struct fields are `Option`;
    - new data goes under new keys.

    When that is not possible, upgrade and migrate MUST run in one transaction through an upgrader contract, as in the OpenZeppelin `examples/upgradeable/upgrader` pattern.

  - Upgrade authority can replace contract code. On mainnet it is held by a timelock whose minimum delay exceeds `WITHDRAW_DELAY + 2 days`, so readers can exit before a scheduled upgrade takes effect ([section 8.5](08-testing-and-deployment.md#85-mainnet-release-differences)).
