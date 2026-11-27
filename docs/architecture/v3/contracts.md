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
   `now ≤ valid_until ≤ now + MAX_WITHDRAW_ATTESTATION` (120 ledgers, about 10 minutes)
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
only when `amount ≤ readerSpendable(account) − tipOnly`. It
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
- Settler (P2): a payee that fails in simulation is found by bisection and
  held; a payee that fails on chain leaves the batch `FAILED` with nothing
  moved and is held for 24 h.

## C6. Security review of the changes

The coordinator's review asked for three things: every v2 invariant
([07 Security](../v2/07-security-and-recovery.md)) that the changes touch,
the payout failure mode, and what an acceptor key compromise now allows. The
multi-token Tab of the first draft is not in the set (C1), so it touches no
invariant.

### Invariants touched

| Invariant                        | Change that touches it            | How it still holds                                                                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-10 Conservation                | Payout; `withdraw_now`            | A paid writer's net leaves the contract in the same call that settles it and is never added to `Claimable`; `withdraw_now` lowers the balance by exactly the amount it transfers. Token balance = Σ balances + Σ `Claimable` after every call. `props.rs` checks it (C5). |
| I-12 Settlement cap              | None                              | The spend limit and `min(delta, balance, headroom)` are unchanged.                                                                                                                                                                                                        |
| I-13 Fee and net destination     | Payout                            | Restated: `fee` (cumulative rule, I-31) to `Claimable(treasury)`; `gross − fee` to the writer, as a transfer when the writer is not in `hold`, else to `Claimable(writer)`. The amounts are unchanged; only the destination of the net changes.                           |
| I-16 Delayed withdrawal          | `withdraw_now` adds a second exit | The delayed path is unchanged. New I-16b: `withdraw_now` pays at most the balance, only to the reader, only with the reader's auth and an unexpired acceptor attestation for this reader, amount and current nonce; each nonce succeeds once.                             |
| I-14 Voucher binding             | None                              | Voucher payloads are unchanged. New I-14b: the withdraw payload binds its own domain, the network, the Tab contract, the reader, the amount, the nonce and the expiry, so no voucher or acceptance signature verifies as an attestation.                                  |
| I-18 `settle_own`                | Pays the caller directly          | Still requires a valid acceptance from `acceptor_keys` and only for the calling writer; the payment goes only to the caller.                                                                                                                                              |
| I-22 Acceptance                  | Convex side of `withdraw_now`     | The balance rule becomes `amount ≤ readerSpendable(account)`, which subtracts `outstanding` and `withdrawReserved` from `confirmedBalance`, so an attested withdrawal can never take funds an accepted voucher needs.                                                     |
| I-25 TTL                         | New `WithdrawNonce`               | Extended on every write like other persistent entries.                                                                                                                                                                                                                    |
| I-27 Pause never blocks exits    | `withdraw_now`                    | Added to the list of calls pause never blocks.                                                                                                                                                                                                                            |
| I-28 Accounts never removed      | `withdraw_now`                    | A zero balance keeps the entry; `WithdrawNonce` never decreases, including across `migrate`.                                                                                                                                                                              |
| I-29 Session and `Paid` lifetime | 90 day keys                       | Entries still live until `valid_until + SETTLE_GRACE` (at most 97 days); P1 checks this is inside the network's maximum entry lifetime, or lowers `MAX_KEY_LIFETIME`.                                                                                                     |
| I-11, I-15, I-17, I-31           | None                              | Unchanged code paths.                                                                                                                                                                                                                                                     |

### A payout that fails inside `settle`

A Soroban call is atomic: if one transfer to a writer fails, the whole
`settle` call fails and nothing in it applies. That is why a failing payee
cannot block the batch:

1. **Before sending**, the settler simulates. A simulation that fails while
   `hold` is empty is simulated again with every writer in `hold`. If that
   passes, the run bisects the payee set (at most 5 more simulations for 32
   writers, inside `MAX_SIMULATIONS`) and puts the failing writers in `hold`.
   The batch settles; held writers are credited to `Claimable`.
2. **Causes covered:** a classic account without a trustline for a credit
   asset (`TrustlineMissingError`), a trustline the issuer deauthorised, and
   a non-SAC token whose `transfer` refuses the recipient. A Stellar Asset
   Contract transfer to a contract address calls no code in the recipient, so
   a contract account cannot refuse a SAC payout.
3. **If the state changes between simulation and inclusion** (the writer
   removes the trustline in that window), the transaction fails on chain:
   v2's rule applies, the settlement is `FAILED`, nothing moves, and the pairs
   return to `ready`. The writer gets `payoutHoldUntil = now + 24 h`, so the
   next run holds them without a failing attempt. One failed transaction per
   such writer per day is the worst case.
4. Held amounts stay claimable by the writer at any time (`claim`), and the
   settler retries held writers hourly when simulation shows a payout would
   succeed (03, section 3.5).

### Acceptor key compromise

Before (v2): the acceptor key only countersigns vouchers a reader also
signed; it cannot move funds alone (v2 threat table, "Tab acceptor key").

With `withdraw_now`:

