# 4. Article NFT contract (`quilltip-article-nft`)

[Index](../v2-spec.md)

The contract is built on OpenZeppelin `stellar-tokens` 0.8.0, with
`NonFungibleToken` and `ContractType = Compose<(Base, Royalties)>`.

- **One NFT per article.** The article's author mints it once the article's cumulative tips reach a threshold.
- **The contract enforces the threshold** by reading Core. It never trusts a caller-supplied amount.
- **Only direct tips count.** The threshold uses the Core total, so it counts direct and batch tips through Core. Tab tips do not count ([section 3](03-tab-contract.md)).
- **The threshold measures tip volume, not independent support.** An author tipping from a second address counts too. That route costs the 2.5% fee plus network fees.
- **The mint goes to the author at mint time.** After an author change ([section 2.2](02-core-contract.md#article-registration)), the new author mints.

## 4.1 Constants and configuration

| Item              | Value                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ROYALTY_BPS`     | `1_000` (10%). Set per token at mint, with the receiver = the minting author.                                        |
| `threshold_token` | Native XLM SAC on testnet (constructor argument)                                                                     |
| `threshold`       | 500,000,000 stroops (50 XLM) on testnet. Admin-settable.                                                             |
| Metadata          | `name` "QuillTip Article", `symbol` "QTART". `base_uri` = `https://<site>/api/nft/`, so `token_uri(id)` = base + id. |

The app serves `GET /api/nft/{token_id}` as JSON:

```json
{
  "name": "…",
  "description": "…",
  "external_url": "https://…/articles/<slug>",
  "attributes": [
    { "trait_type": "content_hash", "value": "<hex>" },
    { "trait_type": "arweave_id", "value": "<base64url>" }
  ]
}
```

The data comes from the Core registry and Convex.

## 4.2 Entry points

```rust
fn __constructor(e: Env, admin: Address, pauser: Address, upgrader: Address, core: Address,
                 threshold_token: Address, threshold: i128, base_uri: String)
```

- **Sets:**
  - OpenZeppelin metadata.
  - OpenZeppelin admin. No `manager` role is used.
  - The `pauser` and `upgrader` roles.
  - `Core`, `ThresholdToken`, `Threshold`.
  - Schema version 1.
- **Preconditions:** `threshold > 0` (`InvalidThreshold`).

```rust
fn mint(e: Env, article_id: BytesN<32>) -> u32
```

- **Auth:** `author = Core.article_author(article_id)`, then `author.require_auth()`. **Paused:** blocked.
- **Checks, in order:**
  1. The article exists. Core panics with `NotRegistered` (code 1).
  2. `MintedArticle(article_id)` is absent (`AlreadyMinted`).
  3. `Core.article_total(article_id, threshold_token) >= threshold` (`BelowThreshold`).
- **Effects:**
  1. `token_id = ContractType::mint(e, &author)`. This is a sequential ID. Go through `ContractType`; never call `Base::mint` directly.
  2. `ContractType::set_token_royalty(e, token_id, &author, 1_000)`.
  3. Write `MintedArticle(article_id) = token_id` and `TokenArticle(token_id) = article_id`.
  4. Emit `ArticleNftMinted`. OpenZeppelin also emits its `mint` event.

**Transfers:**

- OpenZeppelin `transfer(from, to, token_id)` and `transfer_from` with owner or approved auth, blocked while paused.
- Override the trait methods to add `when_not_paused`, then delegate to OpenZeppelin.
- **Royalty is fixed at mint.**
  - The OpenZeppelin 0.8.0 `NonFungibleRoyalties` trait has no default implementations for `set_default_royalty`, `set_token_royalty` and `remove_token_royalty`. Each takes an `operator` argument and leaves access control to the contract.
  - This contract implements all three to fail with `RoyaltyImmutable` (I-20).
  - The receiver does not change on transfer.
  - Royalty is information for marketplaces. This contract has no sale function.

**Views:**

- OpenZeppelin: `balance`, `owner_of`, `name`, `symbol`, `token_uri`, `royalty_info`, `get_approved`, `is_approved_for_all`.
- `token_of_article(article_id) -> Option<u32>`.
- `article_of_token(token_id) -> BytesN<32>`.
- `threshold() -> (Address, i128)`.

**Administration:**

| Function                          | Auth             | Effect                                           |
| --------------------------------- | ---------------- | ------------------------------------------------ |
| `set_threshold(token, threshold)` | admin            | Affects only future mints. Emits `ThresholdSet`. |
| `pause` / `unpause`               | `pauser` / admin | Same pattern as Core                             |
| `upgrade` / `migrate`             | `upgrader`       | Same pattern as Core                             |
| OpenZeppelin royalty setters      | none             | Always fail (`RoyaltyImmutable`)                 |
| `renounce_admin`                  | none             | Always fails (`AdminRenounceDisabled`)           |

## 4.3 Storage

| Key                                   | Class            | Type                         | TTL                                                           | Growth                       |
| ------------------------------------- | ---------------- | ---------------------------- | ------------------------------------------------------------- | ---------------------------- |
| `Core`, `ThresholdToken`, `Threshold` | instance         | `Address`, `Address`, `i128` | instance                                                      | 3                            |
| `MintedArticle(BytesN<32>)`           | persistent       | `u32`                        | `TTL_THRESHOLD`/`TTL_EXTEND_TO` on write                      | One per minted article       |
| `TokenArticle(u32)`                   | persistent       | `BytesN<32>`                 | same                                                          | One per token                |
| OpenZeppelin NFT entries              | per OpenZeppelin | per OpenZeppelin             | OpenZeppelin extends owners and balances by 30 days on access | One per token, one per owner |

## 4.4 Events and errors

| Event                                                      | Topics                                       | Data                        |
| ---------------------------------------------------------- | -------------------------------------------- | --------------------------- |
| `ArticleNftMinted`                                         | `article_nft_minted`, `article_id`, `author` | `token_id`, `total_at_mint` |
| `ThresholdSet`                                             | `threshold_set`                              | `token`, `threshold`        |
| OpenZeppelin `mint`, `transfer`, `approve`, royalty events | per OpenZeppelin                             | per OpenZeppelin            |

`NftError` (70–89):

| Code | Name                    |
| ---- | ----------------------- |
| 70   | `BelowThreshold`        |
| 71   | `AlreadyMinted`         |
| 72   | `InvalidThreshold`      |
| 73   | `AlreadyMigrated`       |
| 74   | `UnknownToken`          |
| 75   | `RoyaltyImmutable`      |
| 76   | `AdminRenounceDisabled` |

## 4.5 Resource note

- `mint` performs:
  - two cross-contract reads of Core;
  - OpenZeppelin mint writes (owner, balance, counter);
  - a royalty write;
  - two persistent writes.
- This is far below any limit. It was not measured in the feasibility build, so the resource test records it.
- The feasibility build of this shape was 124,959 bytes before `wasm-opt`. The Wasm size gate in [section 1.3](01-architecture.md#13-dependency-pins) applies.
