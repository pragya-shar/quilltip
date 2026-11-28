# Chain operations runbook

Procedures for the payments v2 contracts (Core, Tab and the Article NFT) on
Stellar testnet. Specification:
[07-security-and-recovery.md, section 7.4](../architecture/v2/07-security-and-recovery.md#74-failure-recovery),
[05-flows-and-admin.md, section 5.11](../architecture/v2/05-flows-and-admin.md#511-roles-and-administration)
and
[08-testing-and-deployment.md, section 8.4](../architecture/v2/08-testing-and-deployment.md#84-testnet-deployment-procedure).

All activity described here is testnet activity. The tools refuse mainnet in
every form.

## Tools

| Task                           | Command                           | Guard                            |
| ------------------------------ | --------------------------------- | -------------------------------- |
| TTL report and extension       | `bun run contracts:extend-v2 …`   | `assertScriptStellarTestnetOnly` |
| Restore archived entries       | `bun run contracts:restore-v2 …`  | `assertScriptStellarTestnetOnly` |
| Redeploy after a testnet reset | `bun run contracts:redeploy-v2 …` | `assertScriptStellarTestnetOnly` |
| Roles, pause and unpause       | `bun run contracts:roles-v2 …`    | `assertScriptStellarTestnetOnly` |
| Event backfill for the indexer | `bun run chain:backfill-events …` | `assertScriptTestnetOnly`        |
| First deployment of a set      | `bun run contracts:deploy-v2 …`   | `assertScriptStellarTestnetOnly` |

Every tool:

- takes `--set integration|live` and `--keys-dir <dir>`. The key directory is
  outside the repository and holds one folder per set, written by the
  deployment tool: Stellar CLI identities (mode 600) and `deploy-state.json`;
- runs the network guard before it reads a key, a file or the network;
- passes `--network`, `--rpc-url` and `--network-passphrase` to the Stellar CLI
  explicitly, and asks the RPC server for its passphrase before each
  submission;
- is a **dry run by default**. It prints what it would do, including the CLI
  commands. Add `--submit` to send transactions or write to Convex;
- is idempotent. A rerun after success sends nothing, and a rerun after a
  failure continues the work;
- never prints a secret.

### Environment

```bash
export QUILLTIP_NETWORK_GUARD_OPT_IN=testnet
export NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
export NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
export NEXT_PUBLIC_NETWORK_PASSPHRASE='Test SDF Network ; September 2015'
```

The Stellar-only tools refuse to run while `CONVEX_DEPLOY_KEY`,
`CONVEX_DEPLOYMENT_TOKEN` or the live-backend approval is set. The backfill
tool also needs the Convex target (see [Indexer behind retention](#indexer-behind-retention)).

### Files in `<keys-dir>/<set>/`

| File                  | Written by             | Content                                                      |
| --------------------- | ---------------------- | ------------------------------------------------------------ |
| `deploy-state.json`   | deployment, redeploy   | Commit, Wasm hashes, contract IDs, public keys, transactions |
| `ledger-entries.json` | extend, restore        | Ledger entries the set depends on                            |
| `ttl-report.json`     | extend, restore        | Last TTL report                                              |
| `ops-log.json`        | extend, restore, roles | Every transaction these tools sent                           |
| `backfill-*.json`     | backfill               | Events read for a backfill range                             |
| `*.before-reset-*`    | redeploy               | State and entries of the network before a reset              |

## Scheduled TTL extension

Testnet keeps a persistent entry for at least 7 days (120 days on mainnet).
An entry that is not extended is archived when its TTL ends, and calls that
read it fail until it is restored.

The contracts extend what they write to 120 days. Some entries are not
extended by normal use:

- The OpenZeppelin role entries (`HasRole`, `RoleAccounts`,
  `RoleAccountsCount`) are written with the network minimum. On testnet they
  expire 7 days after the deployment or the role change, unless a role check
  reads them first.
- The native asset contract's balance entry for Tab holds reader deposits.
- Instances and Wasm code of a contract that nobody calls.

Temporary entries (`Session`, `Paid` and tip references) are not tracked. The
contracts give them a TTL that ends after the last ledger they can be used
(I-29), and an expired temporary entry is deleted, not archived.

**Run the extension twice a week** (for example Monday and Thursday), and
within 3 days of every deployment, redeploy or role change. A weekly run has
no margin on testnet: role entries live 7 days, and the testnet RPC server
keeps 7 days of transactions (120,960 ledgers), which the entry scan needs.

```bash
bun run contracts:extend-v2 --set integration --keys-dir <dir>            # report and plan
bun run contracts:extend-v2 --set integration --keys-dir <dir> --submit   # extend
```

- The report lists every tracked entry with its live-until ledger and the days
  left (at 5 seconds per ledger). Status `due` means fewer days left than
  `--threshold-days` (default 30). `--submit` extends the due entries to
  `--extend-days` (default 120), one transaction per Wasm and up to 20 keys per
  contract transaction, signed by the set's deployer key.
- Entries are found from transaction footprints: the deployment's transactions
  and every transaction that emitted an event of the set since the last run.
  A run less than 7 days after the previous one stays inside RPC retention.
  If more time has passed, the report says which ledgers the scan could not
  read; entries first written there are not tracked. An entry that no
  transaction of the scan touched can be added with
  `--entries-file` (a JSON array of `{ "contract": "tab", "keyXdr": "<base64 ScVal>" }`).
- `absent` means the entry is not in the ledger: the contract removed it (a
  claimed balance, for example). It needs nothing.
- Exit code 3 means an entry is archived. Run the restore below.

To schedule it on the operator machine, put the four variables above in a
file outside the repository and add a crontab line such as:

```text
0 9 * * 1,4  cd <repo> && . <env-file> && bun run contracts:extend-v2 --set integration --keys-dir <dir> --submit >> <log-file> 2>&1
```

The job needs the key directory, so it runs where the keys are. CI has no
testnet keys and does not run it.

## Archived entries

Prepared app transactions restore the entries they read on their own. Use the
restore tool for entries that nothing touches, or for large footprints:

```bash
bun run contracts:restore-v2 --set integration --keys-dir <dir>            # list archived entries
bun run contracts:restore-v2 --set integration --keys-dir <dir> --submit   # restore and extend them
```

It restores only entries the report shows as `archived`, and extends them to
120 days in the same run. A rerun with nothing archived sends nothing.

## Indexer behind retention

The indexer stops with `BEHIND_RETENTION` when its next ledger is older than
the RPC server keeps (`lastLedger < oldestLedger`), and the ops page shows the
lag alert.

1. Set `CHAIN_V2_ENABLED=false` on the Convex deployment.
2. Point the tool at the deployment of the set:

   ```bash
   export CONVEX_DEPLOYMENT=dev:<deployment>
   export NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
   ```

   The guard accepts allowlisted deployments. A live deployment also needs
   `QUILLTIP_LIVE_BACKEND_OPERATIONAL_APPROVAL` naming it, set by its owner.

3. Read the missed range and check it (dry run):

   ```bash
   bun run chain:backfill-events --set integration --keys-dir <dir> --from-ledger <lastLedger + 1>
   ```

   - If the range is inside RPC retention, the tool prints the event count per
     contract and writes the events to `backfill-<from>-<to>.json`.
   - If it is not, the tool stops, writes nothing and prints the steps: export
     the older ledgers' events in RPC `getEvents` format from a source that
     still has them (an RPC provider with a longer history, or a hosted
     indexer), write them with `--events-file`, then fill the rest from RPC.
     Scripts accept only the testnet RPC hosts listed in the network guard, so
     another provider is added in a reviewed change.

4. Write the events and resume the indexer:

   ```bash
   bun run chain:backfill-events --set integration --keys-dir <dir> --from-ledger <n> --submit --resume
   ```

   The tool first checks that the deployment's `CORE_CONTRACT_ID` is the set's
   Core. It writes through the internal mutation `chain/indexer:ingestBackfill`;
   stored events are skipped and handlers are idempotent, so a rerun changes
   nothing. `--resume` calls `chain/indexer:replayFrom` with the ledger after
   the range and `gapBackfilled: true`. Before any write, it checks that the
   range starts no later than the ledger after the one the index covers;
   otherwise it stops, because the ledgers in between would be marked as
   indexed without being read.

5. Reconcile, then set `CHAIN_V2_ENABLED=true`. Records that no source can
   resolve stay flagged for manual review. A tab settlement whose
   `TabSettled` no source has keeps its reserve; correct it with
   [Stale settlement reserves](#stale-settlement-reserves).

## Stale settlement reserves

A tab settlement moves the paid amount from the reader's `outstanding` to
`tabAccounts.settledUnindexed` when the settler records it. The indexed
`TabSettled` event then debits `confirmedBalance` and clears the reserve. If
that event is never indexed (a gap beyond RPC retention that no backfill
covers, or a database restore), the reserve stays. Spendable then reads low,
never high.

Two paths release it, each only when the stored balance already reflects
the debit:

- **On its own.** An absolute balance event (`Deposited`, `WithdrawStarted`,
  `WithdrawCancelled`, `Withdrawn`) from a later ledger than every unindexed
  payment of a pair releases that pair's reserve. Each pair keeps that
  ledger as `paidLedger`. A reserve whose ledger is unknown (a pair written
  before this field) waits for the pair's next payment, which sets it, or
  for the operator path.
- **Operator reconciliation.** It reads the Tab contract's
  `account(reader).balance` and `paid(reader, key_id, writer)` at one
  ledger, and releases what the chain confirms.

Each release writes a `tabReserveReleases` row and logs
`CHAIN_TAB_RESERVE_RELEASED`. A missing event that arrives after a release
does not debit or release again.

### Check

`/ops/chain` lists the accounts whose reserve has stayed above 0 for more
than an hour, with each pair's unindexed amount and `paidLedger`. From the
command line (owner credentials for the deployment):

```bash
bunx convex run chain/tabReconcile:listStaleReserves '{}'
bunx convex run chain/tabReconcile:listStaleReserves '{"olderThanMs":600000}'
```

A reserve normally clears within a few minutes of its settlement. One that
stays for an hour means a `TabSettled` the indexer has not applied.

### Correction

1. Make sure the indexer is `OK` and caught up, and that no Tab event for
   this reader is `pending` or `error` (the `chainEvents` rows with this
   reader as the second topic). Other `pending` events, such as role grants
   that no handler records, do not block it. If a range was missed, backfill it first
   ([Indexer behind retention](#indexer-behind-retention)): the backfilled
   event releases the reserve the normal way.
2. Dry run for the reader. It writes nothing:

   ```bash
   bunx convex run chain/tabReconcile:run '{"reader":"G…"}'
   ```

   The result shows the ledger it read at, the account figures before and
   after, and for each pair the stored and on-chain paid amounts and the
   amount it would mark as indexed. Add `"keyId"` and `"writer"` to limit
   it to one pair.

   The RPC reads the contract only at the newest ledger, and the indexer
   applies the newest ledger once a minute. So the command waits until the
   indexer has applied the ledger it read: up to 2.5 minutes in all,
   usually under one. If the account changes in the meantime (`CHANGED`,
   `STALE_READ`), it reads again, up to 3 times. The checks below do not
   change.

3. Apply, with a note for the record:

   ```bash
   bunx convex run chain/tabReconcile:run '{"reader":"G…","apply":true,"note":"<ticket or reason>"}'
   ```

   It applies the contract's balance as the account's balance at the end of
   the ledger it read, and marks each pair's `[0, paid]` as indexed.

4. Run it again: it returns `nothing_to_do`. Check that the account no
   longer appears in the list.

It refuses, and writes nothing, when it cannot prove the release:

| Refusal            | Meaning and next step                                                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHANGED`          | The account changed between the snapshot and the write (a tip or an event) on each of 3 reads. Run it again when the account is quiet.                                                                      |
| `INDEXER_BEHIND`   | The indexer did not apply the ledger the chain was read at within 2.5 minutes, or it is stopped. Check `/ops/chain` and fix the indexer.                                                                    |
| `EVENTS_UNHANDLED` | A Tab event for this reader at or before that ledger is `pending` or `error`. Dispatch it first (`chain/indexer:redispatch`).                                                                               |
| `STALE_READ`       | The stored balance, or a settlement debit applied to it, comes from after the ledger read, on each of 3 reads (an RPC node behind the indexer). Run it again.                                               |
| `MISSING_READ`     | A pair in the snapshot has no row or no chain read (the pair list changed). Run it again.                                                                                                                   |
| `MISMATCH_PAID`    | The contract shows less paid than stored. Do not correct by hand: review the pair's settlements.                                                                                                            |
| `BALANCE_MISMATCH` | The difference between the stored and on-chain balance is not explained by the unindexed payments (for example, a lost deposit or withdrawal event). Backfill the missing range instead, then run it again. |

### Reconciliation required

An absolute balance event (`Deposited`, `WithdrawStarted`,
`WithdrawCancelled`, `Withdrawn`) subtracts every settlement debit indexed
after it. It applies none of it when it cannot read them all: more than 1,000
such debits are waiting, or the same update already read its share (8,000
debit rows across the events it dispatches). Both are possible only when the
balance event itself arrives late, for example from a backfill. The indexer
then logs `CHAIN_TAB_RECONCILE_REQUIRED` and marks the account
`reconcileRequired` with the newest balance event it could not apply, and the
account takes no tab tip until its balance is known again. The event still
counts as handled, so the indexer does not stop.

`/ops/chain` lists these accounts under "Waiting for a reconciliation", and
so does:

```bash
bunx convex run chain/tabReconcile:listReconcileRequired '{}'
```

An absolute balance event newer than the marked one clears the mark by
itself; an older one changes nothing. Otherwise run the correction above for
the reader. For a marked account the reconciliation accepts any balance
difference (the event it could not apply explains it), sets the contract's
balance and clears the mark.

The reconciliation never sets spendable above the contract's balance minus
the accepted amounts still unpaid. Running it on a reader with a pair limit
(`keyId`, `writer`) may leave other pairs' reserves in place: that is safe,
and a reader-wide run releases them.

## Collected earnings

A writer's collected tab earnings (`authorEarnings.collectedBaseUnits`) are
the sum of their indexed `Claimed` events. Each applied event has a
`tabClaims` record, keyed by the chain epoch and the RPC event id. That id
is the event's ledger, transaction, operation and index, so a restore, a
backfill or rebuilt `chainEvents` rows give the same id. An event with a
record is not counted again, however it is re-dispatched.

**Once after deploying this change**, record the claims applied before it
(a dry run first; it changes no total):

```bash
bunx convex run chain/tabClaims:seedClaimRecords '{}'
bunx convex run chain/tabClaims:seedClaimRecords '{"apply":true}'
```

Repeat with `"cursor"` set to the returned `continueCursor` while
`isDone` is false. Until it has run, a re-dispatch of an older `Claimed`
event would count it again. A deployment that indexed no `Claimed` event
before this change has nothing to record: production at the v2 cutover is
one, because `main` has no v2 indexer.

**Check and correct**, for example after a restore:

```bash
bunx convex run chain/tabClaims:recomputeCollected '{}'
bunx convex run chain/tabClaims:recomputeCollected '{"apply":true,"note":"<reason>"}'
```

It compares each writer's collected amount with the sum of their records
(`"userId"` limits it to one writer; page with `"cursor"`). With `apply` it
sets the amount to that sum and writes a `tabClaimCorrections` row for
each change. The Tab contract keeps no total of past claims, only what is
still claimable, so the records are the reference.

## Tab activity not accepted here

`/ops/chain` shows a count above 0 under "Tab activity not accepted here",
and the logs show `CHAIN_TAB_OUTSIDE_EVENT`. The indexer found a Tab event
that this deployment did not originate. It records each event once, in
`tabOutsideEvents`, and changes no figure: the handler applied the event as
it always does.

| Kind                     | Meaning                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `settled_no_voucher`     | A `TabSettled` for an account of this site, with no voucher for that key and writer      |
| `settled_above_accepted` | A `TabSettled` of a voucher of this site, above the cumulative amount this site accepted |
| `settled_no_account`     | A `TabSettled` for a reader with no account on this site in this epoch                   |
| `key_undeclared`         | A new session key for an account of this site that the app did not declare               |

For the settlement kinds, the indexer has already applied the debit, so the
reader's balance and available amount are the chain's figures. A
`key_undeclared` record moves no funds on its own: vouchers of that key
settle only with an acceptance or the settler of a deployment.

A settlement needs the reader's session-key signature and one of:

- an acceptor signature (`byWriter` true, `settle_own`);
- the `settler` role (`byWriter` false, `settle`).

While this deployment holds its acceptor and settler keys, and no other
deployment uses the same contract set, the settlement kinds do not occur.

Each record has the reader's account id (`tabAccountId`, none for
`settled_no_account`), `keyId`, `gross`, `ledger`, `eventId`, `chainEpoch`,
`byWriter` and `txHash`. `settled_above_accepted` also has `cumulative` and
`acceptedCumulative`. No record or log line contains an address.

From the command line (owner credentials for the deployment):

```bash
bunx convex run chain/tabOutside:listOpen '{}'
```

### Confirm on chain

1. Look up `txHash` on a Stellar testnet explorer, or with RPC
   `getTransaction`. Check that it calls this deployment's Tab contract
   (`/ops/chain` lists it). Note the function (`settle_own` or `settle`) and
   the event's `key_id`, `cumulative`, `paid_after`, `gross` and `by_writer`.
2. Read the contract state for the reader with the reconciliation dry run,
   which writes nothing:

   ```bash
   bunx convex run chain/tabReconcile:run '{"reader":"G…"}'
   ```

   It shows the balance and each pair's paid amount at one ledger.

3. Compare with this deployment, in the dashboard: `tabVouchers` for the
   account, key and writer (none, or a lower `cumulative`), and
   `tabAccounts.pendingKeys` for `key_undeclared`.
4. Rule out a restore. After a database restore, events the chain already
   reflects can find no voucher, a lower stored cumulative, or a consumed
   declaration. If the event is from before the restore point, the record is
   expected: acknowledge it with that note. More than 8 key declarations
   before one registration also gives `key_undeclared` for the oldest.

### First actions (settlement kinds)

1. **Stop tab tips for the reader with the existing controls.** If the
   reader's available amount is negative after the event, the app already
   refuses their tab tips (`TAB_OVER_BALANCE`) until they deposit again.
   Check it on the account. There is no per-reader switch. If the amount at
   stake is material, the only stop is deployment-wide:
   `SETTLEMENT_ENABLED=false`. It stops every quick tip and the settler;
   wallet tips go on. Turn it back on within hours, because a closing
   account must settle before its unlock, 3 days after `withdraw_start`
   ([Settler not running](#settler-not-running)).
2. **Check custody of the acceptor and settler keys.**
   - `byWriter` true: list the deployments and machines that hold
     `TAB_ACCEPTOR_SECRET` for this contract set, and check that the Tab's
     acceptor keys (`chainConfig.tabAcceptorKeys`) list no key this
     deployment does not hold.
   - `byWriter` false: run the roles report
     ([Roles, pause and unpause](#roles-pause-and-unpause)) and look for a
     `settler` holder not recorded at deployment.
   - For any kind: check that no other Convex deployment has this contract
     set's `TAB_CONTRACT_ID`.
3. **If in doubt, rotate the keys by the documented procedure**
   ([05-flows-and-admin.md, section 5.11](../architecture/v2/05-flows-and-admin.md#511-roles-and-administration)):
   - Acceptor, item 8. `set_acceptor(new)` keeps the previous key valid, so
     call `set_acceptor` twice to retire a key. Between the chain change and
     the `TAB_ACCEPTOR_SECRET` update, the app refuses quick tips
     (`TAB_ACCEPTOR_MISMATCH`); that pause is safe. Once the old key is
     gone, writers can no longer `settle_own` vouchers it countersigned; the
     settler still settles them.
   - Settler, item 7: grant the new key, update the Convex env, revoke the
     old key, confirm one settlement with the new key.

For `key_undeclared` alone: confirm it (steps 1 and 3), note it, and watch
for a settlement kind on the same account. No action is needed if none
follows.

Close each record when done. The note is required, and the row stays:

```bash
bunx convex run chain/tabOutside:acknowledge '{"chainEpoch":"…","eventId":"…","note":"<ticket or reason>"}'
```

### Do not

- Do not edit `tabAccounts`, `tabVouchers` or `tabReceipts` by hand. The
  debit is applied, and the available amount is the chain's figure.
- Do not run the reconciliation with `apply`. It is for lost events, and
  here no event is lost.
- Do not replay or re-dispatch events to clear the signal. The record is
  keyed by event, so a dispatch changes nothing.
- Do not pause the Tab contract to stop a settlement. A pause blocks only
  `deposit`, `open_session` and `register_key`, never `settle`,
  `settle_own`, claims or exits.
- Do not call `set_acceptor` once and treat the previous key as retired.
- Do not delete the record; acknowledge it.
- Do not name the reader or post addresses in a public issue or channel. Do
  not treat the reader as at fault on the record alone: a second deployment
  or a restore gives the same record.

## Settler not running

`/ops/chain` shows "Last settler run" with a warning after 30 minutes and an
alert after 24 hours. The age is the time since the last settler run that
ended without an error and did not fail. The settler records it on its
`settler` lease row (`chainLeases.lastOkAt`) after each such run, whether or
not anything was due. The cron runs every 10 minutes, so 30 minutes is three
missed runs. "None recorded" means no such run since this field was added.
With `SETTLEMENT_ENABLED=true`, "None recorded" is a warning at once: a
settler that fails from its first run (for example with
`TAB_SETTLER_UNAVAILABLE`, a saved secret that is not a seed) never records
a run. Right after settlement is switched on, the warning stays until the
first run, within 10 minutes.

The page is checked, not pushed: nobody is told unless someone opens it.
The failing runs themselves show only as failed function runs in the
deployment's logs.

The settler's own alerts (`TAB_SETTLER_*`) come from a run, so a settler
that does not run logs nothing. This age is read outside the settler.

Why it matters: a closing account's pairs are settled first. The reader can
withdraw 3 days after `withdraw_start` (`WITHDRAW_DELAY`). What is still
unsettled then can end `UNPAID`. The alert leaves two days.

From the command line:

```bash
bunx convex run chain/settlerStatus:readSettlerFreshness '{}'
```

Check, in order:

1. `SETTLEMENT_ENABLED` is `true` on the deployment. While it is off, the
   page says "Settlement is off" and the age grows on purpose.
2. The `settle due tab vouchers` cron has recent runs (dashboard cron jobs
   list), and its logs show no `TAB_SETTLER_UNAVAILABLE`,
   `TAB_SETTLER_RUN_FAILED` or `TAB_SETTLER_SIMULATION_FAILED`.
   `TAB_SETTLER_UNAVAILABLE` stops the run before the settlement cycle, so
   it logs no `TAB_SETTLER_RUN_FAILED`.
3. The settler's XLM balance (`TAB_SETTLER_BALANCE_LOW`).

Before a closing account's unlock, settle its pairs: turn settlement back
on. To settle at once rather than wait for the cron, run the settler once
(it also needs `SETTLEMENT_ENABLED=true`):

```bash
bunx convex run tabSettler:settleDue '{}'
```

## Testnet reset

Detection: the ledger sequence dropped below the highest ledger recorded for
the set, and the contract instances are gone. The indexer stops with
`RESET_DETECTED`.

1. Set `CHAIN_V2_ENABLED=false`.
2. Close the current `chainEpoch`. Unsettled tab receipts become `VOID_RESET`;
   the history keeps its labels.
3. Redeploy from the recorded commit:

   ```bash
   bun run contracts:redeploy-v2 --set integration --keys-dir <dir>            # detect and plan
   bun run contracts:redeploy-v2 --set integration --keys-dir <dir> --submit   # redeploy
   ```

   - The tool refuses unless the ledger sequence dropped. With the contracts
     still in place, archived entries need the restore tool instead. Missing
     instances without a ledger drop are not a reset: check the contract IDs,
     the RPC server and the TTL report.
   - If the redeploy stops after it has started, the old state is kept aside
     and the tool prints the deployment command that resumes from the new
     state. Run that command; it skips the steps already done.
   - It reuses the recorded commit, the reproducible build (rebuilt if the
     Wasm files changed), the constructor configuration and the set's keys,
     which Friendbot funds again. It keeps the old state as
     `deploy-state.before-reset-<date>.json`.
   - It runs the deployment steps: upload, deploy, read-back verification,
     smoke flows and the evidence document
     ([v2-testnet-deployment.md](../contracts/v2-testnet-deployment.md)),
     which is regenerated for the set. Commit the updated document.
   - Contract IDs come from the deployer key and a salt per set, contract and
     commit, so the same keys and commit give the same IDs after a reset.

4. Set the new values on the set's Convex deployment and start a new epoch:
   `INDEXER_START_LEDGER` (printed by the tool), a new `CHAIN_EPOCH`, and the
   contract IDs if they changed. The epoch must change even when the IDs did
   not. For the integration set, the deployment tool's `convex-env` step sets
   the values it owns; the owner sets the live set's values.
5. Run the TTL extension within 3 days.
6. Prompt authors to enable tips again.

## Roles, pause and unpause

Report (read-only): admin, pause state and role holders of each contract,
compared with the keys recorded at deployment.

```bash
bun run contracts:roles-v2 --set integration --keys-dir <dir>
```

Exit code 4 means a difference from the deployment, including a paused
contract.

Actions are dry runs unless `--submit` is given, and skip work already in
place:

| Action                     | Command options                                               | Signer     |
| -------------------------- | ------------------------------------------------------------- | ---------- |
| Pause (incident)           | `--action pause --contracts core,tab,nft`                     | `pauser`   |
| Unpause                    | `--action unpause --contracts core`                           | admin      |
| Grant a role               | `--action grant --role settler --account G… --contracts tab`  | admin      |
| Revoke a role              | `--action revoke --role settler --account G… --contracts tab` | admin      |
| Grant or revoke `upgrader` | `--action grant --role upgrader --account G…`                 | `upgrader` |

- Pause never blocks settlement, claims or exits.
- The tool refuses to revoke the last `upgrader`, because only an upgrader can
  grant the role.
- Settler rotation: grant `settler` to the new key, update the Convex env,
  revoke the old key, confirm one settlement with the new key.
- After a role change, run the TTL extension within 3 days: new role
  entries get the network minimum TTL (7 days on testnet).

## Rehearsal on a local network

Each tool also runs against a Stellar Quickstart standalone network, with
`QUILLTIP_NETWORK_GUARD_OPT_IN=local`, `NEXT_PUBLIC_STELLAR_NETWORK=LOCAL`, an
RPC URL on `localhost` and the passphrase `Standalone Network ; February 2017`.
The backfill tool then needs a local Convex backend
(`CONVEX_DEPLOYMENT=local:…` or `anonymous:…`). Deploy a local set first with
the deployment tool and a key directory of its own.
