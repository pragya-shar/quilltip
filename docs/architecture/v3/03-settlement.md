# 3. Fast settlement

Accepted balance tips reach the chain within about a minute, and the writer's
share reaches the writer's wallet in the same transaction.

## 3.1 What changes from v2

v2 (spec 3.8) settled a pair when its oldest unsettled receipt was 6 hours
old, when it owed 5 XLM, or when the reader's tab was closing, from a cron
every 10 minutes. The writer then collected with `Tab.claim`. v3 keeps the
safety rules of the v2 settler (`convex/lib/chain/settler.ts`: single
flight, record before send, no double settlement, bisection of bad
vouchers) and replaces when it runs and what the transaction does.

| Item               | v2                                            | v3                                                                                   |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Trigger            | Cron, 10 min                                  | Scheduled from acceptance, 15 s debounce; cron every minute as backstop              |
| Due rule           | 6 h age, 5 XLM, closing, window ending        | Every `ready` pair whose oldest unsettled receipt is at least 15 s old               |
| Batch              | Up to 32 vouchers                             | Up to 32 vouchers, sized to the network's footprint limits                           |
| Writer's payout    | `Tab.claim` by the writer                     | Paid in `Tab.settle` ([contracts C2](contracts.md#c2-tab)); `claim` only as fallback |
| Indexer dependency | None for settlement (result applied directly) | Unchanged; the indexer is kicked after each settlement                               |

Targets: accepted to on-chain 25 s p50 and 60 s p95; on-chain to the writer's
wallet in the same transaction.

### Preconditions for the fast cadence

The fast cadence turns settlement results from rare to constant. P2 does not
enable event-driven scheduling until all three preconditions below are on
`overhaul/v3` and their tests pass there.

#### A. Spendable during settlement (merged on `overhaul/v2`, PR 565)

The settler's record of a settlement moves the paid amount from
`tabAccounts.outstanding` to `tabAccounts.settledUnindexed`; the indexed
`TabSettled` debits `confirmedBalance` and releases the same amount, by the
event's paid range `[paid_after − gross, paid_after]`, merged per voucher in
`tabVouchers.indexedPaid`. The order and repetition of the two never change
spendable. `overhaul/v3` takes this by merge (PR 570); no v3 package writes a
second fix.

- **Invariant:** spendable never rises between a settlement result and its
  indexed event, nor when the event is replayed.
