# 3. Tab contract and protocol (`quilltip-tab`)

[Index](../v2-spec.md)

A tab is a prepaid balance a reader holds in the Tab contract.

- **Tipping:** the reader tips any number of writers by signing cumulative vouchers off-chain with a session key held in the browser.
- **Settlement:** a settler submits many vouchers in one transaction. Settlement moves funds from the reader's balance into the writers' and the treasury's claimable balances, with the 250 bps split.
- **Payout:** writers and the treasury claim when they choose.
- **Exit:** readers can always withdraw the unspent balance after a waiting period.

One Tab instance serves one token. Supporting a second asset means deploying
a second instance.

## 3.1 Constants and types

```rust
pub const FEE_BPS: i128 = 250;
pub const MAX_SETTLE_BATCH: u32 = 32;
pub const MAX_KEY_LIFETIME: u32 = 30 * DAY;
pub const SETTLE_GRACE: u32 = 7 * DAY;
pub const WITHDRAW_DELAY: u32 = 3 * DAY;
pub const DOMAIN: &str = "quilltip_tab_v1"; // Symbol

#[contracttype] #[derive(Clone)]
pub struct TabConfig { pub token: Address, pub treasury: Address, pub max_balance: i128, pub min_deposit: i128 }

#[contracttype] #[derive(Clone)]
pub struct ReaderAccount { pub balance: i128, pub next_key_id: u32, pub withdraw_unlock: u32 } // 0 = no withdrawal pending

#[contracttype] #[derive(Clone)]
pub struct SessionKey {
    pub public_key: BytesN<32>,   // ed25519
    pub valid_until: u32,         // last ledger the key may sign for writer self-settlement
    pub spend_limit: i128,        // max gross settled under this key, across all writers
    pub spent: i128,
    pub revoked: bool,
}

#[contracttype] #[derive(Clone)]
pub struct Voucher {
    pub reader: Address, pub writer: Address, pub key_id: u32,
    pub cumulative: i128, pub receipts_root: BytesN<32>, pub signature: BytesN<64>,
}

#[contracttype] #[derive(Clone)]
pub struct VoucherPayload { // signed bytes = XDR of this struct
    pub cumulative: i128, pub domain: Symbol, pub key_id: u32, pub network_id: BytesN<32>,
    pub reader: Address, pub receipts_root: BytesN<32>, pub tab: Address, pub writer: Address,
}

#[contracttype] #[derive(Clone)]
pub struct SettleSummary { pub settled: u32, pub skipped: u32, pub gross: i128, pub fee: i128 }
```

Testnet configuration at deploy:

| Setting       | Value                              |
| ------------- | ---------------------------------- |
| `token`       | Native XLM SAC                     |
| `max_balance` | 10,000,000,000 stroops (1,000 XLM) |
| `min_deposit` | 10,000,000 stroops (1 XLM)         |

## 3.2 Entry points

### Constructor

```rust
fn __constructor(e: Env, admin: Address, pauser: Address, upgrader: Address, settler: Address,
                 token: Address, treasury: Address, max_balance: i128, min_deposit: i128)
```

- **Sets:** the roles, `TabConfig` and schema version 1.
- **Preconditions:** `0 < min_deposit <= max_balance`, else `InvalidLimits`.

### Reader operations

