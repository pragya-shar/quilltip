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

- `authorEarnings.pendingCents` (+ the writer's share in cents at the
  acceptance price). The writer's headline figure counts accepted tips.
- One `activity` row per side (section 2.5).

The writer's screens subscribe to `earnings.mine` and `activity.mine({ role: 'writer' })`;
Convex pushes the change to the writer's open sessions within about a second.

### Reconciliation

Settlement (document 3) applies each settled voucher with the v2 function
`applyPairSettlement`, from the settler's own transaction result, not from
the indexer. In the same mutation, v3:

- moves the receipt's cents from `pendingCents` to `earnedCents`, and from
  `earnedCents` to `paidOutCents` when the payout went to the writer's wallet
  in the same transaction;
- sets the activity rows' status to `on-chain`, then `in-wallet`.

The reader's `available` must not change at settlement: `confirmedBalance`
falls by the settled gross and `outstanding` by the same amount. v2 lowers
`outstanding` from the settler's result at once but lowers
`confirmedBalance` only when the indexer applies `TabSettled`, so
`available` reads too high for one indexer cycle. v3 adds
`tabAccounts.unindexedSettled`: `applySettlementOutcomes` adds each settled
voucher's gross to it, and the `TabSettled` handler subtracts it once (the
handler already runs once per event id) when the event's transaction hash
matches a confirmed settlement record. `available = confirmedBalance −
outstanding − reserved − unindexedSettled`, floored at zero.

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
| Writer | `pendingCents` falls by the receipt's share; the activity item becomes `not-paid`.                                                | The item is listed as "Not paid" with no amount in totals |

A `SHORTFALL` pair stays `blocked` as in v2 and settles after the next
deposit; its items return to `sent`.

## 2.3 Wallet tips

A wallet tip is final only when the server confirms the `Tipped` event. It
still shows at once:

1. When `tipsV2.recordSubmitted` stores the hash, it writes both activity rows
   with status `sending` and adds the writer's share to
   `authorEarnings.incomingCents`. The writer sees "incoming" without a
   figure change in totals.
2. Verification (section 2.4) confirms in about 5 to 10 s. The confirming
   mutation credits the earnings directly (moves `incomingCents` to
   `earnedCents` and `paidOutCents`, because a Core tip pays the writer in the
   tip transaction) and sets both rows to `in-wallet`.
3. `FAILED` or `EXPIRED` removes the incoming amount and sets both rows to
   `failed` (reader) or removes the writer's row.

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

`authorEarnings` keeps its v2 fields and gains cents by state, so the
writer's headline needs no base-unit arithmetic on the client:

| Field (cents)   | Moves at                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| `incomingCents` | wallet tip recorded (+), confirmed or failed (−)                           |
| `pendingCents`  | balance tip accepted (+), settled or not paid (−)                          |
| `earnedCents`   | settled or confirmed (+)                                                   |
| `paidOutCents`  | reached the writer's wallet (+): Core tips at once, balance tips at payout |

`earnings.mine` returns `total = pending + earned`, `onTheWay = pending + (earned − paidOut)`,
`inWallet = paidOut`, and `toCollect` from `claimableBaseUnits` (writers the
settler could not pay directly, [section 3.5](03-settlement.md#35-automatic-payout)).
The figures are in cents at the acceptance price; base units stay in the v2
fields for audits.

## 2.7 Tests

- `unindexedSettled`: between a confirmed settlement result and its indexed
  `TabSettled`, `available` does not rise; after the event (and after a
  replay of it), `unindexedSettled` is back to zero and `available` is
  unchanged.
- `convex-test`: after `balance.send`, `balance.session`, `activity.mine`
  (both roles) and `earnings.mine` return the new figures in the same
  transaction's results; after `finishSettlement`, figures move between
  states and totals are unchanged; shortfall, unpaid and rejected paths
  restore the reader's balance and remove the writer's pending share;
  no client path edits `balance.session` or `activity.mine` before acceptance.
- Wallet tips: `recordSubmitted` writes `sending` rows and `incomingCents`;
  confirmation credits once even when the cron also runs.
- Display state: `useTip` shows "Sending" during the hold and the send, and the
  balance view changes only with the server result.
- Verification cadence: an injected clock and RPC fake confirm at the first
  poll after the transaction's ledger.
- Playwright against a local backend: two browser contexts (reader and
  writer); the writer's total changes within 1 s of the reader's acceptance.
