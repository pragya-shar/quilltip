# C. Contract changes

One v3 contract set is deployed once on testnet with
`scripts/contracts/deploy-v2-testnet.ts` (a new set, section C4). It starts a
new `CHAIN_EPOCH`. Everything below is decided so that the app's later
packages (assets, passkeys, agents) need no second redeploy.

## C1. Summary

| Contract    | Change                                                                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab         | Multi-token balances; direct payout in `settle`; no per-key spend limit; 90 day keys; instant withdrawal countersigned by the acceptor; v3 signing domains                                      |
| Core        | `MAX_TOKENS` 4 → 16. No other change                                                                                                                                                            |
| Article NFT | No change; redeployed with the set because it is bound to the Core address                                                                                                                      |
| Shared      | `TAB_DOMAIN = "quilltip_tab_v3"`, `TAB_ACCEPT_DOMAIN = "quilltip_tab_accept_v3"`, new `TAB_WITHDRAW_DOMAIN = "quilltip_tab_withdraw_v3"`; `VoucherPayload` gains `token`; new `WithdrawPayload` |

## C2. Tab

### Storage

| Key                                   | Kind       | Value                                               | v2                                 |
| ------------------------------------- | ---------- | --------------------------------------------------- | ---------------------------------- |
| `Config`                              | instance   | `{ treasury, acceptor_keys }`                       | also held `token`, limits          |
| `Token(token)`                        | persistent | `TokenConfig { max_balance, min_deposit, enabled }` | new (limits were global)           |
| `Tokens`                              | instance   | `Vec<Address>`, at most `MAX_TOKENS = 8`            | new                                |
| `Reader(reader)`                      | persistent | `{ next_key_id, withdraw_nonce }`                   | part of `Account`                  |
| `Account(reader, token)`              | persistent | `{ balance, withdraw_unlock }`                      | `Account(reader)` with key counter |
| `Session(reader, key_id)`             | temporary  | `{ public_key, valid_until, revoked }`              | also `spend_limit`, `spent`        |
| `Paid(reader, key_id, writer, token)` | temporary  | `i128`                                              | no `token`                         |
| `Claimable(owner, token)`             | persistent | `i128`                                              | no `token`                         |

Constants: `MAX_KEY_LIFETIME = 90 × DAY`, `SETTLE_GRACE = 7 × DAY`,
`WITHDRAW_DELAY = 3 × DAY` (fallback path only), `MAX_SETTLE_BATCH = 32`
(subject to the resource test, C5), `MAX_ACCEPTOR_KEYS = 2`,
`MAX_WITHDRAW_ATTESTATION = 720` ledgers (1 hour). Temporary entries live
until `valid_until + SETTLE_GRACE`, at most 97 days, inside the network's
maximum entry lifetime; P1 checks it against the testnet config.

### Entry points

```rust
// Reader
fn deposit(reader: Address, token: Address, amount: i128);
fn open_session(reader: Address, token: Address, amount: i128,
                public_key: BytesN<32>, valid_until: u32) -> u32;
fn register_key(reader: Address, public_key: BytesN<32>, valid_until: u32) -> u32;
fn revoke_key(reader: Address, key_id: u32);
fn withdraw_now(reader: Address, token: Address, amount: i128, nonce: u64,
                valid_until: u32, acceptor: BytesN<32>, signature: BytesN<64>) -> i128;
fn withdraw_start(reader: Address, token: Address);   // fallback, 3 day delay
fn withdraw(reader: Address, token: Address) -> i128; // fallback

// Settlement
fn settle(settler: Address, vouchers: Vec<Voucher>, hold: Vec<Address>) -> SettleSummary;
fn settle_own(writer: Address, vouchers: Vec<Voucher>) -> SettleSummary; // pays the writer
fn claim(recipient: Address, token: Address) -> i128;

// Views
fn account(reader: Address, token: Address) -> Option<ReaderAccount>;
fn reader(reader: Address) -> Option<ReaderState>;
fn session_key(reader: Address, key_id: u32) -> Option<SessionKey>;
fn paid(reader: Address, key_id: u32, writer: Address, token: Address) -> i128;
fn claimable(owner: Address, token: Address) -> i128;
fn token_config(token: Address) -> Option<TokenConfig>;
fn voucher_payload(reader: Address, writer: Address, token: Address, key_id: u32,
                   cumulative: i128, receipts_root: BytesN<32>) -> Bytes;
fn withdraw_payload(reader: Address, token: Address, amount: i128, nonce: u64,
                    valid_until: u32) -> Bytes;

// Administration (admin unless noted)
fn set_token(token: Address, max_balance: i128, min_deposit: i128, enabled: bool);
fn set_treasury(treasury: Address);
fn set_acceptor(public_key: BytesN<32>);
// pause / unpause / upgrade / migrate / roles: unchanged from v2
```

`Voucher` gains `token: Address` after `writer`. The constructor takes
`(admin, pauser, upgrader, settler, treasury, acceptor_key, tokens: Vec<TokenInit>)`
where `TokenInit { token, max_balance, min_deposit }`.