| Function                                                                    | Auth   | Paused  | Preconditions                                                                                                                            | Effects and event                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deposit(reader, amount)`                                                   | reader | blocked | `amount >= min_deposit` (`BelowMinimumDeposit`). `balance + amount <= max_balance` (`BalanceCapExceeded`).                               | 1. SAC `transfer(reader, tab, amount)`. 2. `balance += amount`. 3. If a withdrawal is pending, clear it and emit `WithdrawCancelled`. 4. Emit `Deposited`.                                            |
| `register_key(reader, public_key, valid_until, spend_limit) -> u32`         | reader | blocked | `now < valid_until <= now + MAX_KEY_LIFETIME` (`InvalidKeyExpiry`). `public_key` is not all zeros, and `spend_limit > 0` (`InvalidKey`). | 1. `key_id = next_key_id`, then `next_key_id += 1`. The account is created on first use. 2. Write the temporary `Session` entry with TTL `valid_until + SETTLE_GRACE - now`. 3. Emit `KeyRegistered`. |
| `open_session(reader, amount, public_key, valid_until, spend_limit) -> u32` | reader | blocked | As `register_key`. If `amount > 0`, also the `deposit` checks.                                                                           | `deposit` (when `amount > 0`), then `register_key`, in one invocation, so the reader signs once. Emits the same events.                                                                               |
| `revoke_key(reader, key_id)`                                                | reader | allowed | Key exists (`KeyNotFound`)                                                                                                               | 1. `revoked = true`. 2. `valid_until = min(valid_until, now)`. 3. Emit `KeyRevoked`. The settler may still settle vouchers already accepted, within `SETTLE_GRACE`.                                   |
| `withdraw_start(reader)`                                                    | reader | allowed | `balance > 0` (`NothingToWithdraw`). No withdrawal pending (`WithdrawPending`).                                                          | 1. `withdraw_unlock = now + WITHDRAW_DELAY`. 2. Emit `WithdrawStarted`.                                                                                                                               |
| `withdraw(reader) -> i128`                                                  | reader | allowed | Pending (`NoWithdrawPending`), and `now >= withdraw_unlock` (`WithdrawLocked`).                                                          | 1. `amount = balance`. 2. Set `balance = 0` and `withdraw_unlock = 0`. 3. SAC `transfer(tab, reader, amount)`. 4. Emit `Withdrawn`.                                                                   |

### Settlement

```rust
fn settle(e: Env, settler: Address, vouchers: Vec<Voucher>) -> SettleSummary
```

- **Auth:** the `settler` role (OpenZeppelin `only_role`). **Paused:** blocked.
- **Batch size:** `1 <= len <= MAX_SETTLE_BATCH` (`BatchEmpty` or `BatchTooLarge`).

For each voucher, in order:

1. Load `Session(reader, key_id)`. If it is absent, skip with `KEY_UNKNOWN`.
2. If `now > valid_until + SETTLE_GRACE`, skip with `KEY_EXPIRED`.
3. Load `paid = Paid(reader, key_id, writer)`, defaulting to 0. If `cumulative <= paid`, skip with `STALE`.
4. `ed25519_verify(public_key, xdr(VoucherPayload{..}), signature)`. An invalid signature **aborts the transaction**, because the host traps. The settler MUST verify signatures before submitting.
5. Compute `delta = cumulative - paid`.
6. Compute `gross = min(delta, account.balance, spend_limit - spent)`. If `gross == 0`, skip with `SHORTFALL`.
7. Compute `fee = gross * 250 / 10_000` and `net = gross - fee`.
8. Write the state:
   - `Paid += gross`. The temporary TTL is `valid_until + SETTLE_GRACE - now`.
   - `account.balance -= gross`.
   - `session.spent += gross`.
   - `Claimable(writer) += net`.
   - Add `fee` to the batch fee total.
9. Write the updated `Session` entry.
10. Emit `TabSettled`.

Each skip emits `VoucherSkipped { reader, writer, key_id, cumulative, reason }`.
After the loop, `Claimable(treasury) += batch fee total` (one write).

```rust
fn settle_own(e: Env, writer: Address, vouchers: Vec<Voucher>) -> SettleSummary
```

- **Auth:** `writer`. **Paused:** blocked.
- **Rules:** the same as `settle`, with these additions:
  1. Every `voucher.writer == writer`, else `WrongWriter` and the whole call fails.
  2. Skip with `KEY_REVOKED` if `revoked`.
  3. Skip with `KEY_EXPIRED` if `now > valid_until`. This path has no grace period.
- **Purpose:** this is the writers' liveness path when the settler is unavailable ([section 3.7](#37-liveness-and-disputes)).

### Claims and views

| Function                                                                      | Auth | Paused  | Effect and event                                                                                                                                                               |
| ----------------------------------------------------------------------------- | ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `claim(recipient) -> i128`                                                    | none | allowed | 1. `amount = Claimable(recipient)`; if it is 0, return 0. 2. Remove the entry. 3. SAC `transfer(tab, recipient, amount)`. 4. Emit `Claimed`. Funds can only go to `recipient`. |
| `account(reader) -> Option<ReaderAccount>`                                    | none | n/a     | View                                                                                                                                                                           |
| `session_key(reader, key_id) -> Option<SessionKey>`                           | none | n/a     | View                                                                                                                                                                           |
| `paid(reader, key_id, writer) -> i128`                                        | none | n/a     | View                                                                                                                                                                           |
| `claimable(addr) -> i128`                                                     | none | n/a     | View                                                                                                                                                                           |
| `voucher_payload(reader, writer, key_id, cumulative, receipts_root) -> Bytes` | none | n/a     | The exact bytes to sign. Used by tests and client checks.                                                                                                                      |
| `config() -> TabConfig`                                                       | none | n/a     | View                                                                                                                                                                           |

### Administration

| Function                                 | Auth         | Effect                                                                                                              |
| ---------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `set_limits(max_balance, min_deposit)`   | admin        | Updates the limits, with `InvalidLimits` checks. Existing balances above a lower cap stay valid. Emits `LimitsSet`. |
| `set_treasury(treasury)`                 | admin        | New fees accrue to the new address. The old address keeps its claimable balance. Emits `TreasurySet`.               |
| `pause`, `unpause`, `upgrade`, `migrate` | as Core      | As Core ([section 2.2](02-core-contract.md#administration))                                                         |
| OpenZeppelin `AccessControl`             | OpenZeppelin | Grant or revoke `settler`, for example to move settlement to a hosted relayer                                       |

## 3.3 Storage

| Key                                       | Class            | Type            | TTL                                              | Growth bound                                            |
| ----------------------------------------- | ---------------- | --------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `Config`                                  | instance         | `TabConfig`     | instance                                         | 1                                                       |
| `Account(Address)`                        | persistent       | `ReaderAccount` | `TTL_THRESHOLD`/`TTL_EXTEND_TO` on every write   | One per reader                                          |
| `Claimable(Address)`                      | persistent       | `i128`          | same; removed on claim                           | One per writer with an unclaimed balance, plus treasury |
| `Session(Address, u32)`                   | temporary        | `SessionKey`    | `valid_until + SETTLE_GRACE - now` at each write | Live keys only (at most 37 days each)                   |
| `Paid(Address, u32, Address)`             | temporary        | `i128`          | same as its key                                  | Pairs settled under live keys only                      |
| OpenZeppelin roles, pause, schema version | per OpenZeppelin | n/a             | per OpenZeppelin                                 | Fixed                                                   |

**Why replay state is temporary.**

1. A voucher can be accepted only while its key's `Session` entry exists.
2. Every `Paid` entry under that key lives exactly as long as the key's settle window.
3. When the window closes, both entries expire together. No voucher under that key can ever be accepted again, so the per-pair cumulative cannot be replayed.

This removes per-pair persistent rent. In the feasibility build, moving
`Session` and `Paid` to temporary storage cut per-new-pair rent by about 74%,
from about 2.24 M to 0.58 M stroops. That figure comes from the SDK fee
estimator, which uses fee rates from before the October 2026 halving, so
absolute values are overstated.

## 3.4 Voucher format and signing domain

The signed message is the XDR encoding of `ScVal::Map` for `VoucherPayload`:
`soroban_sdk::xdr::ToXdr` on the struct. A `#[contracttype]` struct encodes
as a map with `Symbol` keys in ascending order. Entry order:

