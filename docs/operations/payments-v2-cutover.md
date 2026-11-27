# Payments v2 cutover (testnet)

This runbook moves Quilltip payments from the v1 contracts to the payments v2
contracts (Core, Tab and Article NFT). It covers the preconditions, the ordered
steps for the backend and the site, the rollback of each stage and the checks
after the switch. It is written for an operator who has not worked on this
project before.

All payment activity described here is **Stellar testnet** activity. Testnet
XLM has no monetary value. Every tool and backend path named here refuses
mainnet.

Specification:
[06-app-integration.md, section 6.9](../architecture/v2/06-app-integration.md#69-migration-cutover-and-rollback),
[08-testing-and-deployment.md, sections 8.4 and 8.6](../architecture/v2/08-testing-and-deployment.md#84-testnet-deployment-procedure)
and
[07-security-and-recovery.md, section 7.4](../architecture/v2/07-security-and-recovery.md#74-failure-recovery).
Day-to-day contract operations are in the [chain runbook](chain-runbook.md).
Tracking issue: #451.

## Go or no-go

Start the window only when each line is true. Section 1 has the detail.

1. The open payment fixes are merged into the release commit, and the checks
   in section 1.3 pass on it.
2. The owner has decided the backend push method, and the push uses a deploy
   key whose `--dry-run` output names the live deployment (section 5.0.2).
3. A stage 0 snapshot of the live deployment can be taken, and the restore
   procedure in section 6.2 has been read.
4. The TTL extension of the new contract set (stage 3, step 2) is planned in
   the window. A newly deployed set reports its role entries as `due`.
5. The v1 admin key is available for stage 7, or the window runs without
   stage 7 and section 4.2 applies to v1 tips sent outside the app.
6. The author notice is ready (section 1.5).

## Terms

| Term                       | Meaning                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1                         | The earlier testnet tipping contract (`contracts/tipping`), its Horizon-based verification in Convex, and the earlier NFT flow. Its records stay in the database after cutover. |
| v2                         | The Core, Tab and Article NFT contracts, the Convex chain layer (`convex/chain/`, `convex/lib/chain/`) and the client modules in `lib/stellar/v2/`.                             |
| Integration deployment     | The non-production Convex deployment `efficient-tern-39`. It has its own v2 contract set (`integration`).                                                                       |
| Live deployment            | The Convex deployment that serves www.quilltip.me, `upbeat-mockingbird-579`. It gets its own v2 contract set (`live`) at cutover.                                               |
| Release commit             | The commit on `overhaul/v2` that is merged into `main` for the cutover. Tag it before stage 1.                                                                                  |
| Owner                      | The person who holds the live Convex deployment, the Vercel project and the live contract set keys. Only the owner changes the live deployment.                                 |
| Prepare switch (v1 and v2) | Convex environment variables that allow or refuse new payment records: `CHAIN_V1_PREPARES_ENABLED` for v1, `CHAIN_V2_ENABLED` for v2.                                           |

Repository tools refuse to deploy to the live deployment or to change its
environment, by design (`assertScriptConvexDeployAllowed`). Every change to the
live deployment in this runbook is an owner action in the Convex dashboard or
with the owner's own Convex CLI credentials.

## 1. Preconditions

Do not start stage 1 until every item is true. Record the evidence for each in
the cutover tracking issue.

### 1.1 Merged work

| Issue | Scope                                                         | Proof                                                                 |
| ----- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| #446  | Testnet deployment tool, one contract set per deployment      | Integration set recorded in `docs/contracts/v2-testnet-deployment.md` |
| #447  | Tab ledger, voucher acceptance, tab handlers and earnings     | Merged to `overhaul/v2`                                               |
| #456  | Event indexer, cursor, leases, Core handlers                  | Merged to `overhaul/v2`                                               |
| #457  | Read queries and earnings for direct and batch tips           | Merged to `overhaul/v2`                                               |
| #458  | Article registration and author change                        | Merged to `overhaul/v2`                                               |
| #459  | Operations tools (extend, restore, redeploy, roles, backfill) | [Chain runbook](chain-runbook.md) tools run on the integration set    |
| #465  | Tab settler                                                   | Merged to `overhaul/v2`                                               |
| #448  | Client tip flows (direct, highlight, batch)                   | Merged to `overhaul/v2`                                               |
| #449  | Tab UI                                                        | Merged to `overhaul/v2`                                               |
| #450  | NFT UI and NFT event handlers                                 | Merged to `overhaul/v2`                                               |
| #517  | v1 prepare switch and a separate v2 NFT variable              | Merged to `overhaul/v2`                                               |

### 1.2 Code that the cutover itself needs

These items are part of the release commit. Check each one in the code before
stage 1.

1. **v1 prepare switch** (#517). `CHAIN_V1_PREPARES_ENABLED`
   (`convex/lib/v1Prepares.ts`) gates the functions that start a new v1
   record: `tips:prepareArticleTip`, `highlightTips:prepareHighlightTip`,
   `highlightTips:create`, `nfts:mintNFT`, `nfts:transferNFT` and
   `nftMetadataUpload:uploadNftMetadataForMint`. `tips:sendTip` already
   refuses every call. Submit, retry, verification, recovery and read
   functions do not read the switch, so records prepared before the freeze
   still resolve. Unset, empty or `true` keeps v1 running; `false` pauses it;
   any other value also pauses. Check:
   `git grep -n requireV1PreparesEnabled -- convex` lists those six functions,
   and `scripts/tips/v1-prepare-switch.test.ts` passes.
2. **Client behaviour while `CHAIN_V2_ENABLED=false`.** With the v2 switch off,
   the release frontend either keeps the v1 tip and NFT flows or shows payments
   as unavailable. It never shows a v2 action that the backend refuses.
   Verify this on the integration deployment with the switch off.
3. **Client behaviour while `CHAIN_V1_PREPARES_ENABLED=false` and
   `CHAIN_V2_ENABLED=false`.** `chain/articles:getArticleTipAvailability`
   returns `paused`. The article tip area and the passage tip action show
   "Tips are paused for a short time while payments are updated." instead of
   the tip button. A direct call to a gated function returns the same message
   and creates nothing.
4. **Client behaviour while `CHAIN_V2_ENABLED=true`.** On a registered
   article, the tip buttons use the v2 flow (`tipsV2`), and the mint and
   transfer actions use the v2 NFT functions. Today
   `components/tipping/ArticleTipActionsInner.tsx` renders the v1
   `TipButton` for a registered article, so this needs the #448 and #450
   client work.
5. **Contract version backfill.** `chain/backfill:setContractVersionV1` is in
   the release commit (it is on `overhaul/v2` today).

### 1.3 Checks on the release commit

Run on a clean checkout of the release commit. Record the output.

```bash
bun install --frozen-lockfile
bun run check
bun run test:e2e:fixtures
bun run test:e2e:csp
bun run test:local-network
bun run test:local-network:tips-v2
git grep -nE 'NEXT_PUBLIC_TIPPING_CONTRACT_ID|TIPPING_CONTRACT_ID' -- app components lib/stellar/v2
```

- `bun run check` and both Playwright commands pass.
- The local network suites pass against a Stellar Quickstart standalone
  network (`QUILLTIP_NETWORK_GUARD_OPT_IN=local`).
- The last command prints nothing: no page, component or v2 module reads a
  v1 variable. The v1 code that still needs them (`lib/stellar/client.ts`,
  `lib/stellar/config.ts`) is outside the searched paths.
- CI on the release PR is green.

### 1.4 Integration rehearsal

On the integration deployment, with its own contract set, run the full cutover
once, including the rollback in section 6:

1. Every flow in section 7.1 completes once with the v2 switch on.
2. The rollback in section 6 (stages 5 and 6) is tested: v1 tips work again
   after the switches are reversed, and a tab reader can still withdraw.
3. `bun run contracts:extend-v2 --set integration --keys-dir <dir>` reports
   no `archived` entry.
4. `bun run contracts:roles-v2 --set integration --keys-dir <dir>` exits 0.
5. The snapshot restore in section 6.2 runs once on a development deployment
   that holds data from the release code, and its check passes.

### 1.5 People and material

- The owner is available for the whole window and holds: the live Convex
  deployment access, the Vercel project, and the key directory for the
  `live` contract set (created by stage 3).
- An operator has a Convex user ID in `OPS_USER_IDS` on the live deployment,
  so `/ops/chain` shows the indexer status.
- A snapshot of the live deployment exists from the day of the cutover
  (Convex dashboard, **Settings → Snapshot export**, or
  `bunx convex export --include-file-storage --path <file>.zip` with the
  credential from section 5.0.2). Keep it outside the repository. Stage 0
  takes the snapshot used for a restore (section 6.2).
- Authors were told in advance that they must verify their wallet and press
  **Enable tips** on each article after the switch (section 4.3). The owner
  decides who sends this notice and when, relative to stage 6.

### 1.6 Owner decisions recorded before stage 0

Record each answer in the cutover tracking issue.

1. **Backend push method.** The deployment type of the live deployment
   (development or production) and the deploy key the owner uses for it.
   Section 5.0.2 gives the procedure for each case. The repository does not
   record either, so the owner confirms them before stage 0.
2. **v1 maintenance jobs.** Whether `legacyTipCleanup:run` and
   `authorEarningsBackfill:run` were applied on the live deployment before is
   not recorded. Do not assume either way. After stage 1, run both as dry runs
   (stage 1, step 5). Their output shows what needs correcting on that day.
   Apply them only if the operator decides to, and record the decision.
3. **v1 admin key.** Whether the v1 tipping contract's admin key is available.
   Without it, stage 7 is skipped and section 4.2 applies.
4. **Release scope.** One combined release of `overhaul/v2` in one announced
   window: backend first, site within minutes (section 5.0).
5. **Author notice.** Who tells authors to verify their wallet and enable
   tips, and when.

## 2. Schema and API compatibility

Checked by comparing `convex/schema.ts`, `convex/lib/chain/schema.ts`,
`convex/lib/chain/nftSchema.ts` and the exported Convex functions between
`main` and `overhaul/v2`.

### 2.1 Schema changes

Every v2 change to an existing table is additive or relaxes a field:

- **New tables:** `chainConfig`, `chainArticles`, `chainSubmissions`,
  `chainEvents`, `chainCursor`, `chainLeases`, `tabAccounts`,
  `tabSessionKeys`, `tabReceipts`, `tabVouchers`, `tabSettlements`, and
  `walletChallenges`. `overhaul/v2` also adds `feedback` and `rateLimits`,
  which are not payment tables but ship in the same release.
- **New optional fields:** the v2 fields on `tips` and `highlightTips`
  (`contractVersion`, `channel`, `clientRef`, base-unit amounts, review
  fields and others, from `tipChainFields`), `earningsAppliedAt` and
  `earningsSkipReason`; the base-unit fields on `authorEarnings`;
  `ownerAddress`, `contractVersion`, `txHash`, `chainVerifiedAt` and the v2
  mint fields (`nftChainFields`) on `articleNFTs`; `fromAddress`,
  `toAddress` and the v2 event fields (`nftTransferChainFields`) on
  `nftTransfers`; `stellarAddressVerifiedAt`, `stellarAddressVerifiedNetwork`,
  `emailVerificationTime` and `isTestAccount` on `users`;
  `contentHashSchema` and `arweaveContentHash` on `articles`; `name`,
  `interest` and `userId` on `waitlist`.
- **Fields that become optional:** `highlightTips.stellarTxId`,
  `highlightTips.stellarNetwork`, `highlightTips.stellarMemo`,
  `highlightTips.processedAt`, `articleNFTs.mintedBy`,
  `articleNFTs.currentOwner`, `articleNFTs.tipThreshold`,
  `articleNFTs.totalTipsAtMint`, `nftTransfers.fromUserId` and
  `nftTransfers.toUserId`.
- **New indexes** on `users`, `tips`, `highlightTips`, `articleNFTs` and
  `nftTransfers`. No index is removed.
- **Nothing is removed or narrowed.** No required field is added to an
  existing table.

Result: the v2 schema accepts every existing row, so the stage 1 push needs no
data step.

### 2.2 Rolling the backend code back to `main`

Pushing `main`'s schema after v2 code has run is **not supported** and is not
a rollback path. Convex checks every existing document against a new schema
and refuses the push if one does not match (`✖ Schema validation failed.`).

The push fails as soon as the release code has written a field that `main`'s
schema does not have. That happens early, before any v2 payment:

- the first wallet verification after stage 1 writes
  `users.stellarAddressVerifiedAt` and `stellarAddressVerifiedNetwork`;
- the stage 4 backfill writes `contractVersion` on existing `tips`,
  `highlightTips` and `articleNFTs` rows.

From stage 6, v2 rows add more reasons:

- a `highlightTips` row without `stellarTxId`, `stellarNetwork`, `stellarMemo`
  or `processedAt` (v2 batch and tab rows);
- an `articleNFTs` row without `mintedBy` or `currentOwner` (a v2 NFT whose
  minter or owner address is not a Quilltip user), or without `tipThreshold`
  or `totalTipsAtMint` (every v2 NFT row, which keeps base-unit totals
  instead);
- an `nftTransfers` row without `fromUserId` or `toUserId` (a v2 transfer
  between addresses that are not Quilltip users).

Rows in the new tables are also outside `main`'s schema. Roll back with the
switches (section 6), and keep the release code deployed. The only way back
to `main`'s code is the stage 0 snapshot restore in section 6.2, which also
discards everything written since stage 0.

### 2.3 `main`'s frontend against the release backend

`main`'s frontend calls 63 public functions. All of them exist on
`overhaul/v2` with compatible arguments; the only function removed is the
internal `tips:confirmTip`. Return values only gain fields
(`contractVersion`, `byVersion`, `totalsBaseUnits` and others).

Exceptions. These are behaviour changes of the release backend that `main`'s
frontend does not handle:

| Function                                                        | Change                                                                                                           | Effect on `main`'s frontend                                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `users:updateProfile` with `stellarAddress`                     | Refused. A wallet is linked only through `walletLink:createWalletChallenge` and `verifyWalletChallenge`.         | Linking a wallet in settings fails. Removing a wallet still works.                                                          |
| `tips:prepareArticleTip`, `highlightTips:prepareHighlightTip`   | Need a **verified** author wallet (`stellarAddressVerifiedAt` set). Wallets linked before #483 are not verified. | v1 tips fail with "Author has not verified a receiving wallet" until the author verifies, which needs the release frontend. |
| `users:getUserByUsername`                                       | Returns `stellarAddress` only when it is verified.                                                               | Profiles show no wallet for unverified authors.                                                                             |
| `articles:saveDraft` on a published article                     | Refused with the published-article lock (`articles:updateArticle` and `uploads:updateArticleCoverImage` too).    | Saving edits to a published article from `main`'s editor fails.                                                             |
| `tips:getArticleTips`, `getUserSentTips`, `getUserReceivedTips` | Return at most 100 rows, and the public list returns a reduced set of fields.                                    | No breakage found: `main`'s frontend does not call `getArticleTips`; the other two keep every field.                        |

Consequence: deploy the release frontend (stage 2) right after the release
backend (stage 1). Keep the gap to minutes, and do not leave `main`'s frontend
serving against the release backend. Run both stages in one announced window
at a low-traffic time, with the Vercel build of the release commit ready to
promote before the backend push starts.

The backend is not changed to accept unverified wallets during this gap. That
would undo the wallet ownership check, and it would stay in effect until v2 is
switched on, not only for the gap.

### 2.4 The release frontend against `main`'s backend

The release frontend calls functions that `main`'s backend does not have
(`walletLink:*`, `tipsV2:*`, `tabs:*`, `chain/*`, `tips:listMySentTips` and
others). It fails on those pages. Therefore the backend always goes first, and
a frontend rollback in Vercel never needs a backend rollback.

### 2.5 NFT contract variables

The v1 NFT client (`lib/stellar/config.ts`) reads
`NEXT_PUBLIC_NFT_CONTRACT_ID`. The v2 client (`lib/stellar/v2/config.ts`)
reads `NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID` (#517), so neither can point at
the other's contract. Leave `NEXT_PUBLIC_NFT_CONTRACT_ID` at its v1 value
until the v1 code is removed. On Convex, only v2 code reads
`NFT_CONTRACT_ID`.

## 3. Environment variables and switches

### 3.1 Convex (live deployment)

Set by the owner, in this order. Secrets go in the Convex dashboard
(**Settings → Environment Variables**), never on a command line or in a file
in the repository.

| Order | Variable                                                                      | Value                                                          | Stage | Effect when set                                                                            |
| ----- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| 1     | `STELLAR_NETWORK`                                                             | `TESTNET`                                                      | check | Already set. Every v2 path calls `assertBackendTestnet()` and refuses anything else.       |
| 2     | `STELLAR_RPC_URL`, `NETWORK_PASSPHRASE`                                       | Optional. Testnet RPC URL; `Test SDF Network ; September 2015` | 3     | The guard refuses mainnet values. Defaults are the public testnet values.                  |
| 3     | `CHAIN_V2_ENABLED`                                                            | `false`                                                        | 3     | Set it explicitly to `false` before any other v2 value.                                    |
| 4     | `CHAIN_V1_PREPARES_ENABLED`                                                   | `true`                                                         | 3     | Explicit current state.                                                                    |
| 5     | `CHAIN_EPOCH`                                                                 | For example `testnet-2026-12-15`                               | 3     | Every new chain row carries it. Change it only with a new contract set.                    |
| 6     | `CORE_CONTRACT_ID`, `TAB_CONTRACT_ID`, `NFT_CONTRACT_ID`, `TOKEN_CONTRACT_ID` | The `live` set, from `docs/contracts/v2-testnet-deployment.md` | 3     | The hourly `refresh chain config` cron starts caching the contract views.                  |
| 7     | `INDEXER_START_LEDGER`                                                        | The `live` set's Core deploy ledger                            | 3     | With `CORE_CONTRACT_ID`, the indexer starts on the next minute.                            |
| 8     | `OPS_USER_IDS`                                                                | Operator Convex user IDs                                       | 3     | `/ops/chain` shows the status to those users.                                              |
| 9     | `TAB_ACCEPTOR_SECRET`                                                         | The `live` set's acceptor seed                                 | 3     | Read only when `SETTLEMENT_ENABLED=true`.                                                  |
| 10    | `TAB_SETTLER_SECRET`                                                          | The `live` set's settler secret                                | 3     | Read only when `SETTLEMENT_ENABLED=true` and `TAB_CONTRACT_ID` are set.                    |
| 11    | `TAB_DAILY_LIMIT`, `TAB_TIP_MAX`                                              | Optional. Defaults `200000000`, `50000000`                     | 3     |                                                                                            |
| 12    | `SETTLEMENT_ENABLED`                                                          | `true`                                                         | 3     | The settler cron runs and tab tips can be accepted. Nothing is due until a tab tip exists. |
| 13    | `INTERNAL_ACCOUNT_EMAIL_DOMAINS`                                              | Optional. Staff email domains                                  | 3     | New accounts on those domains are flagged as internal. Not a payment setting.              |
| 14    | `ARWEAVE_ENABLED`, `ARWEAVE_WALLET_KEY`                                       | Unchanged                                                      | —     | See section 3.3.                                                                           |
| 15    | `CHAIN_V1_PREPARES_ENABLED`                                                   | `false`                                                        | 5     | New v1 records are refused. Submits and verification continue.                             |
| 16    | `CHAIN_V2_ENABLED`                                                            | `true`                                                         | 6     | v2 prepare functions accept new records.                                                   |
| 17    | `RECONCILE_TIPS_ENABLED`, `TIPPING_CONTRACT_ID`, `HORIZON_URL`                | Unchanged                                                      | —     | v1 verification needs them until the v1 code is removed (section 8).                       |

Variables 9 to 12 are read only after the network guard passes. Never put a
secret in `.env.example`, a commit, a PR or a log.

### 3.2 Vercel (site)

`NEXT_PUBLIC_*` values are built into the site, so a change needs a new
deployment. Set these on the production environment before stage 2:

| Variable                                                                                                                              | Value          | When                                        |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------- |
| `NEXT_PUBLIC_STELLAR_NETWORK`                                                                                                         | `TESTNET`      | Already set                                 |
| `NEXT_PUBLIC_STELLAR_RPC_URL`, `NEXT_PUBLIC_NETWORK_PASSPHRASE`                                                                       | Testnet values | Stage 2                                     |
| `NEXT_PUBLIC_CORE_CONTRACT_ID`, `NEXT_PUBLIC_TAB_CONTRACT_ID`, `NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID`, `NEXT_PUBLIC_TOKEN_CONTRACT_ID` | The `live` set | Stage 2 (after stage 3 when the set is new) |
| `NEXT_PUBLIC_NFT_CONTRACT_ID` (v1 NFT)                                                                                                | Unchanged      | Removed with the v1 code (section 2.5)      |
| `NEXT_PUBLIC_TIPPING_CONTRACT_ID`, `NEXT_PUBLIC_PLATFORM_ADDRESS`, `NEXT_PUBLIC_HORIZON_URL`                                          | Unchanged      | Removed with the v1 code                    |

If the live contract set is deployed after the site, rebuild the site once the
contract IDs are set.

### 3.3 Arweave

Leave `ARWEAVE_ENABLED` as it is on the live deployment. The release uploads the
canonical article bytes, and registration passes the Arweave ID on chain only
when the uploaded body reproduces the article's content hash
(`arweaveContentHash` equals `contentHash`). An article uploaded before the
release has a legacy hash and registers without an Arweave ID. Arweave uploads
are permanent: do not publish test articles on the live deployment while
`ARWEAVE_ENABLED=true`.

## 4. Data and history

### 4.1 Existing records stay visible and labelled

- **Tips and highlight tips.** A row without `contractVersion` is read as
  `v1` (`convex/lib/tipReads.ts`). The stage 4 backfill writes
  `contractVersion: 'v1'` on every existing row, so the label no longer
  depends on that default. v1 rows count when their status is `CONFIRMED`; v2
  rows count when `CONFIRMED` or `MISMATCH`. History views show v1 rows with
  a "Testnet v1" label.
- **Earnings.** `authorEarnings` keeps its cent totals for v1. v2 adds
  base-unit fields per token and `v2TipCount`/`v2EarnedCents`. The
  `sync v2 tip earnings` cron credits each v2 row once.
- **Article totals.** v2 totals come from `chainArticles.totals` (the
  contract's own running total, including tips made outside the app). v1
  totals remain in the tip rows and article counters.
- **NFTs.** Existing `articleNFTs` rows are database records of the v1 flow.
  They show as "v1 record". NFT eligibility for v2 uses only on-chain v2
  totals, so an author can mint a v2 NFT once the article reaches the v2
  threshold. v1 rows are never deleted.

### 4.2 In-flight v1 tips at the switch

A v1 tip goes through: prepare (an intent valid for 15 minutes), wallet
signature, submit, then server verification against Horizon.

- The transaction's `maxTime` is the intent's expiry, so no v1 transaction
  prepared before the freeze can land more than 15 minutes after it.
- With `CHAIN_V1_PREPARES_ENABLED=false`, prepare is refused. Submit and
  verification stay open, so a reader who signed before the freeze still gets
  the tip recorded.
- Stuck verifications are retried by crons: article tips every 10 minutes,
  highlight tips every 6 hours. Stage 5 waits for both. A legacy pending
  highlight tip (one without a stored intent) is not verified again: the
  highlight recovery marks it `FAILED` with
  `legacy_pending_highlight_tip_quarantined`, and reports it as
  `quarantined`.
- A v1 tip sent directly to the v1 contract outside the app after the switch
  is not recorded. Stage 7 pauses the v1 contract to stop this when the v1
  admin key is available.
- A v1 NFT mint uploads its metadata, mints on the v1 NFT contract, then
  records the mint with `nfts:mintNFT`. The upload and the record are both
  refused while v1 is paused. A mint whose upload ran before the freeze and
  whose record arrives after it exists on the v1 contract without a database
  record; the author sees an error. The window is the time the author takes
  to sign.

### 4.3 Articles and authors after the switch

- An article accepts v2 tips only after its author registers it ("Enable
  tips", `chain/articles:prepareRegistration`). Until then it shows tips as
  unavailable. `tips:canTip` with `articleId` returns `NOT_REGISTERED`.
- Registration needs a verified wallet. Wallets linked before wallet
  verification shipped are not verified; the author verifies once in
  settings.

## 5. Cutover steps

Each stage lists the action, the check that proves it worked, and its
rollback. Do not start a stage until the previous stage's check passes.

### 5.0 The release window

#### 5.0.1 Plan

The release is one combined release of `overhaul/v2` (payments v2 and the
other work on that branch) in one announced window at a low-traffic time.
The backend goes first; the site follows within minutes.

The times below were measured in a rehearsal of every stage on a disposable
local Convex backend with a new testnet contract set and a small data set.
Live data is larger, so the snapshot, push and backfill steps can take longer.

| Stage | Work                                                  | Measured                                                                                           |
| ----- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 0     | Tag, snapshot export                                  | Snapshot 2 s                                                                                       |
| 1     | `--dry-run`, push, cron check, maintenance dry runs   | Dry run 19 s, push 32 s, cron check 2 min                                                          |
| 2     | Site deploy and checks                                | Checks about 5 min, plus the Vercel build                                                          |
| 3     | Contract set, TTL extension, variables, indexer check | Deploy 861 s, extension 28 s, variables 8 s, indexer `OK` within 70 s; config refresh up to 1 hour |
| 4     | Contract version backfill                             | 8 s                                                                                                |
| 5     | Freeze, 15-minute wait, drain, backfill again         | 15 min 17 s                                                                                        |
| 6     | Switch on v2, section 7.1                             | Registration indexed in 17 s, direct tip confirmed in 35 s; about 15 min for the full 7.1 list     |
| —     | Rollback B, if needed                                 | 54 s                                                                                               |
| —     | Snapshot restore (section 6.2), if needed             | About 1 min, plus the Vercel rollback                                                              |

Plan about 1 hour 15 minutes from stage 0 to the end of stage 6, plus the
owner's own checks. Stage 3 can run before the window (its contract set is
unused while `CHAIN_V2_ENABLED=false`), which shortens the window by about
20 minutes.

#### 5.0.2 Backend push procedure

The live deployment's type (development or production) and the owner's
credential for it are an owner decision (section 1.6, item 1). The procedure
below is the same for both types. It uses a deploy key because only
`convex deploy` has a `--dry-run`, and the dry run prints the target before
anything is pushed.

1. Get a deploy key for the live deployment itself:
   - production-type deployment: a production deploy key (dashboard,
     **Settings → Deploy keys**);
   - development-type deployment: a development deploy key for that
     deployment (dashboard, **Settings → Deploy keys**, or
     `npx convex deployment token create <deployment>` with the owner's login).
2. In a clean checkout of the tagged release commit, after
   `bun install --frozen-lockfile`, put the key in the environment without
   writing it to the shell history, and clear any other target:

   ```bash
   unset CONVEX_DEPLOYMENT CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
   read -rs CONVEX_DEPLOY_KEY && export CONVEX_DEPLOY_KEY
   bunx convex deploy --dry-run
   ```

3. Read the dry-run output. It starts with `Deploying code to deployment:`
   and the deployment URL. Continue only if that is
   `https://upbeat-mockingbird-579.convex.cloud`. If it names any other
   deployment, stop and get the right key. For the release commit the dry run
   also lists new indexes, ends with `Would have deployed Convex functions`
   and prints `Change the server's version for Node.js actions:`; that line
   is expected.
4. Push with the same shell: `bunx convex deploy`.

Do not push with only a CLI login and `CONVEX_DEPLOYMENT` set:
`convex deploy` then targets the project's **production** deployment, which
may not be the live deployment. `convex dev --once` pushes to the deployment
in `CONVEX_DEPLOYMENT` but has no dry run.

Use the same key for the stage 0 export, the stage 1 and stage 4
`convex run` calls and any restore (section 6.2), so that every command
reaches the same deployment. Unset `CONVEX_DEPLOY_KEY` at the end of the
window.

### Stage 0. Freeze and tag

1. Stop merges to `overhaul/v2` except cutover fixes.
2. Tag the release commit: `git tag payments-v2-cutover.1 <sha>` and push the
   tag.
3. Take the live deployment snapshot with file storage, outside the
   repository: `bunx convex export --include-file-storage --path <file>.zip`
   (section 5.0.2 for the credential), or a dashboard backup. Record the
   live deployment's environment variable names and values in the owner's
   password store: a snapshot does not contain them.

**Check:** the tag points to the commit whose checks are recorded in 1.3, and
the snapshot file opens (`unzip -l <file>.zip` lists one folder per table and
`_storage`).
**Rollback:** none needed.

### Stage 1. Release backend on the live deployment (switches off)

1. Confirm on the live deployment: `CHAIN_V2_ENABLED` is unset or `false`,
   and no v2 contract ID is set.
2. Confirm in Vercel that the release frontend can be held back until
   stage 2. The default plan: do not merge the release PR yet; the backend
   goes first. Alternative: turn off automatic production promotion for the
   window, merge, and promote the build in stage 2.
3. The owner pushes the tagged release commit's functions and schema with
   the procedure in section 5.0.2 (dry run, confirm the target, push).
4. Merge the release PR (`overhaul/v2` into `main`) right after the push, and
   continue with stage 2. With the default plan, Vercel builds and promotes
   `main` on merge, so the site follows within minutes. Never merge before
   the push: the release frontend fails against `main`'s backend
   (section 2.4).
5. Run the v1 maintenance jobs as dry runs (section 1.6, item 2):

   ```bash
   bunx convex run legacyTipCleanup:run '{"table":"tips"}'
   bunx convex run legacyTipCleanup:run '{"table":"highlightTips"}'
   bunx convex run authorEarningsBackfill:run '{"dryRun":true}'
   ```

   `legacyTipCleanup:run` exists only in the release code, so it runs after
   the push. Both are dry runs with these arguments. Record the output.
   Apply them (`"apply": true` for `legacyTipCleanup:run`, page by page with
   `cursor`; `"dryRun": false` for `authorEarningsBackfill:run`) only if the
   operator decides to, before stage 4.

**Check:**

- The push completes with no schema error.
- Convex dashboard, **Functions**: `chain/indexer:pollEvents`,
  `tabSettler:settleDue` and `tipEarnings:syncV2TipEarnings` exist. Their
  cron logs show that they return without work (no contract configured).
  Without v2 settings the five v2 crons make no RPC call and write no row
  (`scripts/chain/crons-unconfigured.test.ts`). Together they add about
  3,800 short function calls a day (indexer and earnings sync every minute,
  recheck every 2 minutes, settler every 10 minutes, config refresh hourly).
- A release-only public query answers:
  `bunx convex run chain/config:getChainConfig` returns `"v2Enabled": false`
  and no contract IDs. (`/api/health` ships with the release frontend, so it is checked in
  stage 2, not here.)

**Rollback:** set `CHAIN_V2_ENABLED=false` (already) and leave the code. The
v2 crons do nothing without contract IDs. Do not push `main`'s previous schema
(section 2.2). A defect in non-payment code is fixed forward.

### Stage 2. Release frontend

1. In Vercel, confirm the production environment values from section 3.2.
2. Let the production deployment of the merge commit finish, or promote it.

**Check:**

- `GET /api/health` reports the release commit and `TESTNET`.
- A signed-in user can open settings and verify a wallet (wallet challenge).
- With `CHAIN_V2_ENABLED=false`, a v1 article tip to a verified author
  completes and appears in the tipper's history as v1.
- The browser console shows no Content Security Policy violation on the
  article, settings and dashboard pages.

**Rollback:** Vercel **Instant Rollback** to the previous production
deployment. The backend stays on the release code; the section 2.3 exceptions
then apply, so roll forward again as soon as possible. Use it only before
stage 5. `main`'s frontend does not read the paused state: from stage 5 it
still shows the v1 tip button, and the tip then fails at prepare. After
stage 5, fix the site forward instead.

### Stage 3. Live contract set and v2 environment

1. Deploy the `live` contract set from the release commit, on a machine that
   holds the owner's key directory, following section 8.4 of the specification:

   ```bash
   export QUILLTIP_NETWORK_GUARD_OPT_IN=testnet
   export NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
   export NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
   export NEXT_PUBLIC_NETWORK_PASSPHRASE='Test SDF Network ; September 2015'
   bun run contracts:deploy-v2 --set live --commit <sha> --keys-dir <dir>
   ```

   The command has no dry run: the `keys` step funds new accounts with
   Friendbot and the later steps send testnet transactions. It runs the steps
   `build`, `keys`, `upload`, `deploy`, `verify`, `smoke` and `evidence` in
   order: it builds reproducibly, uploads, deploys, reads back every view, runs
   the smoke flows and writes the `live` section of
   `docs/contracts/v2-testnet-deployment.md`.
   Each step is recorded in `<dir>/live/deploy-state.json`, so a rerun resumes
   after the last completed step; `--steps` runs a subset (for example
   `--steps build` to check the build first). Commit the evidence document in
   a docs-only PR.

2. Extend the new set's storage. A newly deployed set reports its role
   entries as `due` (about 7 days left against the 30-day threshold), so the
   TTL check below fails until they are extended:

   ```bash
   bun run contracts:extend-v2 --set live --keys-dir <dir> --submit
   ```

3. The owner sets variables 2 to 12 of section 3.1 on the live deployment, in
   that order, with `CHAIN_V2_ENABLED=false`.
4. The owner sets the Vercel contract IDs from section 3.2 and redeploys the
   site if stage 2 already ran.

**Check:**

- `bun run contracts:roles-v2 --set live --keys-dir <dir>` exits 0.
- `bun run contracts:extend-v2 --set live --keys-dir <dir>` (report only)
  ends with `archived 0, due 0`. One `absent` entry for a claimed balance is
  normal.
- Within 2 minutes, `/ops/chain` shows the cursor with status `OK`, the
  `live` contract IDs, `lagLedgers` under 720 and a `lastRunAt` within the
  last 2 minutes. With `INDEXER_START_LEDGER` set to the Core deploy ledger,
  the indexer also reads the deploy's own smoke flows; their events show as
  `orphan` (their articles are not in this database). That is expected.
- `chain/config:getChainConfig` returns the `live` IDs, `paused: false` for
  each contract and a `refreshedAt` time. The hourly cron fills it; to load
  it at once, run the internal action `chain/config:refreshChainConfig` from
  the dashboard. Do not start stage 6 before this check passes: until the
  config is loaded, v2 tips refuse with `CHAIN_CONFIG_MISSING`.
- The Convex logs show no `TAB_ACCEPTOR_MISMATCH` and no
  `TAB_SETTLER_RUN_FAILED`.

**Rollback:** set `SETTLEMENT_ENABLED=false` and remove the contract IDs and
`INDEXER_START_LEDGER`. Nothing user-facing uses the set while
`CHAIN_V2_ENABLED=false`. The indexer then stops, but its cursor keeps
status `OK`; check that `lastRunAt` stops moving and the contract IDs are
empty. Setting the variables again resumes it from its cursor. If the set
itself is wrong, deploy a new set with a new `CHAIN_EPOCH`.

### Stage 4. Contract version backfill

Run the internal backfill on the live deployment. It is a dry run unless
`"apply": true`. Run it in this order: dry run, apply, dry run again.

```bash
bunx convex run chain/backfill:setContractVersionV1 '{"table":"tips"}'
bunx convex run chain/backfill:setContractVersionV1 '{"table":"tips","apply":true}'
```

Each call handles one page. While the result has `isDone: false`, call again
with `"cursor"` set to the returned `continueCursor`. Repeat for
`"table":"highlightTips"` and `"table":"articleNFTs"`. The owner runs these
with credentials for the live deployment.

**Check:** the final dry run for each table reports `"toUpdate": 0`.
**Rollback:** not needed. The field is optional, and an unset value already
reads as `v1`.

v1 rows confirmed after this stage (tips in flight at the freeze) have no
`contractVersion`. Stage 6, step 1 runs this backfill once more after the
drain.

### Stage 5. Freeze v1 and drain

1. Set `CHAIN_V1_PREPARES_ENABLED=false`. Record the time as T.
2. Wait at least 15 minutes after T (the v1 intent lifetime).
3. Drain the v1 verifications. In the Convex dashboard **Data** view, filter:
   - `tips`: `status` is `PENDING` or `CONFIRMING`;
   - `highlightTips`: `status` is `PENDING`;
   - `articleTipIntents` and `highlightTipIntents`: `expiresAt` greater than
     now.

   To avoid the 6-hour wait for highlight tips, the owner can run
   `reconcileTips:recoverStuckPendingHighlightTips` and
   `reconcileTips:recoverStuckPendingArticleTips` once from the dashboard.

**Check:** every filter returns 0 rows. An article page shows "Tips are
paused for a short time while payments are updated." in place of the tip
button, and so does the passage tip action. For the article's author or NFT
owner, the NFT actions tab shows "NFT actions are paused for a short time
while payments are updated." instead of the mint and transfer buttons.
**Rollback:** set `CHAIN_V1_PREPARES_ENABLED=true`. No data step.

### Stage 6. Switch on v2

1. Run the stage 4 backfill again for the three tables (dry run, apply, dry
   run), so that the v1 rows confirmed during the drain carry
   `contractVersion: 'v1'`.
2. Set `CHAIN_V2_ENABLED=true` on the live deployment. Record the time.
3. Run the post-cutover verification (section 7) at once.

**Check:** the backfill's final dry runs report `"toUpdate": 0`, and
section 7.1 passes.
**Rollback:** section 6, stage B.

### Stage 7. Pause the v1 contracts

Only if the v1 admin key is available. The v1 tipping contract has
`pause(admin)`. Run it on testnet with the Stellar CLI, passing
`--network testnet`, the testnet RPC URL and the testnet passphrase
explicitly, signed by the v1 admin.

**Check:** `is_paused` returns `true`, and a simulated v1 `tip_article` call
fails with the contract's paused error, `Error(Contract, #1000)`.
**Rollback:** `unpause(admin)` with the same key. Required before a rollback
to v1 payments (section 6, stage B).

### Stage 8. Hold for one release

Keep the v1 code deployed for one release after stage 6. During this time
the rollback in section 6 stays available. Then run the removal PRs
(section 8).

## 6. Rollback plan

| Stage reached                      | Rollback                                                                                                                                                                                                                                                                                     | Data step                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Stages 1 to 5                   | Reverse the last setting: `CHAIN_V1_PREPARES_ENABLED=true`, `SETTLEMENT_ENABLED=false`, remove the v2 contract IDs. Frontend: Vercel Instant Rollback only if the site is broken.                                                                                                            | None                                                                                                                                                                                                                                                                                                                                                                                                               |
| B. Stage 6 or 7                    | 1. Set `CHAIN_V2_ENABLED=false` and `CHAIN_V1_PREPARES_ENABLED=true`. 2. Unpause v1 if it was paused. 3. Keep the indexer, the settler and `SETTLEMENT_ENABLED=true`. 4. Pause the v2 Tab: `bun run contracts:roles-v2 --set live --keys-dir <dir> --action pause --contracts tab --submit`. | None. v2 rows stay and remain visible. Accepted vouchers still settle. The contract still lets readers withdraw and revoke keys and writers claim (I-27), but the app's tab operations (`tabs:prepareWithdrawStart`, `prepareWithdraw`, `prepareRevokeKey` and the others) refuse with `CHAIN_V2_DISABLED` while `CHAIN_V2_ENABLED=false`, so during this rollback those actions need a wallet or the Stellar CLI. |
| C. After stage 8 (v1 code removed) | No switch rollback. A return to v1 means restoring the removed code from Git in a new release.                                                                                                                                                                                               | Yes: any v2 activity since the switch must be kept; nothing is migrated back.                                                                                                                                                                                                                                                                                                                                      |

**Point after which rollback needs a data step:** the first removal PR that
drops v1 code or tables (section 8). Until then every rollback is a setting.

Rollback B does not stop v2 records that are already in flight. The
`recheck pending chain submissions` cron and the indexer still resolve them,
because verification does not depend on `CHAIN_V2_ENABLED`.

Never roll back by pushing `main`'s earlier backend code (section 2.2).

### 6.1 Return to v2 after rollback B

1. Find and fix the cause of rollback B.
2. Unpause the v2 Tab:
   `bun run contracts:roles-v2 --set live --keys-dir <dir> --action unpause --contracts tab --submit`.
   The report then shows `tab paused false`.
3. If stage 7 ran before the rollback, pause the v1 contract again (stage 7).
4. Run stage 5 again: set `CHAIN_V1_PREPARES_ENABLED=false`, record T, wait
   15 minutes, drain.
5. Run stage 6 again, including its backfill step: v1 tips made during the
   rollback have no `contractVersion`.

### 6.2 Snapshot restore (last resort)

The switches cover every planned rollback. Restore the stage 0 snapshot only
if the live data itself must go back to its stage 0 state, for example after
a defect that wrote wrong data. A restore discards every record written since
stage 0, including real testnet tips, so the owner decides it.

What a snapshot holds: every table's documents with their IDs and creation
times, and, when exported with `--include-file-storage`, the stored files.
It does not hold the functions, the schema, the environment variables, or
pending scheduled functions (Convex documentation, data import and export).

Procedure, with the credential from section 5.0.2, in a checkout of `main`'s
previous release commit (the code that ran at stage 0):

1. Stop new writes from the v2 code. Set the environment variables back to
   their stage 0 values: remove `CHAIN_V2_ENABLED`,
   `CHAIN_V1_PREPARES_ENABLED`, `CHAIN_EPOCH`, the four contract IDs,
   `INDEXER_START_LEDGER`, `OPS_USER_IDS`, `SETTLEMENT_ENABLED`,
   `TAB_ACCEPTOR_SECRET`, `TAB_SETTLER_SECRET` and the other variables set in
   stage 3. Without this, the release crons keep writing chain rows between
   the import and the code push.
2. Import the snapshot over all data:

   ```bash
   bunx convex import --replace-all -y <stage0-file>.zip
   ```

   `--replace-all` replaces every table in the snapshot and clears tables
   that are in the deployed schema but not in the snapshot. Document IDs,
   creation times and stored files come back as they were.

3. Push `main`'s previous code: `bunx convex deploy --dry-run`, confirm the
   target, then `bunx convex deploy`. This push succeeds only after step 2;
   before it, the release rows fail `main`'s schema (section 2.2).
4. Import the snapshot once more with the same command. Under `main`'s
   schema this deletes the v2 tables (they are in neither the snapshot nor the
   schema) and any row written between steps 2 and 3.
5. In Vercel, roll the site back to the previous production deployment
   (stage 2 rollback).

**Check:** export the restored deployment
(`bunx convex export --include-file-storage --path <after>.zip`) and compare
it with the stage 0 file: the same table list, and for each table the same
row count, document IDs and content. Environment variable names match the
list recorded at stage 0. The `_scheduled_functions` history from the
release code stays (a snapshot does not replace it); confirm that no entry is
`pending`, or cancel it in the dashboard before step 3.

Measured on a disposable local backend with a small data set: step 1
13 s, step 2 4 s, step 3 24 s, step 4 10 s; about 1 minute in all, plus the
Vercel rollback. Every table, ID, content hash and stored file matched the
stage 0 file after step 4. A cloud deployment with live data takes longer;
the owner confirms the procedure once on a development deployment before
the window.

## 7. Post-cutover verification

### 7.1 One transaction per flow

Use test accounts on the live site, funded with testnet XLM from Friendbot.
Flag them as test accounts (`testAccounts:setTestAccount`). For each flow,
record the transaction hash and confirm the record in Convex and the event in
`chainEvents`.

| Flow                  | Expected record                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Wallet verification   | `users.stellarAddressVerifiedAt` set                                                          |
| Article registration  | `chainArticles.status` is `REGISTERED`                                                        |
| Direct article tip    | `tips` row `contractVersion: 'v2'`, `channel: 'direct'`, `status: 'CONFIRMED'`                |
| Highlight tip         | `highlightTips` row `contractVersion: 'v2'`, `status: 'CONFIRMED'`                            |
| Batch tip             | One `chainSubmissions` row, several tip rows sharing the transaction hash                     |
| Open tab and deposit  | `tabAccounts.status` is `OPEN`, balance matches the deposit                                   |
| Tab tip               | `tabReceipts` row accepted, no wallet prompt                                                  |
| Settlement            | Within 10 minutes of the receipt becoming due, a `tabSettlements` row with a transaction hash |
| Writer claim          | `authorEarnings.collectedBaseUnits` grows by the claimed amount                               |
| Withdraw start        | `tabAccounts.status` is `CLOSING`                                                             |
| NFT mint and transfer | `articleNFTs` row `contractVersion: 'v2'` with `ownerAddress`; an `nftTransfers` row          |
| v1 history            | An existing v1 tip shows with the "Testnet v1" label and unchanged amount                     |

Fees: for each v2 tip, `feeBaseUnits` equals `floor(gross × 250 / 10000)`
and the writer receives the rest (97.5%).

### 7.2 Indexer lag

`/ops/chain` shows status `OK`, `lagLedgers` under 720 and a recent
`lastRunAt` (status alone stays `OK` when the indexer is not running). Check
again after 1 hour and after 24 hours. `events.error` is 0. Alerts are Convex log lines
with codes starting `CHAIN_INDEXER_`.

### 7.3 Settler run

After the tab tip in 7.1, the next `settle due tab vouchers` run (every 10
minutes) submits a settlement. Check the Convex logs for the cron: no
`TAB_SETTLER_RUN_FAILED`, `TAB_SETTLER_REJECTED` or `TAB_SETTLER_BALANCE_LOW`.
The settler account holds more than 50 testnet XLM.

### 7.4 TTL report

```bash
bun run contracts:extend-v2 --set live --keys-dir <dir>
```

No entry is `archived`. Extend `due` entries with `--submit`.

### 7.5 Flagged payments

`/ops/chain` lists no tip flagged for review. Resolve any flagged tip with
`chain/review:resolveFlaggedTip` as described in [setup](../SETUP.md).

## 8. After the hold: removal

The removal follows section 8.6 of the specification, in separate PRs to
`overhaul/v2` or `main`, each passing `bun run check` and the Playwright
fixture suites. v1 rows are kept and stay labelled. The v1 tables
`articleTipIntents` and `highlightTipIntents` are kept read-only as an audit
trail: existing tip rows refer to them. The v1 read queries stay until every
screen reads through the combined v1 and v2 queries; only unused ones are
removed. Variables removed with the v1 code:
`NEXT_PUBLIC_TIPPING_CONTRACT_ID`, `NEXT_PUBLIC_PLATFORM_ADDRESS`,
`NEXT_PUBLIC_NFT_CONTRACT_ID`,
`NEXT_PUBLIC_HORIZON_URL`, `NEXT_PUBLIC_SOROBAN_RPC_URL`,
`TIPPING_CONTRACT_ID`, `HORIZON_URL`, `RECONCILE_TIPS_ENABLED` and
`CHAIN_V1_PREPARES_ENABLED`. Remove each from Vercel and Convex only after the
PR that stops reading it is deployed. `lib/stellar/v2/config.ts` also reads
`NEXT_PUBLIC_HORIZON_URL` and `NEXT_PUBLIC_SOROBAN_RPC_URL` (to check them
against the network guard), so the removal PR changes that file too.

## 9. Maintenance schedule

| Task                                 | When                                                                                           | Command or place                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| TTL report and extension, `live` set | Twice a week (for example Monday and Thursday), and within 3 days of any deploy or role change | `bun run contracts:extend-v2 --set live --keys-dir <dir> --submit` |
| TTL report, `integration` set        | Same                                                                                           | `--set integration`                                                |
| Indexer status and flagged tips      | Daily                                                                                          | `/ops/chain`                                                       |
| Settler balance and lag alerts       | Daily, and on every `TAB_SETTLER_*` log line                                                   | Convex logs; fund the settler from Friendbot below 50 XLM          |
| Roles report                         | Weekly, and after any role change                                                              | `bun run contracts:roles-v2 --set live --keys-dir <dir>`           |
| Live deployment snapshot             | Weekly during the hold, and before each removal PR is deployed                                 | Convex dashboard snapshot export                                   |
| Testnet reset check                  | After every announced testnet reset                                                            | [Chain runbook, testnet reset](chain-runbook.md#testnet-reset)     |
| Removal PRs                          | After the hold of one release                                                                  | Section 8                                                          |
