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
| `CHANGED`          | The account changed between the snapshot and the write (a tip or an event). Run it again.                                                                                                                   |
| `INDEXER_BEHIND`   | The indexer has not applied the ledger the chain was read at. Wait, or fix the indexer.                                                                                                                     |
| `EVENTS_UNHANDLED` | A Tab event for this reader at or before that ledger is `pending` or `error`. Dispatch it first (`chain/indexer:redispatch`).                                                                               |
| `STALE_READ`       | The stored balance, or a settlement debit applied to it, comes from after the ledger read. Run it again.                                                                                                    |
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