| Key             | Value                                          |
| --------------- | ---------------------------------------------- |
| `cumulative`    | `I128`                                         |
| `domain`        | `Symbol("quilltip_tab_v1")`                    |
| `key_id`        | `U32`                                          |
| `network_id`    | `Bytes(32)`: SHA-256 of the network passphrase |
| `reader`        | `Address`                                      |
| `receipts_root` | `Bytes(32)`                                    |
| `tab`           | `Address`: the Tab contract                    |
| `writer`        | `Address`                                      |

- **Size:** the measured payload is 404 bytes. It begins `00000011 00000001 00000008` (`SCV_MAP`, present, 8 entries).
- **Signature:** ed25519 over these bytes directly, with no pre-hash.
- **Domain separation:** `domain`, `network_id` and `tab` stop a voucher being replayed on another network, on another Tab instance, or as another protocol's message.
- **Client encoding:** the client builds the map with `xdr.ScVal.scvMap` and explicit sorted entries. CI MUST compare it byte for byte with `voucher_payload` for the shared test vectors.

**Monotonicity and replay rules.**

1. Within one `(reader, key_id, writer)`, `cumulative` strictly increases from voucher to voucher. A settled voucher can never be settled again, because `Paid >= cumulative` causes a `STALE` skip.
2. A newer voucher supersedes all earlier ones. The writer is owed `cumulative - Paid`, never more.
3. Counters restart at 0 for every new `key_id`.

