# 2. Core contract (`quilltip-core`)

[Index](../v2-spec.md)

Core binds articles to authors and content, and moves direct tips. It stores
no tip history.

## 2.1 Types

```rust
pub const FEE_BPS: u32 = 250;
pub const BPS_DENOMINATOR: u32 = 10_000;
pub const MAX_RECIPIENTS: u32 = 5;
pub const MAX_TOKENS: u32 = 4;
pub const MAX_BATCH_ITEMS: u32 = 10;
pub const MAX_BATCH_TRANSFERS: u32 = 24; // Σ over items of (recipients + 1 treasury transfer)
pub const TIP_REF_TTL: u32 = DAY;

#[contracttype] #[derive(Clone)]
pub struct Split { pub recipient: Address, pub bps: u32 }

#[contracttype] #[derive(Clone)]
pub struct ArticleRecord {
    pub author: Address,                 // primary recipient; receives rounding remainder
    pub content_hash: BytesN<32>,
    pub arweave_id: Option<BytesN<32>>,
    pub content_version: u32,            // 1 at registration, +1 per update_content
    pub splits: Vec<Split>,              // empty = 100% of net to author
    pub registered_ledger: u32,
}

#[contracttype] #[derive(Clone)]
pub struct TokenConfig { pub min_tip: i128, pub enabled: bool }

#[contracttype] #[derive(Clone)]
pub struct TipInput {
    pub article_id: BytesN<32>,
    pub amount: i128,
    pub highlight_id: Option<BytesN<32>>,
    pub client_ref: BytesN<16>,
}
```

**Split rules.** These are enforced at `register_article`, `set_splits` and `accept_author`.

1. `splits` is empty, or has 2 to `MAX_RECIPIENTS` entries.
2. When non-empty:
   - `splits[0].recipient == author`.
   - Every `bps > 0`, and `Σ bps == 10_000`.
   - Recipients are distinct.
   - No recipient equals the treasury.
3. A violation fails with `InvalidSplits`, or with `TooManyRecipients` when there are more than `MAX_RECIPIENTS` entries.

## 2.2 Entry points

