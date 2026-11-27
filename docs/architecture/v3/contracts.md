# C. Contract changes

One v3 contract set is deployed once on testnet with
`scripts/contracts/deploy-v2-testnet.ts` (a new set, section C4). It starts a
new `CHAIN_EPOCH`. The changes are the smallest set the experience needs;
everything else in the v2 contracts stays, including their proven behaviour
with passkey (contract) accounts.

## C1. Summary

| Contract    | Change                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab         | Direct payout to writers in `settle`; instant withdrawal countersigned by the acceptor; 90 day keys. Still one token per instance: one Tab per registry token                            |
| Core        | `MAX_TOKENS` 4 → 16, so the allowlist can hold the registry. No other change                                                                                                             |
| Article NFT | No change; redeployed with the set because it is bound to the Core address                                                                                                               |
| Shared      | New `TAB_WITHDRAW_DOMAIN = "quilltip_tab_withdraw_v1"` and `WithdrawPayload`. Voucher and acceptance payloads are unchanged (they already bind the Tab contract address and the network) |

### Decisions

- **One Tab instance per token**, not a multi-token Tab. The constructor
  already takes `token`; per-token instances isolate tokens and keep one
  audit scope. A reader's device key is registered in each Tab the reader
  funds; the registration rides on the first deposit into that Tab
  (`open_session`), so it adds no prompt. Settlement sends one transaction
  per Tab with due pairs.
- **The per-key spend limit stays.** The app registers each key with
  `spend_limit = max_balance` of that Tab, so a deposit needs a new key only
  when the key's remaining headroom is below the deposit; the app then uses
  `open_session` for that deposit (one approval, as for any deposit).