## 3.5 Session keys

1. **Generation.**
   - The client generates an ed25519 key pair with WebCrypto (`Ed25519`, non-extractable), stored in IndexedDB per (user, network, tab contract).
   - If the browser lacks WebCrypto Ed25519, the client uses `@noble/curves` ed25519 with the private key in IndexedDB, and marks the key `extractable` in Convex for risk reporting.
2. **Registration.** One wallet-signed `register_key` per key.
   - App default lifetime: 7 days. Contract maximum: 30 days.
   - Default `spend_limit`: the current balance.
3. **Rotation.** Register a new key, then switch signing to it. The old key's accepted vouchers still settle. Convex stops accepting vouchers for a key 1 day before `valid_until`.
4. **Revocation.** `revoke_key` from the wallet. Convex stops accepting vouchers under that key as soon as the `KeyRevoked` event arrives, or immediately when the user revokes in the app.
5. **Loss** (cleared browser data). Register a new key. Vouchers Convex already holds still settle. No funds are lost.
6. **Exposure bound.** A stolen key can move at most `min(spend_limit - spent, balance)`, and only until `valid_until` (writer path) or `valid_until + SETTLE_GRACE` (settler path, which only submits vouchers Convex accepted).

## 3.6 Receipts and Merkle root

Each tab tip produces a receipt. Receipts stay off-chain, in Convex. The
voucher anchors them through `receipts_root`.

```rust
#[contracttype] // defined in quilltip-shared; never stored on chain
pub struct TipReceipt {
    pub amount: i128,               // gross, > 0
    pub article_id: BytesN<32>,
    pub client_ref: BytesN<16>,
    pub content_hash: BytesN<32>,
    pub cumulative_after: i128,     // Σ amount for seq 1..=this seq
    pub highlight_id: Option<BytesN<32>>,
    pub seq: u32,                   // 1, 2, 3 … per (reader, key_id, writer)
}
```

**Leaf:** `leaf = SHA-256(SHA-256(xdr(ScVal::Map(TipReceipt))))`. The double
hash prevents a 64-byte leaf from being read as an inner node.

**Tree construction:**

1. Order the leaves by `seq`.
2. At each level, hash adjacent pairs with `SHA-256(min(a,b) ‖ max(a,b))`, comparing bytes lexicographically. This is the OpenZeppelin `commutative_hash_pair` rule.
3. Carry an odd final node up unchanged.
4. The root of one leaf is the leaf itself.

Proofs verify with OpenZeppelin `crypto::merkle::Verifier<Sha256>`.

**Coverage:** a voucher's `receipts_root` covers **all** receipts of its
`(reader, key_id, writer)` from `seq` 1 to `n`. `cumulative` MUST equal
receipt `n`'s `cumulative_after`. Each settlement event therefore anchors the
complete history up to its cumulative amount.

## 3.7 Liveness and disputes

- **No dispute game.** The channel is one-directional and cumulative. The latest voucher always dominates, the reader cannot lower an amount already signed, and the writer cannot collect more than the signed cumulative.
- **Disputes about which tip a payment was for** are settled off-chain by Merkle proof against the anchored root.

| Risk                                         | Bound                                                                                                                                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reader withdraws before settlement           | The withdrawal waits `WITHDRAW_DELAY` (3 days). Convex settles every pair of a closing account first. The settler cadence target is ≤ 6 h.                                                                                        |
| Settler unavailable                          | Writers call `settle_own` with their latest voucher (the app shows a "collect now" action) while the key is valid. Alert at 6 h settler lag.                                                                                      |
| Key expires before settlement                | Convex stops accepting under a key 1 day before `valid_until`. The settler prioritises keys within 2 days of `valid_until + SETTLE_GRACE`.                                                                                        |
| Short balance (reader signed beyond balance) | Convex refuses vouchers beyond `balance - outstanding`. If it happens anyway, `settle` pays what is available and records the shortfall. The same voucher can collect the rest after a later deposit (`cumulative > Paid` still). |
| Spend limit reached                          | Same handling as a short balance. The reader registers a new key with a new limit.                                                                                                                                                |