Auth names the address that MUST call `require_auth`. "Paused" means the
OpenZeppelin `when_not_paused` guard. All writes extend TTLs per
[section 1.5](01-architecture.md#15-shared-conventions).

### Constructor

```rust
fn __constructor(e: Env, admin: Address, pauser: Address, upgrader: Address,
                 treasury: Address, token: Address, min_tip: i128)
```

- **Sets:**
  - OpenZeppelin admin = `admin`.
  - Grants `pauser` and `upgrader`.
  - `Treasury`.
  - `Token(token) = { min_tip, enabled: true }`.
  - Schema version 1.
- **Preconditions:** `min_tip >= 40`, so that the fee is non-zero. Otherwise `InvalidMinimum`.
- **Events:** `TokenSet`, `TreasurySet`.

### Article registration

```rust
fn register_article(e: Env, author: Address, article_id: BytesN<32>, content_hash: BytesN<32>,
                    arweave_id: Option<BytesN<32>>, splits: Vec<Split>)
```

- **Auth:** `author`. **Paused:** blocked.
- **Preconditions:**
  - No `Article(article_id)`, else `AlreadyRegistered`.
  - Hashes are non-zero, else `InvalidHash`.
  - The split rules hold.
- **State:** `Article(article_id) = ArticleRecord { content_version: 1, registered_ledger: now, .. }`.
- **Event:** `ArticleRegistered`.

```rust
fn update_content(e: Env, article_id: BytesN<32>, content_hash: BytesN<32>, arweave_id: Option<BytesN<32>>)
```

- **Auth:** the stored `author`. **Paused:** blocked.
- **Preconditions:** the article exists (`NotRegistered`), and the hash is non-zero.
- **State:** replaces the hash and ID, and increments `content_version`.
- **Event:** `ContentUpdated`.

```rust
fn set_splits(e: Env, article_id: BytesN<32>, splits: Vec<Split>)
```

- **Auth:** the stored `author`. **Paused:** blocked.
- **Preconditions:** the split rules hold.
- **Event:** `SplitsSet`.

```rust
fn propose_author(e: Env, article_id: BytesN<32>, new_author: Address, live_until_ledger: u32)
fn accept_author(e: Env, article_id: BytesN<32>)
fn cancel_author_proposal(e: Env, article_id: BytesN<32>)
```

Changing the author takes two steps. Each step is a single-signer
transaction, so neither wallet has to sign an authorisation entry for the
other.

1. **`propose_author`.**
   - **Auth:** the stored `author`. **Paused:** blocked.
   - **Preconditions:** `new_author` differs from the current author and the treasury, and is not already a split recipient (`SameAuthor`). `now < live_until_ledger <= now + 30 * DAY` (`InvalidExpiry`).
   - **State:** stores the temporary entry `PendingAuthor(article_id) = { new_author, live_until_ledger }`, with a TTL that reaches `live_until_ledger`.
   - **Event:** `AuthorProposed`.
2. **`accept_author`.**
   - **Auth:** the pending `new_author`. **Paused:** blocked.
   - **Preconditions:** a pending proposal exists and `now <= live_until_ledger` (`NoPendingAuthor`).
   - **State:** `author = new_author`. If splits exist, `splits[0].recipient = new_author`. Removes the pending entry.
   - **Event:** `AuthorChanged`.
3. **`cancel_author_proposal`.** The stored `author` may call it at any time. It removes the pending entry.

A writer who changes wallet moves each article this way. Totals stay with the
article. A later NFT mint goes to the author at mint time
([section 4](04-nft-contract.md)).

### Tipping

```rust
fn tip(e: Env, tipper: Address, article_id: BytesN<32>, token: Address, amount: i128,
       highlight_id: Option<BytesN<32>>, client_ref: BytesN<16>)
```

- **Auth:** `tipper`. The auth tree covers the SAC `transfer` sub-invocations. **Paused:** blocked.
- **Checks, in order.** The first failure decides the error.
  1. `amount > 0` (`InvalidAmount`).
  2. `Token(token)` exists and is enabled (`TokenNotAllowed`).
  3. `amount >= min_tip` (`BelowMinimum`).
  4. The article exists (`NotRegistered`).
  5. `tipper` is not the author or any split recipient (`SelfTip`).
  6. `TipRef(tipper, client_ref)` is absent (`DuplicateClientRef`).
- **Effects:**
  1. Compute `fee`, `net` and the shares ([section 1.5](01-architecture.md#15-shared-conventions)).
  2. SAC `transfer(tipper, recipient_i, share_i)` for each recipient with `share_i > 0` (the author only, when there are no splits). A zero share is skipped and gets no transfer.
  3. SAC `transfer(tipper, treasury, fee)`. `fee >= 1` always, because `min_tip >= 40`.
  4. `Total(article_id, token) += amount`, checked.
  5. Set the temporary entry `TipRef(tipper, client_ref) = true` with TTL `TIP_REF_TTL`.
  6. Emit `Tipped`.
- **Resources:** at most 6 token transfers. Event bytes are at most about 2.2 KB (estimate; a resource test verifies it).

```rust
fn tip_batch(e: Env, tipper: Address, token: Address, items: Vec<TipInput>)
```

- **Auth:** `tipper`, once. **Paused:** blocked.
- **Preconditions:**
  - `1 <= items.len() <= MAX_BATCH_ITEMS` (`BatchEmpty` or `BatchTooLarge`).
  - `Σ (recipients_i + 1) <= MAX_BATCH_TRANSFERS` (`BatchTooLarge`).
  - `client_ref` values are distinct within the batch (`DuplicateClientRef`).
  - Every item passes the `tip` checks.
- **Effects:** the same as `tip`, once per item, in input order. The batch is atomic: any failure reverts all items.
- **Events:** one `Tipped` per item.
- **Caps.** Two feasibility builds measured these figures under mainnet per-transaction limits. Instruction counts are native-mode; Wasm-mode counts run about 35% higher.

  | Batch                                  | Instructions |         Write entries |   Event bytes | Result     |
  | -------------------------------------- | -----------: | --------------------: | ------------: | ---------- |
  | 10 items, 20 transfers, no highlight   |    4.4–5.3 M | 23 (33 with `TipRef`) | 10,320–10,480 | fits       |
  | 10 items, 20 transfers, with highlight |        5.3 M |                    33 |        11,080 | fits       |
  | 10 items, 24 transfers, with highlight |        6.4 M |                    37 |        12,024 | fits (cap) |
  | 15 items, 30 transfers, with highlight |        8.8 M |                    48 |        16,620 | rejected   |

  The caps `MAX_BATCH_ITEMS = 10` and `MAX_BATCH_TRANSFERS = 24` leave about 26% event headroom with highlights.

### Views (no auth, not paused)

| Function                                           | Returns                                                       |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `get_article(article_id) -> Option<ArticleRecord>` | Record or `None`                                              |
| `article_author(article_id) -> Address`            | Author. Panics with `NotRegistered`.                          |
| `article_total(article_id, token) -> i128`         | Gross cumulative total; `0` if none                           |
| `token_config(token) -> Option<TokenConfig>`       | Config or `None`                                              |
| `min_tip(token) -> i128`                           | Minimum. Panics with `TokenNotAllowed` if absent or disabled. |
| `fee_bps() -> u32`                                 | `250`                                                         |
| `treasury() -> Address`                            | Treasury                                                      |
| `schema_version() -> u32`                          | OpenZeppelin schema version                                   |

### Administration

| Function                                                              | Auth                 | Effect and event                                                                                                                    |
| --------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `set_token(e, token, min_tip, enabled)`                               | admin (`only_admin`) | Upsert `Token(token)`. `min_tip >= 40`. At most `MAX_TOKENS` entries (`TooManyTokens`). Emits `TokenSet`.                           |
| `remove_token(e, token)`                                              | admin                | Deletes a **disabled** entry (`TokenEnabled` otherwise), freeing a slot. Totals already recorded for it stay. Emits `TokenRemoved`. |
| `set_treasury(e, treasury)`                                           | admin                | Replaces the treasury. Later tips pay the new address. Existing splits are not re-checked against it. Emits `TreasurySet`.          |
| `pause(e, caller)`                                                    | `pauser` role        | OpenZeppelin pause and event                                                                                                        |
| `unpause(e, caller)`                                                  | admin                | OpenZeppelin unpause and event                                                                                                      |
| `upgrade(e, new_wasm_hash, operator)`                                 | `upgrader` role      | `update_current_contract_wasm`                                                                                                      |
| `migrate(e, operator)`                                                | `upgrader` role      | Version-gated, once per version (`AlreadyMigrated`). Emits `Migrated`.                                                              |
| OpenZeppelin `AccessControl` (grant, revoke, two-step admin transfer) | per OpenZeppelin     | OpenZeppelin events. `renounce_admin` is overridden to fail (`AdminRenounceDisabled`).                                              |

## 2.3 Storage

| Key                                              | Class                                  | Type                          | TTL                                                          | Growth bound                                |
| ------------------------------------------------ | -------------------------------------- | ----------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `Treasury`                                       | instance                               | `Address`                     | instance                                                     | 1                                           |
| `Token(Address)`                                 | instance                               | `TokenConfig`                 | instance                                                     | ≤ `MAX_TOKENS`                              |
| OpenZeppelin admin, roles, pause, schema version | instance / persistent per OpenZeppelin | per OpenZeppelin              | per OpenZeppelin                                             | Fixed small set                             |
| `Article(BytesN<32>)`                            | persistent                             | `ArticleRecord` (< 700 bytes) | `TTL_THRESHOLD` / `TTL_EXTEND_TO`, on write and on every tip | One per registered article                  |
| `Total(BytesN<32>, Address)`                     | persistent                             | `i128`                        | same, on every tip                                           | ≤ articles × `MAX_TOKENS`                   |
| `TipRef(Address, BytesN<16>)`                    | temporary                              | `bool`                        | `TIP_REF_TTL` at creation                                    | Tips in the last day. Expire automatically. |
| `PendingAuthor(BytesN<32>)`                      | temporary                              | `(Address, u32)`              | until `live_until_ledger`                                    | Open proposals only                         |

- A tip also extends the `Article` entry TTL, so every tipped article stays live.
- Untipped articles can archive. They are restored automatically by simulation (Protocol 23 and later).

## 2.4 Events

Topics are listed in order. The first topic is the event name, the default for
`#[contractevent]`. Events carry 1 to 3 topics. Every per-article or per-account event carries the ID it relates to as a topic.

| Event               | Topics                                       | Data (map)                                                                                                                              |
| ------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ArticleRegistered` | `article_registered`, `article_id`, `author` | `content_hash`, `arweave_id`, `splits`                                                                                                  |
| `ContentUpdated`    | `content_updated`, `article_id`              | `content_hash`, `arweave_id`, `content_version`                                                                                         |
| `SplitsSet`         | `splits_set`, `article_id`                   | `splits`                                                                                                                                |
| `AuthorProposed`    | `author_proposed`, `article_id`              | `new_author`, `live_until_ledger`                                                                                                       |
| `AuthorChanged`     | `author_changed`, `article_id`               | `previous`, `new`                                                                                                                       |
| `Tipped`            | `tipped`, `article_id`, `author`             | `tipper`, `token`, `gross`, `fee`, `net`, `highlight_id`, `content_hash`, `content_version`, `client_ref`, `total_after`, `split_count` |
| `TokenSet`          | `token_set`, `token`                         | `min_tip`, `enabled`                                                                                                                    |
| `TokenRemoved`      | `token_removed`, `token`                     | (none)                                                                                                                                  |
| `TreasurySet`       | `treasury_set`                               | `previous` (Option), `new`                                                                                                              |
| `Migrated`          | `migrated`                                   | `from_version`, `to_version`                                                                                                            |

Notes:

- `Tipped.author` is the primary author. Per-recipient amounts follow from `ArticleRecord.splits` and the rounding rule, and also appear in the SAC `transfer` events of the same transaction. A zero share has no transfer event.
- `content_hash` and `content_version` record the article state at tip time. Verifiers use them for display and anchoring, not for matching a payment ([section 6.4](06-app-integration.md#64-server-side-verification-details)).
- Indexer filters: `["tipped", "*", "*"]` for all tips, `["tipped", <article_id>, "*"]` per article, `["tipped", "*", <author>]` per writer.

## 2.5 Errors (`CoreError`, 1–29)

| Code | Name                    | Raised by                                                                     |
| ---- | ----------------------- | ----------------------------------------------------------------------------- |
| 1    | `NotRegistered`         | tips, updates, views that require an article                                  |
| 2    | `AlreadyRegistered`     | `register_article`                                                            |
| 3    | `InvalidHash`           | zero `article_id`, `content_hash` or `arweave_id`                             |
| 4    | `InvalidSplits`         | split rules                                                                   |
| 5    | `TooManyRecipients`     | more than 5 splits                                                            |
| 6    | `TokenNotAllowed`       | unknown or disabled token                                                     |
| 7    | `InvalidAmount`         | `amount <= 0`                                                                 |
| 8    | `BelowMinimum`          | `amount < min_tip`                                                            |
| 9    | `SelfTip`               | tipper is a recipient                                                         |
| 10   | `DuplicateClientRef`    | `TipRef` present, or repeated within a batch                                  |
| 11   | `BatchEmpty`            | `tip_batch` with no items                                                     |
| 12   | `BatchTooLarge`         | item or transfer cap exceeded                                                 |
| 13   | `Overflow`              | checked arithmetic                                                            |
| 14   | `AlreadyMigrated`       | `migrate`                                                                     |
| 15   | `TooManyTokens`         | `set_token` beyond `MAX_TOKENS`                                               |
| 16   | `InvalidMinimum`        | `min_tip < 40`                                                                |
| 17   | `SameAuthor`            | `propose_author` to the current author, the treasury or an existing recipient |
| 18   | `AdminRenounceDisabled` | `renounce_admin`                                                              |
| 19   | `NoPendingAuthor`       | `accept_author` without a live proposal                                       |
| 20   | `InvalidExpiry`         | `propose_author` expiry out of range                                          |
| 21   | `TokenEnabled`          | `remove_token` on an enabled token                                            |