- **Still impossible:** taking anyone's funds. `withdraw_now` needs the
  reader's own auth and pays only the reader. An attacker with the key and no
  reader's cooperation gains nothing.
- **Newly possible:** a reader who holds the leaked key, or colludes with
  whoever does, can withdraw their whole balance at once while vouchers that
  Convex accepted are not yet settled. Those vouchers then settle as
  `SHORTFALL`, and the writers lose earnings the app already showed as
  pending. In v2 the 3 day delay gave the settler time to settle first.
- **Bound:** the reader's accepted and unsettled amount, which the fast
  settler keeps to about the last 15 to 60 s of that reader's tips, and the
  cent limits (at most $100 accepted per reader per day).
- **Response:** the runbook below. Pause does not help, because exits are
  never paused (I-27).

### Detection signals

Convex records every attestation it signs (`withdrawAttestations`:
reader, Tab, nonce, amount, `validUntil`, signed at). A legitimate instant
withdrawal can never cause a shortfall, because its amount is at most
`readerSpendable`. So each of these is evidence of a leaked acceptor key:

| Signal                                                                                                                                                | Seen by                                  | Alert code                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------- |
| A `WithdrawnNow` whose `(reader, nonce)` has no `withdrawAttestations` row, or whose amount differs from the attested amount                          | Indexer, `WithdrawnNow` handler          | `TAB_UNRESERVED_WITHDRAWAL`      |
| A `VoucherSkipped` with reason `SHORTFALL` (in the settler's own result or indexed) for a reader with a `WithdrawnNow` after the voucher's acceptance | Settler (`finishSettlement`) and indexer | `TAB_SHORTFALL_AFTER_WITHDRAWAL` |
| A `settle_own` (`TabSettled` with `by_writer: true`) for a voucher Convex never countersigned under the current or previous acceptor key              | Indexer                                  | `TAB_UNKNOWN_ACCEPTANCE`         |

Each alert is a `console.error` JSON line like the v2 settler alerts, and
sets `chainConfig.acceptorSuspect = true`, which makes acceptance refuse new
balance tips (`BALANCE_PAUSED`) until an operator clears it. Exits and
settlement continue.

### Runbook: acceptor key compromise

Run from the repository root with the v3 set's Stellar CLI identities
(`--keys-dir/<set>` of the deploy, here `$KEYS_DIR/v3`), the testnet guard
variables of the deploy script, and the v3 Tab's id in `$TAB_ID`. Each
command targets only the v3 Tab (D9 rule: no v2 contract).

1. Make a fresh acceptor key and read its raw public key:

   ```bash
   stellar keys generate qt-v2-v3-acceptor-r1 --config-dir "$KEYS_DIR/v3"
   ```

   ```bash
   ACCEPTOR_HEX=$(ADDR=$(stellar keys public-key qt-v2-v3-acceptor-r1 --config-dir "$KEYS_DIR/v3") bun -e "import { StrKey } from '@stellar/stellar-sdk'; console.log(Buffer.from(StrKey.decodeEd25519PublicKey(process.env.ADDR)).toString('hex'))")
   ```

2. Point Convex at the new key first. Acceptance then refuses until the Tab
   lists the key (`TAB_ACCEPTOR_MISMATCH`), which is the safe order. Set the
   value through the Convex dashboard's environment page for the v3
   integration deployment (variable `TAB_ACCEPTOR_SECRET`, value from
   `stellar keys show qt-v2-v3-acceptor-r1 --config-dir "$KEYS_DIR/v3"`), so
   the secret is not in shell history.
3. Rotate twice with the same new key, so the list becomes `[new, new]` and
   the leaked key is gone:

   ```bash
   stellar contract invoke --id "$TAB_ID" --source qt-v2-v3-admin --config-dir "$KEYS_DIR/v3" --network testnet -- set_acceptor --public_key "$ACCEPTOR_HEX"
   ```

   ```bash
   stellar contract invoke --id "$TAB_ID" --source qt-v2-v3-admin --config-dir "$KEYS_DIR/v3" --network testnet -- set_acceptor --public_key "$ACCEPTOR_HEX"
   ```

4. Confirm the list and refresh the cached config:

   ```bash
   stellar contract invoke --id "$TAB_ID" --source qt-v2-v3-admin --config-dir "$KEYS_DIR/v3" --network testnet --send no -- config
   ```

   ```bash
   CONVEX_DEPLOYMENT=<v3 integration deployment> npx convex run chain/config:refreshChainConfig
   ```

5. Re-sign the acceptance of every open latest voucher with the new key
   (`internal.tabs.resignAcceptances`, P5), so writers keep their `settle_own`
   recourse. `settle` ignores acceptances, so settlement continued throughout.
6. Clear `chainConfig.acceptorSuspect` (`internal.chain.config.clearAcceptorSuspect`,
   P5) once the alerts stop, and record the transaction hashes in the
   deployment evidence.
7. For each `TAB_SHORTFALL_AFTER_WITHDRAWAL`, list the affected writers' `not
paid` amounts in the incident note. On testnet nothing is refunded.

- **Mainnet:** the acceptor key moves to a KMS, as v2 already requires.