- **No `deposit_for`.** Practice money and gifts reach a reader as a token
  transfer to the reader's address, which the reader's first `open_session`
  deposits ([section 5.5](05-accounts.md#55-funding-without-a-wallet)).

## C2. Tab

### Entry points that change

```rust
/// Settles reader-signed vouchers. Settler role only.
/// Every writer in the batch who is not in `hold` is paid the batch's net
/// for that writer at the end of the call (one transfer per writer).
/// Writers in `hold` are credited to `Claimable` as in v2.
fn settle(settler: Address, vouchers: Vec<Voucher>, hold: Vec<Address>) -> SettleSummary;

/// The caller's own countersigned vouchers; the caller is paid directly.
fn settle_own(writer: Address, vouchers: Vec<Voucher>) -> SettleSummary;

/// Pays `amount` of the reader's balance at once. `acceptor` must be one of
/// `acceptor_keys`, `signature` an ed25519 signature over `WithdrawPayload`.
fn withdraw_now(reader: Address, amount: i128, nonce: u64, valid_until: u32,
                acceptor: BytesN<32>, signature: BytesN<64>) -> i128;

/// The exact bytes the acceptor signs for `withdraw_now`.
fn withdraw_payload(reader: Address, amount: i128, nonce: u64, valid_until: u32) -> Bytes;
```

Unchanged: the constructor, `deposit`, `open_session`, `register_key`,
`revoke_key`, `withdraw_start` and `withdraw` (the delayed path stays, so a
reader can always leave without Convex), `claim`, the views, administration,
pause, upgrade and roles.

### Rules

1. **Payout.** `settle_batch` accumulates `net` per writer in a map. At the
   end of `settle`, for each writer not in `hold` it transfers the sum from
   the contract to the writer and publishes `PaidOut { writer, amount }`;
   for each writer in `hold` it adds the sum to `Claimable(writer)`. The
   treasury fee is added to `Claimable(treasury)` as in v2. A transfer that
   cannot succeed (a classic account without a trustline for a credit asset)
   traps the call; the settler sees it in simulation and puts that writer in
   `hold` ([section 3.5](03-settlement.md#35-automatic-payout)).
2. **Instant withdrawal.** `withdraw_now` requires `reader.require_auth()`,
   `acceptor ∈ acceptor_keys`, a valid signature over
   `WithdrawPayload { domain, contract, network_id, reader, amount, nonce, valid_until }`,
   `nonce == WithdrawNonce(reader)`,
   `now ≤ valid_until ≤ now + MAX_WITHDRAW_ATTESTATION` (720 ledgers, 1 hour)
   and `0 < amount ≤ balance`. It increments the nonce, lowers the balance,
   transfers, cancels a pending delayed withdrawal if the balance becomes
   zero, and publishes `WithdrawnNow { reader, amount, nonce }`. It works
   while paused, like `withdraw` (v2 I-27).
3. **Key lifetime.** `MAX_KEY_LIFETIME` rises from 30 to 90 days. Temporary
   entries live until `valid_until + SETTLE_GRACE`, at most 97 days; P1
   checks this against the testnet maximum entry lifetime.

### Storage and events

New: `WithdrawNonce(reader)` (persistent, `u64`). New events: `PaidOut`,
`WithdrawnNow`. `TabSettled` gains `paid_out: bool`. Nothing else changes, so
the v2 event handlers keep working for every other event.

### Convex side of the instant withdrawal

`balance.prepareWithdraw({ token, amountBaseUnits })` signs the attestation
only when `amount ≤ confirmedBalance − outstanding − reserved − tipOnly`. It
sets `tabAccounts.withdrawReserved = { amount, nonce, validUntil }`, which
acceptance subtracts from `available` until the `WithdrawnNow` event lands or
`validUntil` passes. Because the reservation is at most `available`, every
accepted voucher stays payable after the withdrawal, and settlement needs no
change while a reservation is live.

## C3. Core

`MAX_TOKENS` rises from 4 to 16 (`contracts/core/src/storage.rs`). `tip`,
`tip_batch`, splits, the fee and `client_ref` are unchanged. The token list is
administered with the existing `set_token` and `remove_token`
([document 6](06-assets.md)).

## C4. Deployment

- `scripts/contracts/deploy-v2/config.ts` gains a set `v3`: Core, NFT and one
  Tab for XLM's Stellar Asset Contract (`max_balance` 10,000 XLM,
  `min_deposit` 1 XLM), the integration set's roles, and a new acceptor key.
  A2 adds further Tab instances with the same script (a `deploy-tab` step
  that takes the token's contract id).
- `lib/stellar/v2/bindings/tab` and `core` are regenerated
  (`scripts/contracts/bindings.ts`).
- The deploy writes `CHAIN_EPOCH=testnet-v3-<yyyy-mm-dd>` and the contract
  ids into the evidence file; `stepConvexEnv` prints the Convex env for P7.
- The v3 integration backend is a new Convex deployment, not the v2
  integration backend.

## C5. Tests

Extend the v2 Rust suites (`contracts/tab/src/test/*`):

- `settle.rs`: payout to writers not in `hold`; `Claimable` for writers in
  `hold`; several vouchers to one writer make one transfer; a payee transfer
  that traps (credit asset without trustline) fails the call; the fee goes to
  the treasury's `Claimable`; `settle_own` pays the caller.
- `edge.rs`: `withdraw_now` with a wrong nonce, an expired or too-long
  attestation, an unknown acceptor, an amount above the balance, while
  paused; nonce replay; the delayed path still works after an instant
  withdrawal.
- `vectors.rs`: the `WithdrawPayload` vector added to the existing vectors,
  written to `contracts/tab/test-vectors/v3.json` for the TypeScript tests
  (P5).
- `resource.rs`: the worst case with payouts (32 vouchers, 32 distinct
  writers, none held) within the limits the SDK enforces; if it does not
  fit, lower `MAX_SETTLE_BATCH`. (Measured on testnet for v2 `settle` at 32
  vouchers: 48.0M instructions, 49 write entries, 33.8 KB.)
- `props.rs`: the sum of balances, claimables and payouts equals deposits
  minus withdrawals.
- Core: `set_token` accepts a 16th token and refuses a 17th.
