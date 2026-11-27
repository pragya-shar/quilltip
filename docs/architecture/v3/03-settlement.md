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
| Due rule           | 6 h age, 5 XLM, closing, window ending        | Every `ready` pair whose latest receipt is older than the undo window                |
| Batch              | Up to 32 vouchers                             | Up to 32 vouchers, sized to the network's footprint limits                           |
| Writer's payout    | `Tab.claim` by the writer                     | Paid in `Tab.settle` ([contracts C2](contracts.md#c2-tab)); `claim` only as fallback |
| Indexer dependency | None for settlement (result applied directly) | Unchanged; the indexer is kicked after each settlement                               |

Targets: accepted to on-chain 25 s p50 and 60 s p95; on-chain to the writer's
wallet in the same transaction.

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

A pair is due when it is `ready` and its latest receipt is older than
`UNDO_WINDOW_MS` (10 s). Order: closing accounts first, then the
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
- `tabVouchers` gains `payout: 'paid' | 'held'` per settlement outcome;
  `authorEarnings.claimableBaseUnits[token]` tracks held amounts.
- `earnings.mine.toCollect` shows held amounts. The writer's "Collect" action
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
  lease TTL respected; due rule excludes receipts inside the undo window.
- Contract tests for `settle` with payouts and `hold` ([contracts C5](contracts.md#c5-tests)).
- Local network suite: 40 vouchers from 40 readers to 10 writers settle in
  at most 3 runs and every writer's token balance rises by its net.
- Testnet measurement: fitted batch size, fee per run, accept to on-chain
  p50 and p95 over 50 tips; results in the package report.
