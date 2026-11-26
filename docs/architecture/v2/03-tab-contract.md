# 3. Tab contract and protocol (`quilltip-tab`)

[Index](../v2-spec.md)

A tab is a prepaid balance that a reader holds in the Tab contract.

- **Tipping.** The reader tips writers by signing cumulative vouchers off-chain with a session key held in the browser. Convex accepts each voucher and countersigns it.
- **Settlement.** A settler submits many vouchers in one transaction. Settlement moves funds from the reader's balance into the writers' and the treasury's claimable balances, using the 250 bps split.
- **Payout.** Writers and the treasury claim when they choose.
- **Withdrawal.** Readers can withdraw the unspent balance after a waiting period.

**Scope rules:**

- One Tab instance serves one token. A second asset needs a second instance.
- Each voucher pays exactly one writer address. The app offers tab tips only for articles without co-author splits ([section 2.1](02-core-contract.md#21-types)).
- Tab tips do not change `Core.article_total`, so they do not count toward the NFT threshold ([section 4](04-nft-contract.md)).

## 3.1 Constants and types

```rust
pub const FEE_BPS: i128 = 250;
pub const MAX_SETTLE_BATCH: u32 = 32;
pub const MAX_KEY_LIFETIME: u32 = 30 * DAY;
pub const SETTLE_GRACE: u32 = 7 * DAY;
pub const WITHDRAW_DELAY: u32 = 3 * DAY;
pub const MAX_ACCEPTOR_KEYS: u32 = 2;
pub const DOMAIN: &str = "quilltip_tab_v1";               // Symbol
pub const ACCEPT_DOMAIN: &str = "quilltip_tab_accept_v1"; // Symbol

#[contracttype] #[derive(Clone)]
pub struct TabConfig {
    pub token: Address, pub treasury: Address, pub max_balance: i128, pub min_deposit: i128,
    pub acceptor_keys: Vec<BytesN<32>>, // ed25519; [current, previous]
}

#[contracttype] #[derive(Clone)]
pub struct ReaderAccount { pub balance: i128, pub next_key_id: u32, pub withdraw_unlock: u32 } // 0 = none pending

#[contracttype] #[derive(Clone)]
pub struct SessionKey {
    pub public_key: BytesN<32>,   // ed25519
    pub valid_until: u32,         // last ledger Convex may accept vouchers under this key
    pub spend_limit: i128,        // max gross settled under this key, across all writers
    pub spent: i128,
    pub revoked: bool,
}

#[contracttype] #[derive(Clone)]
pub struct Voucher {
    pub reader: Address, pub writer: Address, pub key_id: u32,
    pub cumulative: i128, pub receipts_root: BytesN<32>,
    pub signature: BytesN<64>,           // session key over VoucherPayload
    pub acceptance: Option<Acceptance>,  // required by settle_own; ignored by settle
}

#[contracttype] #[derive(Clone)]
pub struct Acceptance { pub acceptor: BytesN<32>, pub signature: BytesN<64> } // acceptor key over AcceptancePayload

#[contracttype] #[derive(Clone)]
pub struct VoucherPayload { // signed bytes = XDR of this struct
    pub cumulative: i128, pub domain: Symbol, pub key_id: u32, pub network_id: BytesN<32>,
    pub public_key: BytesN<32>, pub reader: Address, pub receipts_root: BytesN<32>,
    pub tab: Address, pub writer: Address,
}

#[contracttype] #[derive(Clone)]
pub struct AcceptancePayload { pub domain: Symbol, pub payload_hash: BytesN<32> } // SHA-256 of VoucherPayload bytes

#[contracttype] #[derive(Clone)]
pub struct SettleSummary { pub settled: u32, pub skipped: u32, pub gross: i128, pub fee: i128 }
```

Testnet configuration at deploy:

| Setting         | Value                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `token`         | Native XLM SAC                                                                                                       |
| `max_balance`   | 10,000,000,000 stroops (1,000 XLM)                                                                                   |
| `min_deposit`   | 10,000,000 stroops (1 XLM)                                                                                           |
| `acceptor_keys` | The testnet acceptor public key, held by Convex ([section 5.11](05-flows-and-admin.md#511-roles-and-administration)) |

## 3.2 Entry points

### Constructor

```rust
fn __constructor(e: Env, admin: Address, pauser: Address, upgrader: Address, settler: Address,
                 token: Address, treasury: Address, max_balance: i128, min_deposit: i128,
                 acceptor_key: BytesN<32>)
```

- **Sets:** the roles, `TabConfig` (`acceptor_keys = [acceptor_key]`), and schema version 1.
- **Preconditions:**
  - `0 < min_deposit <= max_balance`, else `InvalidLimits`.
  - `acceptor_key` is not all zeros, else `InvalidKey`.

### Pause scope

Pause blocks the operations that add funds or keys: `deposit`, `open_session`
and `register_key`.

Pause does **not** block `settle`, `settle_own`, `claim`, `revoke_key`,
`withdraw_start` or `withdraw` (I-27). Settlement therefore keeps paying
accepted vouchers during any pause, and readers keep their exit. The response
to a defect in settlement logic is to revoke the `settler` role and call
`set_acceptor` twice with fresh keys. Together these stop both settlement paths
for new vouchers.
Then upgrade ([section 5.11](05-flows-and-admin.md#511-roles-and-administration)).

### Reader operations

| Function                                                                    | Auth   | Paused  | Preconditions                                                                                                                       | Effects and event                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deposit(reader, amount)`                                                   | reader | blocked | `amount >= min_deposit` (`BelowMinimumDeposit`); `balance + amount <= max_balance` (`BalanceCapExceeded`)                           | 1. SAC `transfer(reader, tab, amount)`. 2. `balance += amount`. 3. If a withdrawal is pending, clear it and emit `WithdrawCancelled`. 4. Emit `Deposited`.                            |
| `register_key(reader, public_key, valid_until, spend_limit) -> u32`         | reader | blocked | `now < valid_until <= now + MAX_KEY_LIFETIME` (`InvalidKeyExpiry`); `public_key` not all zeros and `spend_limit > 0` (`InvalidKey`) | 1. Create `Account` if absent. 2. `key_id = next_key_id`, then `next_key_id += 1`. 3. Write temporary `Session` with TTL `valid_until + SETTLE_GRACE - now`. 4. Emit `KeyRegistered`. |
| `open_session(reader, amount, public_key, valid_until, spend_limit) -> u32` | reader | blocked | `amount >= 0` (`InvalidAmount`); `register_key` checks; when `amount > 0`, the `deposit` checks                                     | `deposit` (when `amount > 0`), then `register_key`, in one invocation and one signature. Same events.                                                                                 |
| `revoke_key(reader, key_id)`                                                | reader | allowed | Key exists (`KeyNotFound`)                                                                                                          | 1. `revoked = true`. 2. `valid_until = min(valid_until, now)`. 3. Emit `KeyRevoked`. Vouchers accepted before revocation can still settle within `SETTLE_GRACE`.                      |
| `withdraw_start(reader)`                                                    | reader | allowed | `balance > 0` (`NothingToWithdraw`); no withdrawal pending (`WithdrawPending`)                                                      | 1. `withdraw_unlock = now + WITHDRAW_DELAY`. 2. Emit `WithdrawStarted`.                                                                                                               |
| `withdraw(reader) -> i128`                                                  | reader | allowed | A withdrawal is pending (`NoWithdrawPending`); `now >= withdraw_unlock` (`WithdrawLocked`)                                          | 1. `amount = balance`. 2. Set `balance = 0` and `withdraw_unlock = 0`. 3. SAC `transfer(tab, reader, amount)`. 4. Emit `Withdrawn`. The `Account` entry is kept (I-28).               |

### Settlement

```rust
fn settle(e: Env, settler: Address, vouchers: Vec<Voucher>) -> SettleSummary
```

- **Auth:** the `settler` role, through OpenZeppelin `only_role`.
- **Paused:** allowed.
- **Batch size:** `1 <= len <= MAX_SETTLE_BATCH`, else `BatchEmpty` or `BatchTooLarge`.

For each voucher, in order:

1. Load `Session(reader, key_id)`. If it is absent, skip with `KEY_UNKNOWN`.
2. If `now > valid_until + SETTLE_GRACE`, skip with `KEY_EXPIRED`.
3. Load `paid = Paid(reader, key_id, writer)`, defaulting to 0. If `cumulative <= paid`, skip with `STALE`.
4. Rebuild `VoucherPayload` from the voucher, the stored `public_key`, `e.ledger().network_id()` and the contract address. Then run `ed25519_verify(public_key, xdr(payload), signature)`.
5. Load `Account(reader)`. It is missing only if I-28 is broken, and then the call fails with `AccountMissing`.
6. Compute `delta = cumulative - paid`.
7. Compute `gross = min(delta, account.balance, spend_limit - spent)`. If `gross == 0`, skip with `SHORTFALL`.
8. Compute the fee on the cumulative paid for this pair, not on the increment (I-13, I-31):
   - `paid_after = paid + gross`
   - `fee = floor(paid_after × 250 / 10,000) − floor(paid × 250 / 10,000)`
   - `net = gross − fee`
9. Write the new state:
   - `Paid = paid_after`, with temporary TTL `max(1, valid_until + SETTLE_GRACE − now)`.
   - `account.balance -= gross`
   - `session.spent += gross`
   - `Claimable(writer) += net`
   - add `fee` to the batch fee total
   - write `Session` and `Account`
10. Emit `TabSettled`.

Each skip emits `VoucherSkipped`. After the loop, add the batch fee total to
`Claimable(treasury)` in one write.

**Conditions that abort the whole transaction.** The settler MUST rule these
out before it submits. Nothing in the batch settles if any of them occurs.

1. **Invalid signature.** `ed25519_verify` traps. This covers any encoding difference in `network_id`, `tab`, `public_key` or address encoding, and any wrong key.
2. **Account missing.** The call fails with `AccountMissing`.
3. **Overflow.** Any checked addition overflows (`Overflow`).
4. **Batch size.** The batch breaks the size rule.
5. **Missing role.** The caller lacks the `settler` role.

The settler builds every payload with the shared encoder, which is checked
against the contract's `voucher_payload` output in the test vectors. It
verifies each signature off-chain and simulates the whole batch. If simulation
fails, the settler splits the batch in halves until it isolates the failing
voucher. That voucher is marked `REJECTED` for review, and the rest are
submitted.

```rust
fn settle_own(e: Env, writer: Address, vouchers: Vec<Voucher>) -> SettleSummary
```

- **Auth:** `writer`. **Paused:** allowed.
- **Rules:** the same as `settle`, plus:
  1. Every `voucher.writer == writer`, else `WrongWriter`, and the whole call fails.
  2. `acceptance` MUST be `Some`, and `acceptance.acceptor` MUST be in `acceptor_keys`. Otherwise the voucher is skipped with `NOT_ACCEPTED`.
  3. `ed25519_verify(acceptance.acceptor, xdr(AcceptancePayload{ACCEPT_DOMAIN, sha256(voucher payload bytes)}), acceptance.signature)` must pass. A failed verify traps, like a session-key signature.
  4. The windows are the same as for `settle`, including `SETTLE_GRACE`.
- **Purpose:** the countersignature proves that Convex accepted the voucher under its rate and balance rules. A session key used outside the app therefore cannot self-settle to an arbitrary address. This keeps the writers' liveness path without widening the stolen-key exposure ([section 3.5](#35-session-keys)).

### Claims and views

| Function                                                                      | Auth | Paused  | Effect and event                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ---- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claim(recipient) -> i128`                                                    | none | allowed | 1. `amount = Claimable(recipient)`; if it is 0, return 0. 2. Remove the entry. 3. SAC `transfer(tab, recipient, amount)`. 4. Emit `Claimed`. Funds go only to `recipient`. |
| `account(reader) -> Option<ReaderAccount>`                                    | none | n/a     | View                                                                                                                                                                       |
| `session_key(reader, key_id) -> Option<SessionKey>`                           | none | n/a     | View                                                                                                                                                                       |
| `paid(reader, key_id, writer) -> i128`                                        | none | n/a     | View                                                                                                                                                                       |
| `claimable(addr) -> i128`                                                     | none | n/a     | View                                                                                                                                                                       |
| `voucher_payload(reader, writer, key_id, cumulative, receipts_root) -> Bytes` | none | n/a     | The exact bytes to sign. Uses the stored `public_key`; fails with `KeyNotFound` if the key is unknown.                                                                     |
| `config() -> TabConfig`                                                       | none | n/a     | View                                                                                                                                                                       |

### Administration

| Function                                 | Auth         | Effect                                                                                                              |
| ---------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `set_limits(max_balance, min_deposit)`   | admin        | Updates the limits, with `InvalidLimits` checks. Existing balances above a lower cap stay valid. Emits `LimitsSet`. |
| `set_treasury(treasury)`                 | admin        | New fees accrue to the new address. The old address keeps its claimable balance. Emits `TreasurySet`.               |
| `set_acceptor(public_key)`               | admin        | Sets `acceptor_keys = [public_key, previous current]`, keeping at most two keys. Emits `AcceptorSet`.               |
| `pause`, `unpause`, `upgrade`, `migrate` | as Core      | As Core ([section 2.2](02-core-contract.md#administration)), with the pause scope above                             |
| OpenZeppelin `AccessControl`             | OpenZeppelin | Grant or revoke `settler`. `renounce_admin` is overridden to fail (`AdminRenounceDisabled`).                        |

## 3.3 Storage

| Key                                       | Class            | Type            | TTL                                                      | Growth bound                                            |
| ----------------------------------------- | ---------------- | --------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| `Config`                                  | instance         | `TabConfig`     | instance                                                 | 1                                                       |
| `Account(Address)`                        | persistent       | `ReaderAccount` | `TTL_THRESHOLD`/`TTL_EXTEND_TO` on every write           | One per reader. Never removed (I-28).                   |
| `Claimable(Address)`                      | persistent       | `i128`          | same; removed on claim                                   | One per writer with an unclaimed balance, plus treasury |
| `Session(Address, u32)`                   | temporary        | `SessionKey`    | `valid_until + SETTLE_GRACE - now`, set at registration  | Live keys only (at most 37 days each)                   |
| `Paid(Address, u32, Address)`             | temporary        | `i128`          | `max(1, valid_until + SETTLE_GRACE - now)` at each write | Pairs settled under live keys only                      |
| OpenZeppelin roles, pause, schema version | per OpenZeppelin | n/a             | per OpenZeppelin                                         | Fixed                                                   |

**Why replay state can be temporary** (I-29):

1. The contract accepts a voucher only while `now <= valid_until + SETTLE_GRACE` for its key.
2. `Session` and every `Paid` entry of that key live at least until that ledger.
   - A TTL is never shortened.
   - Revocation lowers `valid_until`, which only shortens the acceptance window.
3. When the window closes, no voucher under the key can be accepted. The entries can then expire safely.
4. `key_id` values are never reused for a reader (I-28), and the payload binds `public_key`. So an expired key's vouchers cannot become valid again under a new registration.

**Effect on rent.** This design removes persistent rent for each pair. In the
feasibility build, temporary `Session` and `Paid` entries cut the rent for each
new pair by about 74%, from about 2.24 M to 0.58 M stroops. These figures come
from the SDK fee estimator, which uses rates from before the October 2026
halving, so the absolute values are overstated.

## 3.4 Voucher format and signing domain

The signed message is the XDR encoding of `VoucherPayload` as an `ScVal::Map`,
produced by `soroban_sdk::xdr::ToXdr`. A `#[contracttype]` struct encodes as a
map with `Symbol` keys in ascending order:

| Key             | Value                                             |
| --------------- | ------------------------------------------------- |
| `cumulative`    | `I128`                                            |
| `domain`        | `Symbol("quilltip_tab_v1")`                       |
| `key_id`        | `U32`                                             |
| `network_id`    | `Bytes(32)`: SHA-256 of the network passphrase    |
| `public_key`    | `Bytes(32)`: the session key's ed25519 public key |
| `reader`        | `Address`                                         |
| `receipts_root` | `Bytes(32)`                                       |
| `tab`           | `Address`: the Tab contract                       |
| `writer`        | `Address`                                         |

**Size.**

- The payload begins `00000011 00000001 00000009` (`SCV_MAP`, present, 9 entries).
- Its length depends on the address types. An account address (`G…`) encodes 4 bytes longer than a contract address (`C…`).
- The shared test vectors fix the exact bytes for G/G, G/C and C/C reader and writer pairs. Without `public_key`, the C/C payload measured 404 bytes.

**Signatures.**

- Session key: an ed25519 signature over these bytes directly, with no pre-hash.
- Acceptor: an ed25519 signature over the XDR of `AcceptancePayload`, whose `payload_hash` is the SHA-256 of these bytes.

**Domain separation.** `domain`, `network_id`, `tab` and `public_key` bind a
voucher to one protocol, network, Tab instance and session key (I-14).

**Client encoding.**

- The client builds the map with `xdr.ScVal.scvMap`, writing the sorted entries explicitly.
- CI compares the result byte for byte with `voucher_payload` for the shared vectors.

**Monotonicity and replay rules:**

1. Within one `(reader, key_id, writer)`, `cumulative` strictly increases. A settled voucher never settles again: `Paid >= cumulative` gives `STALE`.
2. A newer voucher supersedes all earlier ones. The writer is owed `cumulative - Paid`, never more.
3. Counters restart at 0 for every new `key_id`. `key_id` is never reused (I-28).

## 3.5 Session keys

1. **Generation.**
   - The client generates an ed25519 key pair with WebCrypto (`Ed25519`, non-extractable). It stores the key pair in IndexedDB, keyed by user, network and tab contract.
   - Fallback: `@noble/curves` ed25519 with the private key in IndexedDB. Such keys are marked `extractable` in Convex.
   - Non-extractable stops a script from copying the key, not from using it. The limits below therefore apply to every key.
2. **Registration.** One wallet-signed `register_key` or `open_session` per key.
   - App default lifetime: 7 days. Contract maximum: 30 days.
   - Default `spend_limit`: `min(balance, 500,000,000)` stroops (50 XLM).
3. **Convex limits on acceptance.**
   - Per reader per UTC day: `TAB_DAILY_LIMIT` (default 200,000,000 stroops, 20 XLM).
   - Per tip: at most `TAB_TIP_MAX` (default 50,000,000 stroops, 5 XLM).
   - Per tip: at least the Core `min_tip` of the token.
   - The writer must be the registered author of a registered article with no splits.
4. **Rotation.** The reader registers a new key and signing moves to it. The old key's accepted vouchers still settle. Convex stops accepting under a key 1 day before `valid_until`.
5. **Revocation.** `revoke_key` from the wallet. Convex stops accepting under the key when the user revokes in the app, or when the `KeyRevoked` event arrives.
6. **Loss** (cleared site data, or iOS storage eviction). The reader registers a new key. Accepted vouchers still settle. A key whose local ledger is missing is never used again ([section 5.6](05-flows-and-admin.md#56-tab-tip)).
7. **Exposure bound.**
   - A script running in the app origin can sign vouchers with the key handle. Those vouchers settle only through Convex acceptance: the settler path, or `settle_own` with a countersignature.
   - The loss is therefore bounded by the Convex limits above, the key's `spend_limit` and its lifetime.
   - The content security policy issue removes `'unsafe-inline'` scripts, reducing the chance of such a script ([section 8.8](08-testing-and-deployment.md#88-issue-map)).

## 3.6 Receipts and Merkle root

Each tab tip produces a receipt. Receipts stay off-chain in Convex. The voucher
anchors them through `receipts_root`.

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

**Leaf.** `leaf = SHA-256(SHA-256(xdr(ScVal::Map(TipReceipt))))`. The double
hash prevents a 64-byte leaf from being read as an inner node.

**Tree.**

1. Order the leaves by `seq`.
2. At each level, hash adjacent pairs as `SHA-256(min(a,b) ‖ max(a,b))` (bytewise comparison). This is the OpenZeppelin `commutative_hash_pair` rule.
3. Carry an odd final node up unchanged.
4. The root of one leaf is the leaf itself.

**Verification.**

- Proofs verify with OpenZeppelin `crypto::merkle::Verifier<Sha256>` in Rust.
- Convex and the client use a TypeScript port, built on `@noble/hashes`, which the shared vectors check.
- A verifier MUST recompute the leaf from the receipt. It MUST NOT accept a leaf hash supplied by a third party.

**Coverage.**

- A voucher's `receipts_root` covers all receipts of its `(reader, key_id, writer)`, from `seq` 1 to `n`.
- `cumulative` equals receipt `n`'s `cumulative_after`.
- At most `MAX_RECEIPTS_PER_PAIR = 256` receipts are allowed per pair. After that, the client rotates the key.
- Convex stores the pair's leaf hashes on its `tabVouchers` row, so a submission reads one document.

## 3.7 Liveness and disputes

**No dispute game.** The channel is one-directional and cumulative. The latest
voucher always dominates. The reader cannot lower a signed amount, and the
writer cannot collect more than the signed cumulative. Disputes about which tip
a payment was for are settled off-chain, by Merkle proof against the anchored
root.

**Writer recourse:**

- Convex delivers every accepted, countersigned latest voucher to the writer's dashboard.
- The dashboard stores it in the writer's browser and offers a JSON download.
- `settle_own` accepts such a file.

Settlement through `settle_own` does not need the settler to be live. It does
need the writer to have fetched the voucher while Convex was reachable. This
dependency on Convex is stated, not removed.

| Risk                               | Bound                                                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pause                              | No effect on settlement or exits (I-27).                                                                                                                                                                          |
| Reader withdraws before settlement | The withdrawal waits `WITHDRAW_DELAY` (3 days). Convex settles every pair of a closing account first.                                                                                                             |
| Settler outage                     | The design tolerates an outage of up to `WITHDRAW_DELAY` − 6 h (about 2.75 days) with no writer action, and up to `SETTLE_GRACE` (7 days) with `settle_own`. Alerts fire at 6 h of settler lag and again at 24 h. |
| Key expires before settlement      | Convex stops accepting 1 day before `valid_until`. The settler prioritises keys within 2 days of `valid_until + SETTLE_GRACE`.                                                                                    |
| Short balance                      | Convex refuses vouchers beyond `balance − outstanding`. If one settles short anyway, the shortfall stays collectable by the same voucher after a deposit.                                                         |
| Shortfall ordering                 | When several writers are owed from one short balance, the settler pays receipts in order of `ACCEPTED` time, oldest first. This is a stated rule, not a contract invariant.                                       |
| Account closed with a shortfall    | Once the account is `CLOSED` and the key window is over, the remaining receipts become `UNPAID`. The writer sees "the reader's tab closed before this tip settled".                                               |

## 3.8 Settlement policy (Convex settler)

**Cadence.** A cron runs every 10 minutes. It holds a single-flight lease, so
only one settlement or automatic-claim submission is in flight per settler
account.

**When a pair is due.** A `(reader, key_id, writer)` pair is due when any of
these holds:

1. Its oldest unsettled receipt is older than 6 h.
2. Its unsettled amount is at least 50,000,000 stroops (5 XLM).
3. The reader has a pending withdrawal.
4. The key is within 2 days of the end of its settle window.

**Batch order.** Each batch holds up to 32 vouchers:

1. Closing accounts first.
2. Then expiring keys.
3. Then by age.

**Submission steps** ([section 3.2](#settlement)):

1. Run the pre-checks.
2. Simulate.
3. Bisect on failure.
4. Submit.
5. Apply the `TabSettled` and `VoucherSkipped` events.

**Balance alert.** An alert fires when the settler account's XLM balance falls
below 50 XLM.

## 3.9 Events

| Event                                                 | Topics                                | Data                                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Deposited`                                           | `deposited`, `reader`                 | `amount`, `balance_after`                                                                                                                                       |
| `KeyRegistered`                                       | `key_registered`, `reader`            | `key_id`, `public_key`, `valid_until`, `spend_limit`                                                                                                            |
| `KeyRevoked`                                          | `key_revoked`, `reader`               | `key_id`, `valid_until`                                                                                                                                         |
| `TabSettled`                                          | `tab_settled`, `reader`, `writer`     | `key_id`, `cumulative`, `paid_after`, `gross`, `fee`, `receipts_root`, `by_writer` (bool). Derived: `net = gross - fee`, `shortfall = cumulative - paid_after`. |
| `VoucherSkipped`                                      | `voucher_skipped`, `reader`, `writer` | `key_id`, `cumulative`, `reason` (u32: 1 `KEY_UNKNOWN`, 2 `KEY_EXPIRED`, 3 `STALE`, 4 `SHORTFALL`, 5 `NOT_ACCEPTED`)                                            |
| `Claimed`                                             | `claimed`, `recipient`                | `amount`                                                                                                                                                        |
| `WithdrawStarted`                                     | `withdraw_started`, `reader`          | `balance`, `unlock_ledger`                                                                                                                                      |
| `WithdrawCancelled`                                   | `withdraw_cancelled`, `reader`        | `balance`                                                                                                                                                       |
| `Withdrawn`                                           | `withdrawn`, `reader`                 | `amount`                                                                                                                                                        |
| `LimitsSet`, `TreasurySet`, `AcceptorSet`, `Migrated` | name only                             | new values                                                                                                                                                      |

## 3.10 Errors (`TabError`, 30–69)

| Code | Name                  | Code | Name                    |
| ---- | --------------------- | ---- | ----------------------- |
| 30   | `InvalidAmount`       | 39   | `NothingToWithdraw`     |
| 31   | `BelowMinimumDeposit` | 40   | `WithdrawPending`       |
| 32   | `BalanceCapExceeded`  | 41   | `WithdrawLocked`        |
| 33   | `InvalidKeyExpiry`    | 42   | `NoWithdrawPending`     |
| 34   | `InvalidKey`          | 43   | `Overflow`              |
| 35   | `KeyNotFound`         | 44   | `AlreadyMigrated`       |
| 36   | `BatchEmpty`          | 45   | `InvalidLimits`         |
| 37   | `BatchTooLarge`       | 46   | `AdminRenounceDisabled` |
| 38   | `WrongWriter`         | 47   | `AccountMissing`        |

## 3.11 Resource bounds (measured)

These figures come from feasibility builds under the SDK's mainnet
per-transaction limits. Every reader and writer is distinct, and the
measurements are in steady state. Instruction counts were taken in native test
mode. The same contract registered as Wasm used about 35% more instructions in
an independent run: 45.0 M at 32 vouchers.

| Path and vouchers                          | Instructions (native) | Write entries |   Write bytes | Event bytes | Result                       |
| ------------------------------------------ | --------------------: | ------------: | ------------: | ----------: | ---------------------------- |
| `settle`, 32                               |                33.3 M |           130 | 26,204–29,020 |      13,696 | fits (the cap, 16% headroom) |
| `settle`, 36                               |                39.2 M |           146 |        29,452 |      15,408 | fits                         |
| `settle`, 38                               |                     — |           154 |             — |      16,264 | fits (independent run)       |
| `settle`, 39 to 40                         |                     — |             — |             — |    > 16,384 | rejected                     |
| `settle_own`, 32 (two ed25519 per voucher) |                47.1 M |           130 |        26,204 |      13,696 | fits                         |

- Write bytes differed between the two independent builds (26,204 against 29,020) because of struct shapes. Both are far below 132,096.
- The resource test MUST record the figures for the CLI-built Wasm. It MUST confirm that 32 vouchers stay at or below 14,000 event bytes and 200 write entries, for both `settle` and `settle_own`.
