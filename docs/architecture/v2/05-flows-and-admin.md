# 5. Flows and administration

[Index](../v2-spec.md)

Actors:

- **C**: client (browser).
- **W**: the user's wallet, through Stellar Wallets Kit.
- **X**: Convex.
- **S**: Stellar testnet, through RPC.

"Submit and verify" refers to the lifecycle in
[section 6.1](06-app-integration.md#61-transaction-lifecycle).

## 5.1 Article registration (enables tips)

1. **C:** The author publishes. **X** `articles.publishArticle` stores the article and computes `content_hash` from `canonicalArticleBytes` ([section 1.4](01-architecture.md#canonical-article-bytes)).
   - If Arweave upload is enabled, the upload body is the same bytes.
   - **X** stores `arweave_id` once the upload completes.
2. **C:** After publish, the editor shows "Enable tips" when the article has no registration. **C** calls **X** `chainArticles.prepareRegistration(articleId)`. It returns `{article_id, content_hash, arweave_id, splits, contractId, clientRef}` and creates a `chainSubmissions` row (`kind: register`, status `PREPARED`).
3. **C:** Builds `Core.register_article(author, …)` with the generated bindings, then simulates. **W** signs.
4. **C:** Sends the transaction. **X** `chainSubmissions.recordSubmitted(id, txHash, envelopeXdr)`.
5. **X:** The verifier polls `getTransaction`. It requires `SUCCESS` and an `ArticleRegistered` event whose `article_id`, `author` and `content_hash` equal the prepared values. It then sets `chainArticles.status = REGISTERED`.
6. **Gate:** tip buttons for an article stay disabled until step 5. The indexer reconciles the same event ([section 6.5](06-app-integration.md#65-event-indexer)).

**Content changes** follow the same sequence with `Core.update_content`.

**A wallet change** takes two transactions, and each one is signed by a single
wallet:

1. The old address signs `Core.propose_author(article_id, new, live_until)`.
2. The new address signs `Core.accept_author(article_id)`.

Any wallet that can sign a transaction envelope can do this, so `signAuthEntry`
is not needed.

## 5.2 Direct article tip

1. **C → X:** `tipsV2.prepareDirectTip({articleId, amountCents, highlight?: null})`. **X**:
   1. Checks auth, `chainArticles.REGISTERED`, a linked wallet, and that the tipper is not a recipient.
   2. Reads `min_tip(token)` from the cached Core config.
   3. Converts cents to stroops with the price quote (existing `xlmPrice`) and rejects amounts under the minimum.
   4. Generates `client_ref`.
   5. Inserts a `tips` row (`status: PREPARED`, `contractVersion: 'v2'`, expected fields, and `maxTime = server now + 300 s`). The record's expiry follows the rule in [section 6.1](06-app-integration.md#61-transaction-lifecycle), not a fixed clock.
2. **C:** Builds `Core.tip(tipper, article_id, token, amount, None, client_ref)` with time bounds `[0, maxTime]`, simulates, and **W** signs.
3. **C:** Sends the transaction. **X** `tipsV2.recordSubmitted(tipId, txHash)` moves the row to `SUBMITTED`. A `(txHash, clientRef)` pair is accepted once only.
4. **X** (scheduled action) verifies:
   1. `getTransaction` returns `SUCCESS`.
   2. Decode the `Tipped` event of contract `CORE_CONTRACT_ID`.
   3. Compare the payment fields: `article_id`, `tipper`, `token`, `gross`, `client_ref` and `highlight_id`, plus `fee == floor(gross × 250 / 10,000)`.
   4. If they all match: when `author` equals the expected author, set `CONFIRMED`. Otherwise set `MISMATCH`, because the money went to the author registered on chain.
   5. Record `content_hash` and `content_version` from the event for display. They are not matched.
   6. Store `ledger`, `feeCharged` and `eventId`.
5. **C:** Shows success when **X** reports `CONFIRMED`.
   - For `MISMATCH` it shows "Tip sent to the article's registered payout address" and never offers a retry.
   - Until a final state, it shows "Confirming".

## 5.3 Highlight tip

Same as 5.2, with these differences:

- `highlight` is `{text, startOffset, endOffset, containerPaths}`.
- **X** derives `highlight_id` (32-byte digest) and stores the legacy 28-hex prefix for display joins.
- The row goes into `highlightTips`.
- The verifier also requires the event `highlight_id` to equal the expected value.

## 5.4 Batch tip (tip basket)

1. **C:** The reader adds up to 10 tips (article or highlight) to a basket. The total transfer count is limited to 24 ([section 2.2](02-core-contract.md#tipping)).
2. **C → X:** `tipsV2.prepareBatch(items)` creates one row per item (each with its own `client_ref`) and a `chainSubmissions` row (`kind: tip_batch`) linking them.
3. **C:** Builds `Core.tip_batch(tipper, token, items)`, simulates, **W** signs once, and sends.
4. **X:** The verifier matches each `Tipped` event to its row by `client_ref`.
   - All rows share one transaction hash, linked through the `chainSubmissions` row. Deduplication uses `(txHash, clientRef)`.
   - All rows confirm or fail together, because the batch is atomic.

## 5.5 Tab open and top-up

1. **C:** The reader chooses "Prepay for quick tips" with an amount (testnet default 10 XLM).
2. **C:** Generates a session key ([section 3.5](03-tab-contract.md#35-session-keys)) and keeps the private key local.
3. **C → X:** `tabs.prepareOpen({amount, publicKey, validUntil, spendLimit})` checks the limits and creates `tabAccounts` (if new) and `chainSubmissions` (`kind: tab_open`).
4. **C:** Builds `Tab.open_session(reader, amount, public_key, valid_until, spend_limit)`, simulates, **W** signs, and sends.
5. **X:** Verifies `Deposited` and `KeyRegistered` (reader, amount, public key). It records `tabSessionKeys` with the on-chain `key_id` and sets the tab to `OPEN` with the confirmed balance.
6. **Top-up:** `Tab.deposit`, same steps without the key.
7. **New key:** `Tab.register_key`, same steps without the deposit.

## 5.6 Tab tip

1. **C → X:** `tabs.prepareTip({articleId, amountCents, keyId, highlight?})`. The client names the key it will sign with. **X**:
   1. Checks the same eligibility as 5.2.
   2. Checks that the article has no co-author splits.
   3. Checks the key belongs to this reader, is not revoked, and `now + 1 day < valid_until`.
   4. Checks `amount <= confirmedBalance - outstanding` and `spent + outstanding + amount <= spend_limit`.
   5. Checks the Convex limits ([section 3.5](03-tab-contract.md#35-session-keys)) and the per-pair receipt cap.
   6. Checks the tab is not closing.
   7. Returns `{writer, key_id, seq, cumulative_before, amount, receipt fields, leafHashes[]}` for the pair `(reader, key_id, writer)`.
2. **C:** Checks the response against its local ledger for `(key_id, writer)`:
   - **If a local record exists:** `cumulative_before` and `leafHashes` MUST equal the local values.
   - **If none exists:** `cumulative_before` MUST be 0 and `leafHashes` MUST be empty.
   - **On a mismatch:** the client re-reads the local ledger, which another browser tab may have updated, and prepares once more. If they still differ, it stops, reports, and does not use the key again.

   Then it:
   1. Builds the `TipReceipt`.
   2. Computes the new root from `leafHashes` plus the new leaf.
   3. Builds the `VoucherPayload` bytes.
   4. Signs them with the session key. There is no wallet prompt.

3. **C → X:** `tabs.submitTip({prepareId, receipt, signature})`. In one mutation **X**:
   1. Recomputes the payload and root.
   2. Verifies the ed25519 signature against the stored public key.
   3. Re-checks the balance, limit, key and sequence. Any concurrent change makes the mutation fail, and the client retries from step 1.
   4. Signs the acceptance (`AcceptancePayload`) with the acceptor key.
   5. Stores the `tabReceipts` row and the new `tabVouchers` latest value, including the leaf hashes and the acceptance.
   6. Marks the tip row `ACCEPTED` (`channel: 'tab'`).
4. **C:** Appends the receipt leaf and the new cumulative to its local ledger. It shows the tip as sent and "settles on Stellar soon".
5. **Writer:** The receipt shows as pending on the writer's dashboard. The dashboard stores the latest countersigned voucher in the writer's browser and offers a JSON download for `settle_own` ([section 3.7](03-tab-contract.md#37-liveness-and-disputes)).

## 5.7 Settlement

1. **X** cron `tabs.settleDue` (every 10 minutes, testnet) selects due vouchers ([section 3.8](03-tab-contract.md#38-settlement-policy-convex-settler)), up to 32.
2. **X:** The settler action (Node runtime) does the following:
   1. Takes the single-flight lease.
   2. Calls `assertBackendTestnet()` and requires `SETTLEMENT_ENABLED=true`. It does **not** use `assertNonProductionBackend`, which refuses the live deployment by design. Settlement runs wherever tab tips are accepted, the live testnet deployment included.
   3. Loads `TAB_SETTLER_SECRET`.
   4. Runs the pre-checks in [section 3.2](03-tab-contract.md#settlement).
   5. Builds `Tab.settle(settler, vouchers)`.
   6. Simulates, bisecting on failure.
   7. Signs with the settler key, sends and polls.
3. **X:** For each voucher, read `TabSettled` (set receipts with `cumulative_after <= paid_after` to `SETTLED`) or `VoucherSkipped` (record the reason). The rules for each reason are in [section 7.4](07-security-and-recovery.md#74-failure-recovery).
4. **Relayer later:** the action calls a `SettlementSubmitter` interface. Two implementations exist: `localKey` (testnet) and `relayer(url, apiKey)`, which sends the unsigned invocation to a hosted relayer. The relayer's account must hold the `settler` role.

## 5.8 Claim

1. **C:** The writer dashboard shows `claimable(writer)`, read through **X** from Core or Tab views and events. The writer presses "Collect".
2. **C:** Builds `Tab.claim(writer)`. Anyone can submit it. The writer signs as the transaction source, or the settler submits a batch of claims for writers who opt into automatic payout.
3. **X:** Verifies the `Claimed` event and updates the earnings view.

## 5.9 Withdrawal

1. **C:** The reader chooses "Close tab". **W** signs `Tab.withdraw_start(reader)`.
2. **X:** On verifying `WithdrawStarted`, it marks the tab `CLOSING`, stops accepting tab tips, and the settler settles every pair of this reader first.
3. **C:** After `unlock_ledger` (about 3 days), the reader signs `Tab.withdraw(reader)`. **X** verifies `Withdrawn` and marks the tab `CLOSED`.
4. A deposit during `CLOSING` cancels the withdrawal (`WithdrawCancelled`). The tab returns to `OPEN`.

## 5.10 NFT mint and transfer

1. **C:** The dashboard shows "Mint article NFT" when `Core.article_total(article_id, threshold_token) >= threshold`. The values are read live through **X**.
2. **C:** Builds `Nft.mint(article_id)`, simulates, the author signs (**W**), and sends.
3. **X:** Verifies `ArticleNftMinted` (article, author) and records `articleNFTs` with `tokenId`, `contractAddress`, `txHash`.
4. **Transfer:**
   1. **C** builds `Nft.transfer(from, to, token_id)`. `to` is a Stellar address, or a QuillTip user's linked address resolved by **X**.
   2. **W** signs and sends.
   3. **X** verifies the OpenZeppelin `transfer` event and updates `currentOwner`.

   **X** never changes ownership without a verified event.

## 5.11 Roles and administration

| Role / key | Holds                                                | Testnet custody                                                                                                                                                                      | Mainnet custody (later)                                                            |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Deployer   | Pays deployment only                                 | Operator's Stellar CLI identity. Unused after deploy.                                                                                                                                | Separate key, unused after deploy                                                  |
| Admin      | OpenZeppelin admin on all three contracts            | One testnet key in the Stellar CLI keystore on the operator machine                                                                                                                  | 2-of-3 classic multisig account; keys on hardware wallets held by different people |
| `pauser`   | Pause on all three contracts                         | Same testnet key as admin, or a second CLI identity                                                                                                                                  | Single fast key, separate from admin                                               |
| `upgrader` | Upgrade and migrate                                  | Admin key                                                                                                                                                                            | OpenZeppelin timelock contract controlled by the multisig                          |
| `settler`  | `Tab.settle`                                         | `TAB_SETTLER_SECRET` in the Convex deployment that accepts tab tips, behind `assertBackendTestnet()` and `SETTLEMENT_ENABLED`. On the live deployment, the owner sets it at cutover. | Hosted relayer account, or a KMS-backed key. Never a plain env secret.             |
| Acceptor   | Countersigns accepted vouchers (Tab `acceptor_keys`) | `TAB_ACCEPTOR_SECRET` in the same deployment, under the same rules as the settler                                                                                                    | KMS-backed key                                                                     |
| Treasury   | Receives fees                                        | Testnet account controlled by the operator                                                                                                                                           | 2-of-3 multisig account                                                            |

**Operations:**

1. **Admin transfer:** `transfer_admin_role(new_admin, live_until_ledger)` by the current admin, then `accept_admin_transfer` by the new admin before `live_until_ledger`.
2. **Grant or revoke a role:** OpenZeppelin `grant_role` or `revoke_role` by the admin. Moving settlement to a relayer means `grant_role(relayer, "settler")`, then `revoke_role(old, "settler")`.
3. **Pause** (incident): `pauser` calls `pause` on the affected contract or contracts. The pause scope is in [section 1.5](01-architecture.md#15-shared-conventions). Unpause needs the admin.
4. **Tab settlement defect** (incident):
   1. Revoke the `settler` role.
   2. Call `set_acceptor` twice with fresh keys, so neither old acceptor key stays valid. Both settlement paths now stop for new vouchers.
   3. Upgrade.
   4. Restore the role and keys.

   Exits stay open throughout (I-27).

5. **Upgrade:**
   1. Build from a tagged commit.
   2. Upload the Wasm.
   3. Run `upgrade(hash)`. When the layout change needs a migration, use the upgrader contract so that `migrate()` runs in the same transaction ([section 1.5](01-architecture.md#15-shared-conventions)).
   4. Verify `schema_version`.
   5. Record the hash and transaction IDs in the deployment evidence ([section 8.4](08-testing-and-deployment.md#84-testnet-deployment-procedure)).
   6. On mainnet, the upgrade is scheduled through the timelock, whose minimum delay exceeds `WITHDRAW_DELAY + 2 days`.
6. **Fee:** no operation exists. `FEE_BPS` is a constant, so changing it needs a reviewed upgrade.
   **Role scope.** The `pauser` role MUST NOT be made the role admin of
   `settler`. Only the admin grants or revokes `settler`. A settler can submit
   vouchers without going through the Convex limits, so letting the pauser assign
   the role would widen the pauser's power.

7. **Settler key rotation:**
   1. Grant `settler` to the new key.
   2. Update the Convex env.
   3. Revoke the old key.
   4. Confirm one settlement with the new key.
8. **Acceptor key rotation:**
   1. `set_acceptor(new)` keeps the previous key valid.
   2. Update `TAB_ACCEPTOR_SECRET`.
   3. Re-sign the acceptance of every open latest voucher with the new key.
   4. To drop the previous key after 7 days, call `set_acceptor(new)` again. The list becomes `[new, new]`.
