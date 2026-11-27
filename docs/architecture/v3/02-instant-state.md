# 2. Instant state

The reader's balance and activity and the writer's earnings change when
Convex accepts a signed voucher. The chain catches up in the background, and
the screens reconcile without a visible wait.

## 2.1 Where state comes from today

v2 already writes most of what the screens need in the accepting mutation.
`submitTabTip` (`convex/lib/chain/tabLedger.ts`) updates, in one transaction:

| Write                                            | Read by (reactive Convex query)                                |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `tabAccounts.outstanding` (+ amount)             | `tabs.getMyTab` → `available = confirmedBalance − outstanding` |
| `tabReceipts` insert, status `ACCEPTED`          | `tabActivity.getMyTabTips` (reader's recent tips)              |
| `tabVouchers.cumulative`, `pendingNet`           | `tabs.getWriterPending`, `tabActivity.getMyTabEarnings`        |
| `authorEarnings.pendingBaseUnits[token]` (+ net) | the writer's base-unit figures                                 |

So the reactive path for a balance tip exists. The waits a reader or writer
sees come from elsewhere:

| Wait                                                        | Cause in v2                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tip control shows "loading" on each page                    | Each tab surface (`TabTipActionLive`, `TabHomeLive`, `CollectPanelLive`) builds its own `TabServices` (`useLiveTabServices`) and, per mount, reads the device keys from IndexedDB and the latest ledger from Stellar RPC (`useLedgerClock`) before availability leaves `loading`. |
| Tip control asks to connect                                 | The access gate (`useLiveWalletAccess`) derives from the wallet runtime, which starts inactive on every page load and has no stored connection (section 4.1).                                                                                                                     |
| Two round trips per balance tip                             | `tabs.prepareTip` then `tabs.submitTip`.                                                                                                                                                                                                                                          |
| Deposit or new key visible after 30 to 45 s                 | `confirmedBalance` and key registration change only through indexed events; the indexer runs from a 1 minute cron.                                                                                                                                                                |
| Writer's dollar figure moves hours later                    | `authorEarnings` cents for a balance tip are credited at `SETTLED` (`setReceiptStatus`), which waited for the 6 hour or 5 XLM due rule.                                                                                                                                           |
| Wallet tip confirmed after seconds, earnings after a minute | `verifySubmission` backs off at 2, 4, 8 s; `authorEarnings` are credited by the 1 minute `syncV2TipEarnings` cron.                                                                                                                                                                |
| Collectable amount per page                                 | `CollectPanel` reads `Tab.claimable` from RPC on mount.                                                                                                                                                                                                                           |
| Balance and earnings exist only with a verified address     | Every tab query starts from `verifiedStellarAddress(user)`; a user without one, or with a changed address, sees nothing.                                                                                                                                                          |

## 2.2 Balance tips

### Client (no optimistic money)

The durable balance and the activity list change only when the server
accepts. `useTip` holds its own display state ("Sending $3") on the control
during the hold and while `balance.send` runs; `balance.session` and
`activity.mine` are never edited optimistically. With one mutation the
acceptance arrives about 100 to 300 ms after the hold ends, and Convex pushes
the new `balance.session` and `activity.mine` results to every open session
of the reader in the same update. A reload during `sending` shows the
outbox entry as "Sending" until its resubmission is answered
([section 1.9](01-tip-pipeline.md#19-idempotency)).

### Server (one mutation)

`balance.send` writes everything 2.1 lists, plus:

- The writer's running `pending` figure (+ the receipt's `writerCents` and
  net base units, section 2.6). The writer's total counts accepted tips.
- One `activity` row per side (section 2.5).

The writer's screens subscribe to `earnings.mine` and `activity.mine({ role: 'writer' })`;
Convex pushes the change to the writer's open sessions within about a second.

### Reconciliation

Settlement (document 3) applies each settled voucher with the v2 function
`applyPairSettlement`, from the settler's own transaction result, not from
the indexer. In the same mutation, v3:

- moves each settled receipt's `writerCents` and net from the writer's
  `pending` to `collected` when the writer was paid in the settlement
  transaction, or to `available` when the writer was in `hold`
  (section 2.6);
- sets the activity rows' status to `in-wallet` or `on-chain`.

The reader's spendable amount must not change at settlement:
`confirmedBalance` falls by the settled gross and `outstanding` by the same
amount. Today `outstanding` falls at the settler's result and
`confirmedBalance` only when the indexer applies `TabSettled`, so spendable
reads too high for one indexer cycle. That defect is fixed once, on
`overhaul/v2`, by the tab ledger's owner, and `overhaul/v3` takes the fix by
merge. v3 relies on its invariant: **spendable never rises between a
settlement result and its indexed event.** Every read model and
`checkTabTip` compute spendable with one exported helper,
`readerSpendable(account)` in `convex/lib/chain/tabLedger.ts`
([section 3.1](03-settlement.md#31-what-changes-from-v2)).

### Not paid

A receipt ends unpaid in three ways: the contract skips it as `SHORTFALL`
(nothing payable), as `KEY_EXPIRED` or `KEY_UNKNOWN` (v2 `UNPAID`), or the
settler rejects the voucher for review (`REJECTED`). Acceptance checks
`outstanding + amount ≤ confirmedBalance`, so a shortfall needs the chain
balance to fall without Convex knowing; with the v3 withdrawal paths
(contracts C2) it should not occur. The design still covers it:

| Side   | What changes                                                                                                                      | What the screen says                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Reader | `outstanding` releases the unpaid amount (v2 `closePair` and the `SHORTFALL` path do this); the activity item becomes `not-paid`. | "Not paid. $1 is back in your balance." on the item       |
| Writer | `pending` falls by the receipt's `writerCents` and net; the activity item becomes `not-paid`.                                     | The item is listed as "Not paid" with no amount in totals |

A `SHORTFALL` pair stays `blocked` as in v2 and settles after the next
deposit; its items return to `sent`.

## 2.3 Wallet tips

A wallet tip is final only when the server confirms the `Tipped` event. It
still shows at once:

1. When `tipsV2.recordSubmitted` stores the hash, it writes both activity rows
   with status `sending` and adds the writer's share to `pending`.
2. Verification (section 2.4) confirms in about 5 to 10 s. The confirming
   mutation moves the share from `pending` to `collected` (a Core tip pays the
   writer inside the tip transaction) and sets both rows to `in-wallet`.
3. `FAILED` or `EXPIRED` removes the share from `pending` and sets the
   reader's row to `failed`; the writer's row is removed.

The `syncV2TipEarnings` cron stays as a backstop for rows that a crash left
unapplied; each row is still credited once (`earningsAppliedAt`).

## 2.4 Transactions the app sends

Deposits, key registrations, withdrawals and wallet tips are transactions the
reader's wallet sends. v3 verifies each by hash at once and wakes the
indexer, instead of waiting for the next cron run:

- `balance.recordTransaction({ txHash, kind })` (deposits, keys, withdrawals)
  and `tipsV2.recordSubmitted` (tips) store the hash and schedule
  `chain.submissions.verifySubmission` with `runAfter(0)`.
- Verification polls RPC `getTransaction` at 1 s, then every 2 s until
  `maxTime + 10 min` (v2: 2, 4, 8 … 60 s). A ledger closes about every 5 s,
  so this confirms within one or two polls of the ledger.
- On `SUCCESS`, verification decodes the contract events from the
  transaction's result metadata and calls `chain.indexer.kick`. The kick
  schedules `pollEvents` at once ([section 3.7](03-settlement.md#37-indexer-cadence)),
  which applies the events through the v2 handlers, keyed by event id, so a
  later cron run applies nothing twice.

Target: a deposit is usable, and a wallet tip is confirmed, within 10 s of the
wallet's approval at p95.

## 2.5 Activity

v2 has one read model per surface (`getMyTabTips`, `useTipActivity` over
`tips` and `highlightTips`, `getWriterPending`). v3 adds one denormalised
table that both sides read, written by the same mutations that change a tip:

```ts
activity: defineTable({
  userId: v.id('users'), // whose list this row is in
  role: v.union(v.literal('reader'), v.literal('writer')),
  tipTable: v.union(v.literal('tips'), v.literal('highlightTips')),
  tipId: v.string(), // the tips or highlightTips row
  requestId: v.optional(v.string()),
  counterpartyId: v.optional(v.id('users')),
  articleId: v.id('articles'),
  passage: v.optional(v.string()), // first 140 characters
  amountCents: v.number(),
  token: v.string(),
  amountBaseUnits: v.string(),
  via: v.union(v.literal('balance'), v.literal('wallet'), v.literal('agent')),
  status: v.union(
    v.literal('sending'),
    v.literal('sent'),
    v.literal('on-chain'),
    v.literal('in-wallet'),
    v.literal('not-paid'),
    v.literal('failed')
  ),
  txHash: v.optional(v.string()),
  at: v.number(),
  updatedAt: v.number(),
})
  .index('by_user_role_at', ['userId', 'role', 'at'])
  .index('by_tip', ['tipTable', 'tipId'])
```

`activity.mine({ role, paginationOpts })` is a paginated query on
`by_user_role_at`. Titles, names and avatars are joined per page (at most
one page of rows). The status words map to the UI as: `sending` and `sent`
→ "Sent", `on-chain` and `in-wallet` → no badge (done), `not-paid` → "Not
paid", `failed` → "Failed".

A one-off backfill (`activity.backfill`, bounded batches) writes rows for
the current epoch's `tips`, `highlightTips` and `tabReceipts`, so history
does not start empty.

## 2.6 Earnings

A money label means exactly what it says at any history length. The writer
has three disjoint figures; their sum is the lifetime total of tips that did
not fail.

| Figure      | Meaning                                                                   | Moves in (same mutation as the receipt's state change)                                      |
| ----------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pending`   | Accepted balance tips and submitted wallet tips, not yet settled on chain | + at acceptance or `recordSubmitted`; − at settlement, confirmation, not paid, failed       |
| `available` | Settled on chain and collectable now (claimable in the Tab)               | + at settlement for a writer in `hold`; − at the writer's `claim`                           |
| `collected` | In the writer's wallet                                                    | + at settlement with direct payout, at a wallet tip's confirmation, at the writer's `claim` |

Each figure is a running field on `authorEarnings`, per token, in cents and
in base units (`pendingCents`, `availableCents`, `collectedCents`, and
`pendingBaseUnits`, `availableBaseUnits`, `collectedBaseUnits` maps), written
only through `moveEarnings(ctx, { userId, token, from, to, cents, baseUnits })`
in the mutation that changes the receipt's or tip's state. No total is
computed from a capped scan. Lists (`activity.mine`) are paginated. The
reader's figures are running fields too: `reserved` is
`tabAccounts.outstanding`, and `spendable` is `readerSpendable(account)`.

**Cents.** Each tip carries its writer share in cents at its own acceptance
price (`tabReceipts.writerCents`, set at acceptance:
`amountCents − round(amountCents × 250 / 10,000)`). Settlement moves exactly
the settled receipts' `writerCents`. A collect is in base units: a `claim` of
`b` base units of a token with `available` of `A` base units and `C` cents
moves `round(C × b / A)` cents, and a collect that takes `available` to zero
base units moves all remaining `C` cents. So cents never drift across
collects, and `available` is zero in cents exactly when it is zero in base
units.

**With direct payout** (v3 contracts), settlement moves `pending` straight to
`collected`, and `available` holds only writers the settler put in `hold`; for
most writers it is $0, and "Ready to collect" may be hidden at zero. **Before
the v3 contracts** (slice 1 on the v2 contracts), settlement moves `pending`
to `available` and the writer's `claim` moves it to `collected`. The labels are
true in both: `available` is always what a `claim` would pay now, and
`collected` is always what reached the wallet.

`earnings.mine` returns the three figures, `total = pending + available +
collected`, and the per-token base units. The v2 `earnedBaseUnits` and
`totalEarnedCents` fields stay for audits and history.

## 2.7 Tests

- The v2 fix's invariant, re-run on `overhaul/v3`: between a confirmed
  settlement result and its indexed `TabSettled`, and after a replay of the
  event, `readerSpendable` does not rise.
- Earnings figures: for any sequence of accept, settle (paid or held),
  partial and full claim, not paid and replay, `pending + available +
collected` equals Σ `writerCents` of tips that did not fail, and
  `availableCents` is zero exactly when `availableBaseUnits` is zero.
- `convex-test`: after `balance.send`, `balance.session`, `activity.mine`
  (both roles) and `earnings.mine` return the new figures in the same
  transaction's results; after `finishSettlement`, figures move between
  states and totals are unchanged; shortfall, unpaid and rejected paths
  restore the reader's balance and remove the writer's pending share;
  no client path edits `balance.session` or `activity.mine` before acceptance.
- Wallet tips: `recordSubmitted` writes `sending` rows and adds to `pending`;
  confirmation moves it to `collected` once, even when the cron also runs.
- Display state: `useTip` shows "Sending" during the hold and the send, and the
  balance view changes only with the server result.
- Verification cadence: an injected clock and RPC fake confirm at the first
  poll after the transaction's ledger.
- Playwright against a local backend: two browser contexts (reader and
  writer); the writer's total changes within 1 s of the reader's acceptance.