- **One helper:** `readerSpendable(account)` in
  `convex/lib/chain/tabLedger.ts` =
  `confirmedBalance − reservedOf(account)`, where `reservedOf` =
  `outstanding + settledUnindexed`. Not clamped: a negative value means the
  Tab is over-committed and accepts no balance tip. `tabs.getMyTab`
  (`available`, and `outstanding` = `reservedOf`), `balance.session`,
  `tipContext` and `checkTabTip` call it; nothing else computes spendable. A
  stored ledger figure that would go negative is logged as
  `CHAIN_TAB_LEDGER_NEGATIVE` and kept at zero, which only enlarges the
  reserve. In v3, `reservedOf` also adds `withdrawReserved`
  ([contracts C2](contracts.md#convex-side-of-the-instant-withdrawal)).
- **Display:** the server never hides a negative value. The view model maps
  it to `spendable = $0.00` with `overCommitted: true`, and routing treats it
  as "no amount fits" (no balance route).

#### B. A settlement whose event is never indexed (issue 573)

If a `TabSettled` is never indexed, its paid amount stays in
`settledUnindexed` for good: spendable is understated (the safe direction)
and today nothing releases it. v3 adds a release path, unless the v2 ledger
owner fixes it first.

**Proof that the event will not arrive.** For a voucher with an unindexed
amount (`paidOnChain` above the total of `indexedPaid`), the last
settlement record that paid it (`tabSettlements`, `CONFIRMED`, with `txHash`
and `ledger`) is **stale** when all of these hold:

1. `chainCursor.status` is `OK` and `chainCursor.lastLedger ≥ ledger + 60`
   (the indexer has covered the settlement's ledger with 5 minutes of margin;
   the indexer never skips a range, it stops on a gap);
2. no `chainEvents` row has that `txHash` (`by_tx`) with `type` `TabSettled`
   for this pair, in any `handled` state (a `pending` or `error` row means the
   event arrived and the handler must be fixed and re-dispatched, not
   released);
3. no settlement for this reader is open (`PREPARED` or `SUBMITTED`).

A settlement record that is not `CONFIRMED` never moved money
(`finishSettlement` applies only confirmed results), so a failed transaction
needs no release.

**Release: reconcile from chain, never a bare release.** A stale reserve is
not simply dropped, because the chain did pay it: dropping it without the
debit would raise spendable. Instead `internal.tabLedger.reconcileAccount`
(an action, P5) reads the reader's state by simulation at the latest ledger
`L`: `Tab.account(reader)` and `Tab.paid(reader, key_id, writer)` for each of
the reader's ACTIVE pairs. In one mutation it then:

- sets `confirmedBalance` to the chain balance, with
  `balanceEventId = afterLedgerEventId(L)`, an id that sorts after every event
  of ledger `L` (the existing ordering rules then ignore every older balance
  event and debit);
- for each pair, raises `paidOnChain` to the chain's `paid` through
  `applyPairSettlement` (so `outstanding` follows) and sets `indexedPaid` to
  `[0, paid]`;
- recomputes `settledUnindexed` as Σ (`paidOnChain` − total of `indexedPaid`),
  which is now zero;
- writes an audit row.

A late `TabSettled` with an id below `afterLedgerEventId(L)` then debits
nothing; its range is already in `indexedPaid`, so it releases nothing twice.

**Who releases.** Both:

- **Automatic:** the settler run checks the stale rule for accounts with an
  unindexed amount (`settledUnindexed > 0`, bounded per run) and schedules
  `reconcileAccount` with `reason: 'unindexed-stale'`.
- **Operator:** `npx convex run tabLedger:reconcileAccount '{"tabAccountId":"…","reason":"operator","note":"…"}'`
  for any account, at any time, under the same rules except the stale rule.

**Audit record** (`tabReconciliations`): `tabAccountId`, `reason`
(`unindexed-stale`, `since-balance-full` (section C), `operator`),
`triggeredBy` (`auto` or the operator's user id), `ledger`, `before` and
`after` (`confirmedBalance`, `outstanding`, `settledUnindexed`, per-pair
`paidOnChain` and `indexedPaid` totals), the stale settlement hashes, `note`,
`createdAt`. Any change to `confirmedBalance` other than the stale reserve's
amount is logged as `CHAIN_TAB_RECONCILE_DRIFT`.

**Tests:** a confirmed settlement whose event is withheld from the fake
indexer is released only after the cursor passes `ledger + 60`; a `pending`
event row blocks the release; an open settlement blocks it; after the
release, spendable equals the chain view and a late event changes nothing;
the operator path writes the audit row with the user id; a drift case logs
`CHAIN_TAB_RECONCILE_DRIFT`.

#### C. Bounded balance bookkeeping (`settledSinceBalance`)

Today `TabSettled` debits are kept in `tabAccounts.settledSinceBalance`, at
most `MAX_SETTLED_SINCE_BALANCE` (256) entries, for two jobs: skipping a
debit already applied (by event id), and re-applying later debits when an
older absolute balance event (`Deposited`, `WithdrawStarted`, `Withdrawn`)
arrives late. With more than 256 settlements between two absolute balance
events, the oldest entries are cut; a re-dispatch of a cut event then debits
twice. At a 15 s cadence an active reader reaches 256 in about an hour. v3
removes the bound in three steps (P5, in `tabEventHandlers.ts` and
`tabLedger.ts`):

1. **Idempotency by paid range, not by the list.** A `TabSettled` debits
   `confirmedBalance` by exactly the part of its range
   `[paid_after − gross, paid_after]` that is new to the pair's
   `indexedPaid` (`rangesTotal(after) − rangesTotal(before)`). A replay or a
   re-dispatch adds nothing to `indexedPaid`, so it debits nothing. Events for
   a pair this deployment never accepted (today's `orphan` return) keep their
   ranges in a small `tabOrphanPaid` row per (account, key, writer).
2. **The list only orders, and is compacted.** `settledSinceBalance` keeps
   only debits with an event id above the indexer's **dispatch watermark**:
   the id below which every stored event is handled
   (`chainCursor.dispatchedThrough`, kept by the indexer, P4: just below the
   lowest `pending` event id, or the cursor when none is pending). An
   absolute balance event at or below the watermark cannot arrive later, so
   entries at or below it are dropped on every write. In normal operation the
   list holds at most one page of events.
3. **No silent cut.** If the list would still exceed 256 (an event stuck
   `pending` holds the watermark back), the handler does not truncate: it
   applies the debit, logs `CHAIN_TAB_SINCE_BALANCE_FULL`, and schedules
   `reconcileAccount` with `reason: 'since-balance-full'`, which resets the
   balance from chain (section B) and clears the list.

- **Invariant:** each paid range of each pair is debited from
  `confirmedBalance` exactly once, whatever the order, replay or re-dispatch
  of events; `settledSinceBalance` never holds more than 256 entries and is
  never truncated.
- **Test:** 300 settlements for one reader between two `Deposited` events,
  with one `TabSettled` held `pending` and re-dispatched last, plus a full
  replay of the range: `confirmedBalance` equals the contract's balance and
  each range is debited once; a forced overflow schedules a reconcile and
  writes its audit row.

### Runbook rule: pushing Convex functions

A settlement result applied by the old code just before a push, and its
event applied by the new code after, can disagree on the reserve (for
example a record applied without `settledUnindexed` has no reserve until its
event is indexed). So functions are pushed only when the indexer is caught up
and no settlement is in flight:

1. Hold the settler: set `SETTLER_HOLD=true` on the deployment (P2:
   `settleDue` returns `held` at once; acceptance continues; the schedule
   document keeps its request).
2. Check that no settlement is open; this must print `[]`:

   ```bash
   npx convex run tabSettlement:listOpenSettlements
   ```

3. Check that the indexer is caught up: `status` is `OK` and `lagLedgers` is
   at most 2:

   ```bash
   npx convex run chain/indexer:readCursor
   ```

4. Push the functions, then unset `SETTLER_HOLD`. If either check fails, wait
   one minute and repeat it; do not push.

## 3.2 Scheduling

A singleton document schedules the next run. It is read on every
acceptance and written only when no run is scheduled, so acceptances do not
contend on it.

```ts
// convex/lib/chain/settleSchema.ts (package P2)
settlerSchedule: defineTable({
  network: chainNetworkValidator,
  /** When the scheduled run starts; unset when none is scheduled. */
  runAt: v.optional(v.number()),
  scheduledId: v.optional(v.id('_scheduled_functions')),
  /** Set by an acceptance while a run is in progress. */
  rerun: v.boolean(),
  /** Runs started in the current hour, for the cost cap. */
  hourStart: v.number(),
  runsThisHour: v.number(),
  updatedAt: v.number(),
}).index('by_network', ['network'])
```

```ts
// convex/lib/chain/settleSchedule.ts (package P2), called by balance.send
export async function requestSettlement(
  ctx: MutationCtx,
  now: number
): Promise<void>
```

Rules:

1. If `runAt` is set and in the future, do nothing (a run is coming).
2. If the settler lease is held (a run is in progress), set `rerun: true`.
3. Otherwise schedule `internal.tabSettler.settleDue` at
   `now + SETTLE_DEBOUNCE_MS` (15 s) and store `runAt` and `scheduledId`.
   The debounce is fixed from the first acceptance, not sliding, so a steady
   stream of tips cannot postpone a run.
4. No early flush at 32 vouchers: counting due vouchers on every acceptance
   would write the schedule document on every tip. With a fixed 15 s
   debounce a full batch waits at most 15 s, and rule 5 sends further full
   batches back to back.
5. At the end of a run, the run clears `runAt`. If `rerun` was set, or the
   run left `ready` pairs because the batch was full, it schedules the next
   run at once (`runAfter(0)`, cost cap permitting).
6. Cost cap: at most `SETTLER_MAX_RUNS_PER_HOUR` runs (default 240) start per
   hour. Past the cap, the next run is scheduled at the start of the next
   hour and `TAB_SETTLER_RATE_CAPPED` is logged.

A pair is due when it is `ready` and its oldest unsettled receipt is at
least `SETTLE_DEBOUNCE_MS` (15 s) old; nothing waits longer than about 60 s
under load. Acceptance is final, so no receipt is held back. Order: closing accounts first, then the
soonest key window end, then the oldest unsettled receipt (v2 `orderDue`
without the age and amount rules). The v2 constants `DUE_AGE_MS` and
`DUE_AMOUNT` are removed.

Optional cost floor for a later mainnet: `SETTLE_MIN_GROSS_CENTS` (default 0)
holds pairs below the floor until their oldest receipt is
`SETTLE_MAX_HOLD_MS` (5 min) old.

## 3.3 The run

The v2 cycle (`runSettlementCycle`) stays, with these changes:

1. **Lease.** `settler` lease as in v2. The lease TTL falls from 8 to 2
   minutes: a run now polls for at most 30 s after sending (6 polls at 5 s
   in v2 became 10 polls at 2 s, starting 3 s after send).
2. **Open settlement first.** Unchanged: a run that finds an open settlement
   resolves it and sends nothing new while it is pending.
3. **Selection.** Due pairs, pre-checked with the shared encoder (v2
   `precheck`), as in 3.2.
4. **Sizing.** The run simulates the selected batch. A simulation that fails
   on resources (`ResourceLimitExceeded`, or a footprint over the network's
   per-transaction entry limits) halves the batch and retries; it never
   rejects a voucher for size. A failure that one voucher explains is
   bisected and that voucher is rejected for review, as in v2. The run
   records the largest size that fitted (`settlerSchedule.lastFit`) and starts
   from it next time.
5. **Payout set.** The run passes the batch's writers as payees
   (section 3.5). If simulation fails on a payee's transfer, the run moves that
   payee to `hold` and simulates again.
6. **Send and poll.** Record the envelope, send, poll. A confirmed result is
   applied with `finishSettlement` (v2) plus the payout outcomes, in one
   mutation; it then calls `chain.indexer.kick`.

### Footprint

Per voucher `settle` writes the pair's `Paid` entry, the reader's
`Account` and the key's `Session`; per paid writer v3 adds a token balance
write; per batch it writes the contract's token balance and the treasury's
`Claimable`. v2 `settle` with 32 vouchers measured 48.0M instructions, 49
write entries and 33.8 KB on testnet, inside the limits (400M, 200, 132 KB). Payouts
add one token transfer per distinct writer, so P1 extends that test to the
worst case with payouts (32 vouchers, 32 writers, none held) and lowers
`MAX_SETTLE_BATCH` if it does not fit. Step 4 protects against limits that
change on the network. P2 records the fitted size and the fee on testnet in
its report.

## 3.4 Cost

A run sends one Soroban transaction per Tab instance with due pairs, in
sequence from the settler account (one sequence number at a time). Cost per
transaction is the simulated resource fee plus the inclusion fee.

Measured on testnet for v2 `settle` (rails research, 2026-11-27): 14,082
stroops for 1 voucher, 59,733 for 8, 188,626 for 32 (5,895 per voucher) on
pairs that settled before; first settlement of a new pair or a new writer
adds one-time rent (about 1.2M stroops for a new writer's `Claimable`). At
the 15 s debounce the modelled daily cost is about $0.02 at 100 tips, $1.3
at 10,000 tips and $76 at 1,000,000 tips; the 6 hour rule saved at most about
$0.55 a day at 10,000 tips. Direct payout replaces the first `Claimable`
write per writer with a token balance write, which P1 measures. Above about
2 settlement transactions per ledger (around 1M tips a day), the settler
submits from 2 to 4 source accounts, with the settler address authorising
each call; that is not needed for testnet. The run
logs `TAB_SETTLER_RUN_COST` with the fee charged and the vouchers settled.
Controls: the 15 s debounce (at most 4 runs a minute under load, fewer
otherwise), the hourly cap (3.2 rule 6), the batch fill, and the optional
floor. The settler account balance alert of v2 (`BALANCE_ALERT_STROOPS`)
stays. On testnet the settler account is funded by Friendbot; the deploy
tooling's `ops-v2` top-up applies.

## 3.5 Automatic payout

Decision: pay in the settlement transaction, not with a later `claim`. A
daily or per-run `claim` per writer would add one transaction per writer,
compete for the settler's sequence numbers, and leave earnings out of the
writer's wallet for minutes to a day. Direct payout costs one token transfer
per writer inside a transaction that runs anyway.

v2 credited each writer's net to `Claimable(writer)` and the writer called
`Tab.claim`. v3's `Tab.settle` takes a `hold` list: every writer in the batch
who is not in `hold` is paid their batch net directly, aggregated per writer
and token, at the end of the call. Writers in `hold` are credited to
`Claimable` as in v2 ([contracts C2](contracts.md#c2-tab)).

- A transfer to a writer can fail only when the writer's address cannot hold
  the token (for example a classic account without a trustline for a
  credit asset). Simulation shows it, and the run moves that writer to `hold`.
- `tabVouchers` gains `payout: 'paid' | 'held'` per settlement outcome. A
  paid writer's share moves `pending → collected`; a held writer's share moves
  `pending → available` ([section 2.6](02-instant-state.md#26-earnings)).
- `earnings.mine.available` shows held amounts. The writer's "Collect" action
  calls `Tab.claim(writer, token)` (anyone may call; funds go only to the
  writer), so the settler also retries held writers once an hour with a
  separate `claim` transaction when simulation shows it now succeeds.
- The treasury fee stays in `Claimable(treasury)`; an ops action claims it.

## 3.6 Failure cases

| Case                                                  | Handling                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Run crashes after send                                | v2: the next run finds the recorded envelope and looks up the hash                           |
| Scheduled run lost (deploy, crash before start)       | The 1 minute cron runs `settleDue`; `runAt` in the past is cleared by the cron               |
| Batch over resource limits                            | Halve and retry (3.3 step 4); never a rejection                                              |
| A bad voucher                                         | v2 bisection, `REJECTED` for review; the reader's reservation is released                    |
| A payee cannot receive                                | Moved to `hold`, credited to `Claimable`                                                     |
| `SHORTFALL`                                           | v2: the pair is `blocked` until a deposit; activity shows it (section 2.2)                   |
| Key window ending                                     | v2 `expiring` order; with 90 day keys and minute settlement this needs an outage of months   |
| Settler balance low                                   | v2 alert; runs fail with a fee error and stop until funded; acceptance continues             |
| RPC down                                              | The run fails before send; the next scheduled or cron run retries; screens still show "Sent" |
| Settlement disabled (`SETTLEMENT_ENABLED` not `true`) | Acceptance refuses (`BALANCE_SETTLEMENT_OFF`) and the pipeline routes to the wallet          |

## 3.7 Indexer cadence

The indexer (`convex/chain/indexer.ts`) keeps its lease, cursor and handlers.
It gains a kick:

```ts
// convex/chain/indexer.ts (package P4)
export const kick = internalMutation({ args: {}, returns: v.null(), handler })
```

- `kick` schedules `pollEvents` with `runAfter(0)` unless a kicked run is
  already scheduled or running (`indexerKicks` singleton, same shape as
  `settlerSchedule` without the cost fields). A run that starts after a kick
  clears it; a kick during a run sets `rerun`, and the run reschedules itself
  once at its end.
- Callers: transaction verification on `SUCCESS` (deposits, keys,
  withdrawals, wallet tips, article registrations), and the settler after a
  confirmed settlement.
- The 1 minute cron stays as the backstop for transactions the app did not
  send (a writer's own `claim`, operator calls).

## 3.8 Tests

- `requestSettlement`: schedules once for many acceptances; respects a run in
  progress (`rerun`); reschedules after a full batch; hourly cap.
- Run with injected deps (v2 test harness): resource failure halves without
  rejection; payee failure moves the payee to `hold`; payout outcomes applied;
  lease TTL respected; the due rule takes a pair 15 s after its oldest
  unsettled receipt.
- Contract tests for `settle` with payouts and `hold` ([contracts C5](contracts.md#c5-tests)).
- Local network suite: 40 vouchers from 40 readers to 10 writers settle in
  at most 3 runs and every writer's token balance rises by its net.
- Testnet measurement: fitted batch size, fee per run, accept to on-chain
  p50 and p95 over 50 tips; results in the package report.