## 3.8 Settlement policy (Convex settler)

A cron runs every 10 minutes on testnet. A `(reader, key_id, writer)` pair is
due when **any** of these holds:

1. Its oldest unsettled receipt is older than 6 h.
2. Its unsettled amount is at least 50,000,000 stroops (5 XLM).
3. The reader has a pending withdrawal.
4. The key is within 2 days of the end of its settle window.

**Batching:** up to 32 due vouchers per transaction, ordered by:

1. Closing accounts.
2. Expiring keys.
3. Age.

Each submission:

1. Simulates the transaction.
2. Re-checks every signature off-chain.
3. Submits.
4. Records the outcome per voucher from the `TabSettled` and `VoucherSkipped` events.

## 3.9 Events

| Event                                  | Topics                                | Data                                                                                                                                                   |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Deposited`                            | `deposited`, `reader`                 | `amount`, `balance_after`                                                                                                                              |
| `KeyRegistered`                        | `key_registered`, `reader`            | `key_id`, `public_key`, `valid_until`, `spend_limit`                                                                                                   |
| `KeyRevoked`                           | `key_revoked`, `reader`               | `key_id`, `valid_until`                                                                                                                                |
| `TabSettled`                           | `tab_settled`, `reader`, `writer`     | `key_id`, `cumulative`, `paid_after`, `gross`, `fee`, `receipts_root`, `by_writer` (bool). `net = gross - fee`. `shortfall = cumulative - paid_after`. |
| `VoucherSkipped`                       | `voucher_skipped`, `reader`, `writer` | `key_id`, `cumulative`, `reason` (u32: 1 `KEY_UNKNOWN`, 2 `KEY_EXPIRED`, 3 `STALE`, 4 `SHORTFALL`, 5 `KEY_REVOKED`)                                    |
| `Claimed`                              | `claimed`, `recipient`                | `amount`                                                                                                                                               |
| `WithdrawStarted`                      | `withdraw_started`, `reader`          | `balance`, `unlock_ledger`                                                                                                                             |
| `WithdrawCancelled`                    | `withdraw_cancelled`, `reader`        | `balance`                                                                                                                                              |
| `Withdrawn`                            | `withdrawn`, `reader`                 | `amount`                                                                                                                                               |
| `LimitsSet`, `TreasurySet`, `Migrated` | name                                  | new values                                                                                                                                             |

## 3.10 Errors (`TabError`, 30–69)

| Code | Name                  | Code | Name                |
| ---- | --------------------- | ---- | ------------------- |
| 30   | `InvalidAmount`       | 38   | `WrongWriter`       |
| 31   | `BelowMinimumDeposit` | 39   | `NothingToWithdraw` |
| 32   | `BalanceCapExceeded`  | 40   | `WithdrawPending`   |
| 33   | `InvalidKeyExpiry`    | 41   | `WithdrawLocked`    |
| 34   | `InvalidKey`          | 42   | `NoWithdrawPending` |
| 35   | `KeyNotFound`         | 43   | `Overflow`          |
| 36   | `BatchEmpty`          | 44   | `AlreadyMigrated`   |
| 37   | `BatchTooLarge`       | 45   | `InvalidLimits`     |

## 3.11 Resource bounds (measured)

These figures come from the feasibility build with the final `TabSettled`
shape and the `Session` write: every reader and writer distinct, an ed25519
check per voucher, steady state (entries already exist), and mainnet
per-transaction limits enforced.

| Vouchers | Instructions | Write entries | Write bytes | Event bytes | Result                       |
| -------: | -----------: | ------------: | ----------: | ----------: | ---------------------------- |
|       32 |       33.3 M |           130 |      26,204 |      13,696 | fits (the cap, 16% headroom) |
|       36 |       39.2 M |           146 |      29,452 |      15,408 | fits                         |
|       40 |            — |             — |           — |      17,120 | rejected (events > 16,384)   |

Per voucher: about 428 event bytes, about 1.0 M instructions (mostly ed25519),
and 4 write entries when every party is distinct. The resource test MUST
confirm that 32 vouchers stay at or below 14,000 event bytes and 200 write
entries.