### Rules that change

1. **Deposits** check the token's `TokenConfig` (`enabled`, `min_deposit`,
   `max_balance` per reader and token). A disabled token takes no deposit;
   its existing balances still settle and withdraw.
2. **No spend limit.** `settle_batch` computes
   `gross = min(cumulative − paid, account.balance)`. `Session` is not written
   during settlement. The bounds on a misused key are the settler role, the
   acceptance rules in Convex and the reader's balance.
3. **Payout.** `settle` accumulates `net` per `(writer, token)` in a map. At
   the end, for each writer not in `hold`, it transfers the sum from the
   contract to the writer and publishes `PaidOut { writer, token, amount }`;
   for each writer in `hold`, it adds the sum to `Claimable(writer, token)`.
   `settle_own` always pays the caller directly. The treasury fee goes to
   `Claimable(treasury, token)`.
4. **Instant withdrawal.** `withdraw_now` requires `reader.require_auth()`,
   an acceptor key in `acceptor_keys`, a valid ed25519 signature over
   `WithdrawPayload { domain, contract, network_id, reader, token, amount, nonce, valid_until }`,
   `nonce == Reader.withdraw_nonce`, `now ≤ valid_until ≤ now + MAX_WITHDRAW_ATTESTATION`,
   and `0 < amount ≤ balance`. It increments the nonce, lowers the balance,
   transfers, and publishes `WithdrawnNow`. It works while paused, like
   `withdraw` (v2 I-27). The delayed `withdraw_start` and `withdraw` stay so
   a reader can always leave without Convex.
5. **Keys** are per reader, not per token: one device key tips in every token.
6. **Signing domains** are v3, so no v2 signature verifies against v3.

### Events

`Deposited`, `WithdrawStarted`, `WithdrawCancelled`, `Withdrawn`,
`Claimed`, `TabSettled` and `VoucherSkipped` gain `token`. `TabSettled` gains
`paid_out: bool`. `KeyRegistered` loses `spend_limit`. New: `PaidOut`,
`WithdrawnNow`, `TokenSet`. The indexer's Tab handlers
(`convex/lib/chain/tabEventHandlers.ts`) and the event decoders follow the
new shapes in P5.

### Convex side of the instant withdrawal

`balance.prepareWithdraw({ token, amountBaseUnits })` signs the attestation
only when `amount ≤ confirmedBalance − outstanding − reserved`. It sets
`tabAccounts.withdrawReserved = { amount, nonce, validUntil }`, which
acceptance subtracts from `available` until the `WithdrawnNow` event lands
or `validUntil` passes. The reservation is at most `available`, so after the
withdrawal the balance still covers every accepted voucher, and settlement
needs no change while a reservation is live.

## C3. Core

`MAX_TOKENS` rises from 4 to 16 (`contracts/core/src/storage.rs`), so the
allowlist can hold the registry ([document 6](06-assets.md)). `tip`,
`tip_batch`, splits, the fee and `client_ref` are unchanged. The token list
is administered with the existing `set_token` and `remove_token`.

## C4. Deployment

- `scripts/contracts/deploy-v2/config.ts` gains a set `v3` with the new
  constructor arguments: XLM's Stellar Asset Contract as the only token at
  deploy (`max_balance` 10,000 XLM, `min_deposit` 1 XLM), the same roles as
  the integration set, and a new acceptor key.
- `lib/stellar/v2/bindings/tab` is regenerated (`scripts/contracts/bindings.ts`).
- The deploy writes `CHAIN_EPOCH=testnet-v3-<yyyy-mm-dd>` and the contract ids
  into the evidence file; `stepConvexEnv` prints the Convex env for P7.
- A v3 Convex deployment for integration is a new deployment, not the v2
  integration backend.

## C5. Tests

Extend the v2 Rust suites (`contracts/tab/src/test/*`):

- `reader.rs`: deposits per token, caps per token, disabled token refuses
  deposits but settles, one key for two tokens.
- `settle.rs`: payout to writers not in `hold`, `Claimable` for writers in
  `hold`, aggregation of several vouchers to one writer, a payee transfer that
  traps (asset without trustline) fails the call so the settler can hold it,
  fee to treasury per token, no `Session` write.
- `edge.rs`: `withdraw_now` with a wrong nonce, an expired or too-long
  attestation, an unknown acceptor, an amount above the balance, while
  paused; nonce replay; the delayed path still works.
- `vectors.rs`: v3 voucher, acceptance and withdraw payload vectors written to
  `contracts/tab/test-vectors/v3.json`, consumed by the TypeScript encoder
  tests (P5).
- `resource.rs`: the worst case with payouts (32 vouchers, 32 distinct
  writers, none held) within the limits; if not, lower `MAX_SETTLE_BATCH`.
- `props.rs`: the cumulative fee invariant per `(pair, token)`; the sum of
  balances, claimables and payouts equals deposits minus withdrawals per token.
