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
Payments v2 goes live as soon as these items are true; it does not wait for
later work.

1. The release tag is on a commit that contains each payment and sign-up
   fix: #583, #565, #577, #596 (the fix for #584), #597 and #572, all merged.
   It also contains the v1 client removal (#559, `fd39cf71`), the short-paid
   pair fix (#619, `e650829f`), the short tab notice (#620, `3854cfd8`), the
   live window tool (#593, `7b69c565`), the auth import change (#624,
   `f4704e6d`), the public copy refresh after an article leaves its address
   (#627, `116e356e`), the article image sources (#625 for #615,
   `077f08bd`) and the profile photo, embed and cover sources (#642 for
   #633, `034e0b25`) and the reconciliation wait for the indexer (#650 for
   #648, `85446463`). The checks in section 1.3 pass on that commit. The tab debit fix (#585) is
   merged and needs no operator step: its table and field ship with the
   stage 1 push, and its test variables `TAB_DEBIT_SCAN_LIMIT` and
   `TAB_DEBIT_READ_BUDGET` stay unset on the live deployment. #619, #620,
   #624, #627, #625, #642 and #650 need no operator step beyond the image
   sources check (stage 1, step 4). #559 raises the page-load budgets of
   `/articles` and `/[username]/[slug]` by 1 KB, to 217 KB and 220 KB, for a
   bundler chunk split.
2. The owner has decided the backend push method, and the push uses a deploy
   key whose `--dry-run` output names the live deployment (section 5.0.2). On
   the tagged commit, `npx tsc -p convex/tsconfig.json --noEmit` exits 0, and
   the dry run completes: it is the final check that the functions build for
   the target.
3. A stage 0 snapshot of the live deployment can be taken, and the restore
   procedure in section 6.2 has been read.
4. The TTL extension of the new contract set (stage 3, step 2) is planned in
   the window. A newly deployed set reports its role entries as `due`.
5. The owner has approved the window for the operator (section 5.0.3,
   **Live window approval**), and the person who controls the Vercel project is
   available for the Vercel hand-off steps (section 1.5).
6. The site origin is confirmed (section 1.6, item 4): the live deployment's
   `SITE_URL` and `WALLET_LINK_ORIGINS` match the origin readers load.
7. The site's `NEXT_PUBLIC_CONVEX_URL` (Vercel production) and the live
   deployment's `CONVEX_CLOUD_URL` have the same origin: the deployment's
   own `https://<name>.convex.cloud`, not a custom domain. Uploaded images
   load only from that origin (stage 1, step 4). The Vercel owner sets the
   site variable.
8. Before the window closes, `SETTLEMENT_ENABLED` is `true` on the live
   deployment and the `settle due tab vouchers` cron has run in the last 10
   minutes (Convex dashboard, **Schedules**, cron jobs), and a healthy
   settler run is recorded (stage 3, **Check**: `nothing_due` or `idle` with
   `rejected` 0, or a verified `confirmed` settlement). The logs show no `TAB_SETTLER_UNAVAILABLE`
   and no `TAB_SETTLER_RUN_FAILED`. The settler must run at least once
   within the 3-day withdrawal delay (51,840 ledgers): a reader who starts a
   withdrawal can withdraw after it, and receipts not settled by then stay
   unpaid. The settler settles every pair of a closing tab first.

## Terms

| Term                       | Meaning                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1                         | The earlier testnet tipping contract (`contracts/tipping`), its Horizon-based verification in Convex, and the earlier NFT flow. Its records stay in the database after cutover. |
| v2                         | The Core, Tab and Article NFT contracts, the Convex chain layer (`convex/chain/`, `convex/lib/chain/`) and the client modules in `lib/stellar/v2/`.                             |
| Integration deployment     | The non-production Convex deployment `efficient-tern-39`. It has its own v2 contract set (`integration`).                                                                       |
| Live deployment            | The Convex deployment that serves the public site, `upbeat-mockingbird-579`. It gets its own v2 contract set (`live`) at cutover.                                               |
| Release commit             | The commit on `overhaul/v2` that is merged into `main` for the cutover. Tag it before stage 1.                                                                                  |
| Owner                      | The person who decides the release and approves the window. The owner's approval is what lets the operator change the live deployment.                                          |
| Operator                   | Runs every backend step in this runbook (Convex, contract set, checks) from one machine, in one window that the owner approved.                                                 |
| Vercel owner               | The person who controls the Vercel project. Vercel settings stay with this person: each one is a hand-off step with a check that the operator runs.                             |
| Prepare switch (v1 and v2) | Convex environment variables that allow or refuse new payment records: `CHAIN_V1_PREPARES_ENABLED` for v1, `CHAIN_V2_ENABLED` for v2.                                           |

Repository tools refuse to deploy to the live deployment or to change its
environment by default (`assertScriptConvexDeployAllowed`).
The operator changes the live deployment only inside the approved window, as
section 5.0.3 (**Live window approval**) describes. Never weaken or bypass the
network guard.

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
2. **Client behaviour while `CHAIN_V2_ENABLED=false`.** The release frontend
   has no v1 tip or NFT flow (#559). With the v2 switch off it shows payments
   as unavailable and never shows an action that the backend refuses:
   - `chain/articles:getArticleTipAvailability` returns `disabled`. The
     article tip area and the passage tip action show "Tips are paused for a
     short time while payments are updated." While the passage action's
     availability query loads, its button can show; it stays disabled until
     `tipsV2:getTipEligibility` answers. A press that gets through opens the
     dialog, which says "Tips on Stellar testnet are not on here" and that
     nothing was paid.
   - The article NFT section shows "Article NFTs aren’t available on this
     site right now."
   - The tab screens show "Tabs are not available on this site yet".
   - The editor's tip registration panel is hidden.
   - The writer's collect panel stays usable: a claim is a direct Tab
     contract call.

   From stage 2 to stage 6 the site therefore takes no tips. Verify this on
   the integration deployment with the switch off.

3. **Freeze switch, `CHAIN_V1_PREPARES_ENABLED=false`.** With
   `CHAIN_V2_ENABLED=false`, `chain/articles:getArticleTipAvailability`
   returns `paused`, and the release frontend shows the same note as for
   `disabled`. The switch changes nothing on the release site; it stops new
   v1 records from any other caller, such as the previous site still open in
   a browser. A direct call to a gated function fails with "Tips and NFT
   actions are paused for a short time while payments are updated. Nothing
   was charged." and creates nothing.
4. **Client behaviour while `CHAIN_V2_ENABLED=true`.** The article tip area
   and the passage tip action read `chain/articles:getArticleTipAvailability`
   and `tipsV2:getTipEligibility`; `TipButton` and `HighlightTipButton` render
   the v2 flows (`ArticleTipV2`, `HighlightTipV2`, through `tipsV2`).
   `NFTIntegration` renders `ArticleNftV2` (the v2 NFT functions), which reads
   `chain/config:getChainConfig`. On an article that is not registered, the
   tip area shows "Tips aren’t on for this article yet." instead of a tip
   button, and the passage tip action shows nothing.
   Both contract IDs must be set before stage 6. If one is missing:
   - No `CORE_CONTRACT_ID`: `chain/articles:getArticleTipAvailability`
     returns `paused`, and the article tip area and the passage tip action
     show the paused note from item 3.
   - No `NFT_CONTRACT_ID`: `nftsV2:getMintProgress` returns `DISABLED`, and
     the NFT section shows "Article NFTs aren’t available on this site right
     now."
   - No `NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID` on the site, or a value other
     than `NFT_CONTRACT_ID`: the NFT section offers no mint or transfer. The
     author sees "Minting isn’t available on this site yet", the owner
     "Transfers aren’t available on this site yet", and other readers see
     the NFT status only (section 2.5).
5. **Contract version backfill.** `chain/backfill:setContractVersionV1` is in
   the release commit (it is on `overhaul/v2` today).

### 1.3 Checks on the release commit

Run on a clean checkout of the release commit. Record the output.

```bash
bun install --frozen-lockfile
bun run check
npx tsc -p convex/tsconfig.json --noEmit
bun run test:e2e:fixtures
bun run test:e2e:csp
bun run test:local-network
bun run test:local-network:tips-v2
git grep -nE 'TIPPING_CONTRACT_ID|NEXT_PUBLIC_PLATFORM_ADDRESS' -- app components hooks lib
```

- `bun run check` and both Playwright commands pass.
- `npx tsc -p convex/tsconfig.json --noEmit` exits 0. It checks the functions
  with the configuration Convex uses to build them (`convex/tsconfig.json`).
  `bun run typecheck`, part of `bun run check`, runs it too since #583; it is
  listed here because a function that passes the root configuration can still
  fail this one, and the push then stops.
- The local network suites pass against a Stellar Quickstart standalone
  network (`QUILLTIP_NETWORK_GUARD_OPT_IN=local`).
- The last command prints nothing: no page, component, hook or client module
  reads a v1 tip variable. The v1 client code was removed with #559.
- CI on the release PR is green.

### 1.4 Integration rehearsal

On the integration deployment, with its own contract set, run the full cutover
once, including the rollback in section 6:

1. Every flow in section 7.1 completes once with the v2 switch on.
2. The payments-off rollback in section 6 is tested: with
   `CHAIN_V2_ENABLED=false` every tip and NFT surface shows its note
   (section 1.2, item 2), v1 and v2 history stays readable, a writer can
   still claim from the collect panel, and a tab reader can still withdraw
   with a wallet or the Stellar CLI.
3. `bun run contracts:extend-v2 --set integration --keys-dir <dir>` reports
   no `archived` entry.
4. `bun run contracts:roles-v2 --set integration --keys-dir <dir>` exits 0.
5. The snapshot restore in section 6.2 runs once on a development deployment
   that holds data from the release code, and its check passes.

### 1.5 People and material

- The operator runs the window from one machine. That machine holds the
  credential for the live deployment (section 5.0.2) and the key directory
  for the `live` contract set (created by stage 3). The owner has approved
  the window (section 5.0.3, **Live window approval**).
- The Vercel owner is available for the hand-off steps: stage 1, step 2;
  stage 2, step 1; stage 3, step 4; and the variable removal in section 8.
- The operator has a Convex user ID in `OPS_USER_IDS` on the live deployment,
  so `/ops/chain` shows the indexer status.
- A snapshot of the live deployment exists from the day of the cutover
  (Convex dashboard, **Settings → Snapshot export**, or
  `bunx convex export --include-file-storage --path <file>.zip` with the
  credential from section 5.0.2). Keep it outside the repository. Stage 0
  takes the snapshot used for a restore (section 6.2).
- No notice goes to authors. After stage 6, writers see the wallet
  verification and **Enable tips** prompts in the product (section 4.3).

### 1.6 Owner decisions recorded before stage 0

Record each answer in the cutover tracking issue.

1. **Backend push method.** The deployment type of the live deployment
   (development or production) and the deploy key the operator uses for it.
   Section 5.0.2 gives the procedure for each case. The repository does not
   record either, so the owner confirms them before stage 0. The window tool
   (section 5.0.3) accepts only a development deploy key for
   `upbeat-mockingbird-579`, so it cannot run against a production-type
   deployment. If the live deployment is production-type, stop: the window
   needs a reviewed change to the tool before stage 0.
2. **v1 maintenance jobs.** Whether `legacyTipCleanup:run` and
   `authorEarningsBackfill:run` were applied on the live deployment before is
   not recorded. Do not assume either way. After stage 1, run both as dry runs
   (stage 1, step 6). Their output shows what needs correcting on that day.
   Apply them only if the operator decides to, and record the decision.
3. **Release scope.** One combined release of `overhaul/v2`, with the v1
   client removal (#559), in one announced window: backend first, site
   within minutes (section 5.0). Decided: payments v2 goes live as soon as
   the go/no-go items are true, without waiting for later work. Once the
   release site is live there is no return to v1 tipping; the rollback is
   payments off and fix forward (section 6).
4. **Site origin.** Records disagree on the public origin:
   `docs/DEPLOYMENT.md` sets `SITE_URL` to `https://quilltip.me`, and the site
   is served at `https://www.quilltip.me`. Do not assume either. Before stage
   0, the operator:
   - checks the origin readers load: `curl -sI https://quilltip.me` and
     `curl -sI https://www.quilltip.me`. The one that answers 200 rather than
     redirecting is the site origin, written `<site origin>` in this runbook;
   - reads `SITE_URL` and `WALLET_LINK_ORIGINS` on the live deployment in
     the dashboard (**Settings → Environment Variables**). Reading the
     deployment's variables is not a window operation (section 5.0.3).

   `SITE_URL` sets three things: the password-reset link
   (`convex/lib/passwordResetEmail.ts`), the origin allowed to request a
   wallet challenge (`convex/walletLink.ts`, together with the comma-separated
   `WALLET_LINK_ORIGINS`), and the v2 NFT metadata URL (section 3.1). Wallet
   verification from a browser on `<site origin>` is refused unless that
   origin is `SITE_URL`'s origin or listed in `WALLET_LINK_ORIGINS`. If
   `SITE_URL` is not `<site origin>`, either set it to `<site origin>` and add
   the old value to `WALLET_LINK_ORIGINS`, or add `<site origin>` to
   `WALLET_LINK_ORIGINS`. Record the decision before stage 0.

5. **Who runs the window.** The operator runs the backend steps from one
   machine in one window that the owner approved (section 5.0.3,
   **Live window approval**). Vercel settings stay with the Vercel owner. Each
   Vercel step is a hand-off with a check that the operator runs.

## 2. Schema and API compatibility

Checked by comparing `convex/schema.ts`, `convex/lib/chain/schema.ts`,
`convex/lib/chain/nftSchema.ts` and the exported Convex functions between
`main` and `overhaul/v2`.

### 2.1 Schema changes

Every v2 change to an existing table is additive or relaxes a field:

- **New tables:** `chainConfig`, `chainArticles`, `chainSubmissions`,
  `chainEvents`, `chainCursor`, `chainLeases`, `tabAccounts`,
  `tabSessionKeys`, `tabReceipts`, `tabVouchers`, `tabSettlements`,
  `tabBalanceDebits`, `tabReserveReleases`, `tabClaims`,
  `tabClaimCorrections`, and `walletChallenges`. `overhaul/v2` also adds `feedback` and `rateLimits`,
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

Rows in the new tables are also outside `main`'s schema. Roll back by
turning payments off (section 6), and keep the release code deployed. The
only technical way back to `main`'s code is the stage 0 snapshot restore in
section 6.2, which also discards everything written since stage 0. This plan
does not take it: `main`'s code would return to v1 tipping (section 6).

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

After stage 2, `main`'s frontend is not a rollback target (section 6). It
stays relevant only in browsers that still have the previous site open: their
v1 tips are covered by the freeze and the drain (section 4.2, stage 5).

### 2.4 The release frontend against `main`'s backend

The release frontend calls functions that `main`'s backend does not have
(`walletLink:*`, `tipsV2:*`, `tabs:*`, `chain/*`, `tips:listMySentTips` and
others). It fails on those pages. Therefore the backend always goes first, and
the stage 2 site rollback never needs a backend rollback.

### 2.5 NFT contract variables

The v2 client (`lib/stellar/v2/config.ts`) reads the v2 NFT contract from
`NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID` (#517). The v1 NFT client, which read
`NEXT_PUBLIC_NFT_CONTRACT_ID`, was removed with #559, so the release site
does not read that name. Remove it from Vercel after stage 2 passes
(section 8). On Convex, only v2 code reads `NFT_CONTRACT_ID`.

## 3. Environment variables and switches

### 3.1 Convex (live deployment)

Set by the operator, in this order. Secrets go in the Convex dashboard
(**Settings → Environment Variables**), never on a command line or in a file
in the repository, and are never printed (stage 3, step 3, **Tab secrets**).

| Order | Variable                                                                      | Value                                                          | Stage | Effect when set                                                                             |
| ----- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------- |
| 1     | `STELLAR_NETWORK`                                                             | `TESTNET`                                                      | check | Already set. Every v2 path calls `assertBackendTestnet()` and refuses anything else.        |
| 2     | `STELLAR_RPC_URL`, `NETWORK_PASSPHRASE`                                       | Optional. Testnet RPC URL; `Test SDF Network ; September 2015` | 3     | The guard refuses mainnet values. Defaults are the public testnet values.                   |
| 3     | `CHAIN_V2_ENABLED`                                                            | `false`                                                        | 3     | Set it explicitly to `false` before any other v2 value.                                     |
| 4     | `CHAIN_V1_PREPARES_ENABLED`                                                   | `true`                                                         | 3     | Explicit current state.                                                                     |
| 5     | `CHAIN_EPOCH`                                                                 | For example `testnet-2026-12-15`                               | 3     | Every new chain row carries it. Change it only with a new contract set.                     |
| 6     | `CORE_CONTRACT_ID`, `TAB_CONTRACT_ID`, `NFT_CONTRACT_ID`, `TOKEN_CONTRACT_ID` | The `live` set, from `docs/contracts/v2-testnet-deployment.md` | 3     | The hourly `refresh chain config` cron starts caching the contract views.                   |
| 7     | `INDEXER_START_LEDGER`                                                        | The `live` set's Core deploy ledger                            | 3     | With `CORE_CONTRACT_ID`, the indexer starts on the next minute.                             |
| 8     | `OPS_USER_IDS`                                                                | Operator Convex user IDs                                       | 3     | `/ops/chain` shows the status to those users.                                               |
| 9     | `TAB_ACCEPTOR_SECRET`                                                         | The `live` set's acceptor seed                                 | 3     | Read only when `SETTLEMENT_ENABLED=true`.                                                   |
| 10    | `TAB_SETTLER_SECRET`                                                          | The `live` set's settler secret                                | 3     | Read only when `SETTLEMENT_ENABLED=true` and `TAB_CONTRACT_ID` are set.                     |
| 11    | `TAB_DAILY_LIMIT`, `TAB_TIP_MAX`                                              | Optional. Defaults `200000000`, `50000000`                     | 3     |                                                                                             |
| 12    | `SETTLEMENT_ENABLED`                                                          | `true`                                                         | 3     | The settler cron runs and tab tips can be accepted. Nothing is due until a tab tip exists.  |
| 13    | `INTERNAL_ACCOUNT_EMAIL_DOMAINS`                                              | Optional. Staff email domains                                  | 3     | New accounts on those domains are flagged as internal. Not a payment setting.               |
| 14    | `ARWEAVE_ENABLED`, `ARWEAVE_WALLET_KEY`                                       | `ARWEAVE_ENABLED` not `true`                                   | —     | Off until the v1 backend removal ships. See section 3.3.                                    |
| 15    | `CHAIN_V1_PREPARES_ENABLED`                                                   | `false`                                                        | 5     | New v1 records are refused. Submits and verification continue.                              |
| 16    | `CHAIN_V2_ENABLED`                                                            | `true`                                                         | 6     | v2 prepare functions accept new records.                                                    |
| 17    | `RECONCILE_TIPS_ENABLED`, `TIPPING_CONTRACT_ID`, `HORIZON_URL`                | Unchanged                                                      | —     | v1 verification needs them until a later backend PR removes the v1 functions (section 8).   |
| 18    | `EARNINGS_TOTALS_REBUILD_ENABLED`                                             | `true`, and left on                                            | 5A    | The writers' lifetime totals are rebuilt by a cron every minute. Unset or `false`: nothing. |

Variables 9 to 12 are read only after the network guard passes. Never put a
secret in `.env.example`, a commit, a PR or a log.

**NFT token URI.** The indexer stores each minted token's metadata URL as
`<SITE_URL>/api/nft/<token id>` (`convex/lib/chain/nftStore.ts`) when it
records the mint, and the stored URL does not change afterwards. With
`SITE_URL` unset it uses `https://www.quilltip.me`. Before the first v2 mint,
read the live deployment's `SITE_URL` and confirm that it is the origin the
site serves. Do not change it only for the NFT URL: `SITE_URL` also sets the
password-reset link (`convex/lib/passwordResetEmail.ts`) and the origin that
may request a wallet challenge (`convex/walletLink.ts`). If it changes, add
the previous origin to `WALLET_LINK_ORIGINS`. On the integration deployment
`SITE_URL` is a local URL, so its tokens point there. The NFT contract's own
`base_uri` is set at deploy; after stage 3 records the `live` set in
`docs/contracts/v2-testnet-deployment.md`, check that its `base_uri` is
`<site origin>/api/nft/` (section 1.6, item 4). `contracts:deploy-v2` uses
`https://www.quilltip.me/api/nft/` unless `--nft-base-uri` is given.

### 3.2 Vercel (site)

`NEXT_PUBLIC_*` values are built into the site, so a change needs a new
deployment. The Vercel owner sets these on the production environment before
stage 2 (a hand-off step; stage 2, step 1 has the check):

| Variable                                                                                                                              | Value                | When                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_STELLAR_NETWORK`                                                                                                         | `TESTNET`            | Already set                                                                                                                                                |
| `NEXT_PUBLIC_STELLAR_RPC_URL`, `NEXT_PUBLIC_NETWORK_PASSPHRASE`                                                                       | Testnet values       | Stage 2                                                                                                                                                    |
| `NEXT_PUBLIC_CORE_CONTRACT_ID`, `NEXT_PUBLIC_TAB_CONTRACT_ID`, `NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID`, `NEXT_PUBLIC_TOKEN_CONTRACT_ID` | The `live` set       | Stage 2 (after stage 3 when the set is new)                                                                                                                |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`                                                                                                | The Reown project ID | Stage 2. Blank turns WalletConnect off; a malformed value stops the build. The project's domain allowlist must include `www.quilltip.me` and `quilltip.me` |
| `NEXT_PUBLIC_NFT_CONTRACT_ID` (v1 NFT)                                                                                                | Unchanged            | Not read by the release site (#559). Remove after stage 2 passes (section 2.5)                                                                             |
| `NEXT_PUBLIC_TIPPING_CONTRACT_ID`, `NEXT_PUBLIC_PLATFORM_ADDRESS`                                                                     | Unchanged            | Not read by the release site (#559). Remove after stage 2 passes (section 8)                                                                               |
| `NEXT_PUBLIC_HORIZON_URL`                                                                                                             | Unchanged            | Still read by the network guard and the content security policy (section 8)                                                                                |

If the live contract set is deployed after the site, rebuild the site once the
contract IDs are set. `NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID` must equal the
backend's `NFT_CONTRACT_ID`; unset or different, the NFT section offers no
mint or transfer (section 1.2, item 4).

### 3.3 Arweave

Keep Arweave off on the live deployment (`ARWEAVE_ENABLED` not `true`) until
the v1 backend removal (section 8) has shipped. The retired v1 mint metadata
action (`nftMetadataUpload:uploadNftMetadataForMint`) is the last path that
stores a writer-supplied image address permanently. It refuses while
Arweave is off, and from stage 5 also while v1 prepares are off. Before
stage 0, read the value in the dashboard; if it is `true`, set it to
`false` there (it is outside the window approval, section 5.0.3).

With Arweave on, the release uploads the canonical article bytes, and registration passes the Arweave ID on chain only
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
- The v1 contract's admin key is lost, so the v1 contract cannot be paused.
  It stays callable on testnet by a hand-built transaction, and the app
  records no such tip after the freeze. The freeze and the drain described
  here are the only path: such a tip stays on chain and out of the app.
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
  settings (`/dashboard/wallet`).
- No notice goes to authors. The editor's tip panel for a published article
  shows the prompts: "Verify your receiving wallet before you enable tips"
  with a **Verify your wallet** link, then the **Enable tips** button
  (`components/editor/ArticleTipsPanel.tsx`). While `CHAIN_V2_ENABLED=false`
  the panel is hidden.

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

| Stage | Work                                                  | Measured                                                                                                                                                                        |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Tag, snapshot export                                  | Snapshot 2 s                                                                                                                                                                    |
| 1     | `--dry-run`, push, cron check, maintenance dry runs   | Dry run 19 s, push 32 s, cron check 2 min                                                                                                                                       |
| 2     | Site deploy and checks                                | Checks about 5 min, plus the Vercel build                                                                                                                                       |
| 3     | Contract set, TTL extension, variables, indexer check | Deploy 861 s, extension 28 s, variables 8 s, indexer `OK` within 70 s; config refresh up to 1 hour                                                                              |
| 4     | Contract version backfill, claim records              | 8 s                                                                                                                                                                             |
| 5     | Freeze, 15-minute wait, drain                         | 15 min 17 s                                                                                                                                                                     |
| 5A    | Lifetime totals: dry run, switch, progress            | About ⌈N/20⌉ min for N rows; 300 synthetic writers: dry run 197 s, rebuild 999.5 s                                                                                              |
| 6     | Backfill again, switch on v2, section 7.1             | Registration indexed in 17 s, direct tip confirmed in 35 s; about 15 min for the full 7.1 list                                                                                  |
| —     | Snapshot restore (section 6.2), if needed             | Paused 4 min 26 s and 5 min 31 s locally (small data sets); 4 min 39 s on a cloud deployment at 57 MB, export 11 s, import 67 s; plus building the restore file (steps 3 and 4) |

Plan about 1 hour 15 minutes from stage 0 to the end of stage 6, plus the
Vercel hand-off steps. The site takes no tips from stage 2 until stage 6
(section 1.2, item 2). Stage 3, steps 1 and 2 (deploy and extend the contract
set) can run before the window, which shortens it by about 20 minutes. The
set is unused until its IDs are set in step 3, which needs the release
backend from stage 1.

#### 5.0.2 Backend push procedure

The live deployment's type (development or production) and the operator's
credential for it are an owner decision (section 1.6, item 1). The procedure
below is the same for both types. It uses a deploy key because only
`convex deploy` has a `--dry-run`, and the dry run prints the target before
anything is pushed.

1. Get a deploy key for the live deployment itself:
   - production-type deployment: a production deploy key (dashboard,
     **Settings → Deploy keys**). The window tool refuses it (section 1.6,
     item 1);
   - development-type deployment: a development deploy key for that
     deployment (dashboard, **Settings → Deploy keys**, or, with a Convex
     login that has access to the deployment,
     `npx convex deployment token create <key name> --deployment upbeat-mockingbird-579`,
     which prints the key).
2. In a clean checkout of the tagged release commit, after
   `bun install --frozen-lockfile`, put the key in the environment without
   writing it to the shell history, and clear any other target:

   ```bash
   unset CONVEX_DEPLOYMENT CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
   read -rs CONVEX_DEPLOY_KEY && export CONVEX_DEPLOY_KEY
   npx tsc -p convex/tsconfig.json --noEmit
   bunx convex deploy --dry-run
   ```

   The `tsc` command must exit 0 before the dry run.

3. Read the dry-run output. It starts with `Deploying code to deployment:`,
   then a line with the deployment type and name, then the deployment URL.
   Continue only if the URL is
   `https://upbeat-mockingbird-579.convex.cloud`. If it names any other
   deployment, stop and get the right key. For the release commit the dry run
   also lists new indexes, ends with `Would have deployed Convex functions`
   and prints `Change the server's version for Node.js actions:`; that line
   is expected. The dry run output is the final check that the functions
   build for the target: the dry run type-checks the functions with
   `convex/tsconfig.json` and, on an error, prints the file, line and error
   (for example `convex/earningsTotalsBackfill.ts:67:24 - error TS2550`),
   then the line ``TypeScript typecheck via `tsc` failed.``, and exits 1
   with nothing pushed. Do not push with `--typecheck=disable`.
4. Push with the same shell: `bunx convex deploy`.

Do not push with only a CLI login and `CONVEX_DEPLOYMENT` set:
`convex deploy` then targets the project's **production** deployment, which
may not be the live deployment. `convex dev --once` pushes to the deployment
in `CONVEX_DEPLOYMENT` but has no dry run.

Once the `live` contract set is configured (stage 3), push backend code only
while the indexer is caught up and no tab settlement is in flight:
`/ops/chain` shows a `lastRunAt` within the last 2 minutes and `lagLedgers`
under 720, and no `tabSettlements` row has status `PREPARED` or `SUBMITTED`.
Push between two settler runs (every 10 minutes). A settlement that the
earlier code records just before the push is not held back from the reader's
free balance until its `TabSettled` event is indexed. At stage 1 no tab exists
yet, so the condition holds.

Use the same key for the stage 0 export, the stage 1 and stage 4
`convex run` calls and any restore (section 6.2), so that every command
reaches the same deployment. Unset `CONVEX_DEPLOY_KEY` at the end of the
window.

#### 5.0.3 Live window approval

The network guard refuses every deploy-kind command on the live deployment.
For this window only, `bun scripts/live-window.ts` runs the Convex steps of
stages 0, 1 and 3 to 6 and section 6.2 under an operator approval. It builds each
Convex CLI command itself, so no flag can select another deployment.

**What a run pushes.** Each `run` builds its code from the approved commit, not
from the checkout. It exports the commit into a new private folder under
`~/.quilltip/live-window/builds/` from git's objects, checks every object and
the exported folder against the commit's ids, installs the dependencies there
with `bun install --frozen-lockfile --ignore-scripts`, and runs the Convex CLI
there with system Node and an environment that holds only `CONVEX_DEPLOY_KEY`.
The checkout's files, index and git settings, its `node_modules` and the
shell's other variables cannot change what is pushed. The first run of a
window downloads the packages (about 10 seconds and 1.5 GB); later runs use the
window's private package cache. The checks of the checkout below stay as a
second check.

Run the tool with Bun directly, not with `bun run`, which puts the checkout's
`node_modules/.bin` first in `PATH`. Use the Bun version the release pins:
`npx bun@1.4.4 scripts/live-window.ts …` when the installed Bun differs. Node
20 or later and git must be in `/usr/bin`, `/bin`, `/usr/local/bin` or
`/opt/homebrew/bin`; the tool does not look them up in `PATH`.

The approval is one variable, set in the shell (never in a file):
`QUILLTIP_LIVE_WINDOW_APPROVAL=<deployment>@<release commit>@<UTC start>+<hours>h`.
The commit is the full 40-character SHA; the start is `YYYY-MM-DDTHH:MMZ`;
the window lasts 1 to 4 hours. The tool refuses if the checkout is not at that
commit or has any change or untracked file, if the window has not started or
has ended, if the value is malformed, if a `.env*` file or a committed file
holds it, if another Convex target is set, or if `CONVEX_DEPLOY_KEY` is not a
development deploy key for that deployment. Mainnet is refused as always.

1. Before the first run, remove the window's build root:
   `rm -rf ~/.quilltip/live-window/builds`. The package cache in it is kept
   per commit, and a reused cache is not checked again. With the root
   removed, the first run is a fresh build from the registry, checked
   against the lockfile's hashes (about 11 seconds measured). Run every
   window operation from the same operator account, and let no other
   session write to that folder during the window. Then set the approval,
   in the clean checkout of the tag, after `bun install --frozen-lockfile`:

   ```bash
   unset CONVEX_DEPLOYMENT CONVEX_DEPLOYMENT_TOKEN CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
   export QUILLTIP_NETWORK_GUARD_OPT_IN=testnet NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
   read -rs CONVEX_DEPLOY_KEY && export CONVEX_DEPLOY_KEY
   export QUILLTIP_LIVE_WINDOW_APPROVAL="upbeat-mockingbird-579@$(git rev-parse 'payments-v2-cutover.1^{commit}')@<YYYY-MM-DDTHH:MMZ>+3h"
   ```

2. Verify it (dry mode: local checks only, nothing is sent):
   `bun scripts/live-window.ts check` lists the allowed operations, and
   `bun scripts/live-window.ts check <operation> <args>` checks one command.
3. Run each step as `bun scripts/live-window.ts run <operation> <args>`. Each
   run builds its code as described above, prints the deployment, commit,
   operation and expiry, and appends lines (including the checked tree) to
   `~/.quilltip/live-window.log` (`QUILLTIP_LIVE_WINDOW_LOG` to change it; it
   must be outside the repository). The log holds no key or secret.

   | Runbook command                                      | Window operation                                                                                |
   | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
   | `convex deploy --dry-run`                            | `deploy-dry-run`                                                                                |
   | `convex deploy`                                      | `deploy` (runs the dry run first; pushes only if it names the approved deployment and no other) |
   | `convex export --include-file-storage --path <file>` | `export <file>.zip` (outside the repository, new file)                                          |
   | `convex import --replace-all -y <file>`              | `import <file>.zip` (section 6.2 only; needs the restore binding below)                         |
   | `convex env set <NAME> <value>`                      | `env-set <NAME> <value>` (non-secret variables of section 3.1; values checked)                  |
   | `convex env remove <NAME>`                           | `env-remove <NAME>` (contract IDs, `INDEXER_START_LEDGER`)                                      |
   | `convex run <function> '<json>'`                     | `convex-run <function> '<json>'` (functions named in this runbook, with their argument names)   |
   | Dashboard pause or resume (section 6.2)              | `pause`, `resume` (recorded only; do it in the dashboard)                                       |

   `export` prints the SHA-256 of the file it wrote and logs it.

   **Restore binding.** A section 6.2 import also needs
   `QUILLTIP_LIVE_WINDOW_RESTORE=<deployment>@sha256:<64 hex digits>` for the
   reviewed restore file. The restore file is rebuilt from the stage 0
   snapshot and the second export, so its digest differs from both: take it
   from the reviewed file (`shasum -a 256 <restore-file>.zip`), not from an
   export line in the log. The tool refuses another file, another deployment
   or a malformed value. It copies the file to a private directory, checks the
   copy's digest again, imports the copy, and logs the digest.

4. Clear it at the end of the window, and check that the tool now refuses:

   ```bash
   unset QUILLTIP_LIVE_WINDOW_APPROVAL QUILLTIP_LIVE_WINDOW_RESTORE CONVEX_DEPLOY_KEY
   bun scripts/live-window.ts check
   rm -rf ~/.quilltip/live-window/builds
   ```

Outside the approval: the secrets `TAB_ACCEPTOR_SECRET`, `TAB_SETTLER_SECRET`
and `ARWEAVE_WALLET_KEY` (dashboard only), `ARWEAVE_ENABLED`, reading the
deployment's variables, the dashboard **Data** and **Schedules** views, the
Vercel settings and promotion of stage 2, and the contract steps of stage 3. Contract tools refuse to run while the approval is set: unset it first,
and set it again for the next Convex step. Maintenance functions that call
`assertNonProductionBackend` stay refused on the live deployment.

### Stage 0. Freeze and tag

1. Stop merges to `overhaul/v2` except cutover fixes.
2. Tag the release commit: `git tag payments-v2-cutover.1 <sha>` and push the
   tag.
3. Take the live deployment snapshot with file storage, outside the
   repository: `bunx convex export --include-file-storage --path <file>.zip`
   (section 5.0.2 for the credential), or a dashboard backup. Record the
   live deployment's environment variable names and values in a password
   store outside the repository: a snapshot does not contain them. Record the latest testnet
   ledger just before you start the export (RPC `getLatestLedger`); a restore
   lists payments from that ledger (section 6.2, step 3). Events between that
   ledger and the export are listed twice, which is harmless: the indexer
   recognises them as duplicates.

**Check:** the tag points to the commit whose checks are recorded in 1.3, and
the snapshot file opens (`unzip -l <file>.zip` lists one folder per table and
`_storage`).
**Rollback:** none needed.

### Stage 1. Release backend on the live deployment (switches off)

1. Confirm on the live deployment: `CHAIN_V2_ENABLED` is unset or `false`,
   and no v2 contract ID is set.
2. Hand-off to the Vercel owner: confirm that the release frontend can be
   held back until stage 2. The default plan: do not merge the release PR
   yet; the backend goes first. Alternative: turn off automatic production
   promotion for the window, merge, and promote the build in stage 2.
   Check: the Vercel owner states which plan applies, and the operator
   records it before step 3.
3. The operator pushes the tagged release commit's functions and schema with
   the procedure in section 5.0.2 (dry run, confirm the target, push).
4. Image sources check (#615, #633). Run the internal, read-only report of
   the sources of article images, video embeds and profile photos:

   ```bash
   bunx convex run articleImageHosts:countImageHosts
   ```

   It takes no arguments. It returns:
   - `storageOrigin`: the origin of this deployment's own file storage.
   - `articles.published` and `articles.draft`: the article counts.
   - `images` and `covers`: one row per host with `publishedAllowed`,
     `publishedRefused`, `draftAllowed` and `draftRefused`. Each address is
     judged on its own, so one host can have both allowed and refused
     addresses (for example `http` against `https`).
   - `embeds`: `publishedRebuilt`, `publishedNoFrame`, `draftRebuilt` and
     `draftNoFrame`. A rebuilt embed shows its video from the video ID; a
     no-frame embed shows no video frame.
   - `avatars`: one row per host with `allowed` and `refused`, one count per
     account with a stored profile photo. Only addresses in this
     deployment's own storage are allowed. A photo on any other host,
     listed stock image hosts included, shows the account's initials.

   It returns no address, article text, title, author, name or ID. The
   function exists only in the release code, so it runs after the push and
   before the merge in step 5.
   - `storageOrigin` must equal the origin of the site's
     `NEXT_PUBLIC_CONVEX_URL` (go/no-go item 7). If they differ, stop and do
     not merge: every uploaded image would stop showing.
   - List for the owner, before step 5: every host in `images` or `covers`
     with `publishedRefused` above 0, with that count;
     `embeds.publishedNoFrame`; and the sum of `refused` in `avatars`, which
     is the number of accounts whose photo will show initials, with its
     hosts. After the merge, those images and video frames stop showing in
     published articles. Older articles and accounts can hold storage
     addresses of other Convex deployments; those stop showing too.
   - The owner's default is to continue and record the hosts. The check
     makes this a decision before the release site goes live. Record the
     full output.
   - If the owner wants such an article moved back to draft, so that its
     author can replace the image (published articles cannot be changed):
     the reviewed path is the internal mutation
     `articles:hideReviewedArticles`. It takes 1 to 50 articles, each with
     `id`, `expectedTitle` and `expectedUpdatedAt` from the dashboard
     **Data** view, refuses an article that changed since that review, and
     is a dry run unless `"dryRun": false`. It is not on the window tool's
     list (section 5.0.3), so it cannot run in this window without a
     reviewed change to that list.
   - After an article is moved to draft (#627): its page answers 404 at
     once. Its card can stay on `/articles` for up to 60 seconds, and the
     card's link answers 404 (#628). Each article request makes one route
     check in the proxy (#630).

5. Merge the release PR (`overhaul/v2` into `main`) right after step 4, and
   continue with stage 2. With the default plan, Vercel builds and promotes
   `main` on merge, so the site follows within minutes. Never merge before
   the push: the release frontend fails against `main`'s backend
   (section 2.4).
6. Run the v1 maintenance jobs as dry runs (section 1.6, item 2):

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

1. Hand-off to the Vercel owner: confirm the production environment values
   from section 3.2. Check: the Vercel owner reports the names and the
   public values (network, RPC URL, passphrase, contract IDs; never a
   secret), and the operator compares each with section 3.2.
2. The Vercel owner lets the production deployment of the merge commit
   finish, or promotes it. The operator runs the checks below.

**Check:**

- `/api/health` answers with JSON from the release build. A status code
  alone is not a check: before the release, the path returns the old site's
  HTML page with status 200. Run:

  ```bash
  curl -fsS -H 'Accept: application/json' <site origin>/api/health \
    | jq -e --arg sha "<built sha>" '.status == "ok" and .backend == "ok"
        and .network == "TESTNET" and .commit == $sha'
  ```

  `<built sha>` is the commit Vercel built, which `commit` reports
  (`VERCEL_GIT_COMMIT_SHA`). With the default plan that is the merge commit
  on `main` (`git rev-parse origin/main` after the merge), not the tag.
  Check that it carries the tagged code: `git diff <tag> origin/main` prints
  nothing.

  The command must print `true` and exit 0. It fails on an HTML answer (`jq`
  cannot parse it), a different commit, another network, or a backend that is
  `unreachable` or `unconfigured`.

- A signed-in user on `<site origin>` can open settings and verify a wallet
  (wallet challenge). If the challenge is refused with `ORIGIN_NOT_ALLOWED`,
  check `SITE_URL` and `WALLET_LINK_ORIGINS` (section 1.6, item 4).
- With `CHAIN_V2_ENABLED=false`, an article page shows "Tips are paused for
  a short time while payments are updated." in place of the tip button, the
  article NFT section shows "Article NFTs aren’t available on this site right
  now.", and an existing v1 tip still shows in the tipper's history with the
  "Testnet v1" label. From here until stage 6 the site takes no tips.
- The browser console shows no Content Security Policy violation on the
  article, settings and dashboard pages.

**Rollback:** only while this stage's check has not passed, and only if the
release site does not work at all: the Vercel owner runs **Instant
Rollback** to the previous production deployment. The backend stays on the
release code, and the section 2.3 exceptions apply, so fix and roll forward
as soon as possible. Once the check passes, the release site is live and
there is no return to the previous site or to v1 tipping: fix forward, with
payments off if needed (section 6).

### Stage 3. Live contract set and v2 environment

1. Deploy the `live` contract set from the release commit, on the
   operator's machine, which holds the key directory, following section 8.4 of the specification:

   ```bash
   export QUILLTIP_NETWORK_GUARD_OPT_IN=testnet
   export NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
   export NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
   export NEXT_PUBLIC_NETWORK_PASSPHRASE='Test SDF Network ; September 2015'
   bun run contracts:deploy-v2 --set live --commit <sha> --keys-dir <dir> \
     --nft-base-uri <site origin>/api/nft/
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

3. The operator sets variables 2 to 12 of section 3.1 on the live
   deployment, in that order, with `CHAIN_V2_ENABLED=false`. The owner sets
   the two secrets (variables 9 and 10) in the dashboard, as below, before
   `SETTLEMENT_ENABLED=true`.

   **Tab secrets.** Never run a command that prints the secret of a real
   identity (`live` or `integration`): not `stellar keys secret` (or the
   older `stellar keys show`) without a pipe, and not `cat` of an identity
   file. A
   printed secret ends up in terminal history, logs or a session transcript,
   and the key must then be rotated. Copy each secret straight to the
   clipboard instead, paste it into the dashboard, then clear the clipboard
   with `pbcopy < /dev/null`:

   ```bash
   stellar keys secret qt-v2-live-acceptor --config-dir <dir>/live | tr -d '\n' | pbcopy
   stellar keys secret <settler identity> --config-dir <dir>/live | tr -d '\n' | pbcopy
   ```

   `<settler identity>` is `qt-v2-live-settler`, or the identity of a
   rotated settler key.

   Field check, by the owner, on the live deployment's dashboard
   (**Settings → Environment Variables**), for `TAB_ACCEPTOR_SECRET` and
   `TAB_SETTLER_SECRET`: the variable is on that deployment, and its value is
   56 characters long, starts with `S`, and has no quotes, spaces or line
   breaks. The settler trims white space around the value and refuses
   anything that is not then a valid Stellar secret seed with
   `TAB_SETTLER_UNAVAILABLE` (`StrKey.isValidEd25519SecretSeed`,
   `convex/tabSettler.ts`). The acceptor accepts the same seed, or 64 hex
   characters (`parseAcceptorSeed`, `convex/lib/chain/voucher.ts`); the `live`
   set uses `S…` seeds. A valid seed of the wrong identity (for example the
   acceptor seed in the settler variable) passes both checks, so copy each
   secret from the identity named above.

4. Hand-off to the Vercel owner: set the Vercel contract IDs from section 3.2
   and redeploy the site if stage 2 already ran. Check: the Vercel owner
   reports the four contract IDs (they are public); the operator compares
   them with the `live` section of `docs/contracts/v2-testnet-deployment.md`
   (`NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID` equals `NFT_CONTRACT_ID`), and the
   stage 2 health command passes for the new build's commit.
5. After step 3, run `bunx convex run chain/indexer:redispatch` once, so that
   a stored event that waited for a variable is dispatched again
   (section 7.2, **Pending events**).

**Check:**

- `bun run contracts:roles-v2 --set live --keys-dir <dir>` exits 0.
- `bun run contracts:extend-v2 --set live --keys-dir <dir>` (report only)
  prints a summary line that starts with `archived 0, due 0`. One `absent`
  entry for a claimed balance is normal.
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
- The Convex logs show no `TAB_ACCEPTOR_MISMATCH`, no
  `TAB_SETTLER_UNAVAILABLE` and no `TAB_SETTLER_RUN_FAILED`.
- One healthy settler run after the settler is enabled. After
  `SETTLEMENT_ENABLED=true` is set, and again after any change to
  `TAB_SETTLER_SECRET`, the operator runs `tabSettler:settleDue` once from
  the Convex dashboard (**Functions**; it is an internal action with no
  arguments) and reads the value it returns. A successful run writes no log
  line, so the logs alone cannot show it.
  The function takes the same lease as the `settle due tab vouchers` cron,
  so it cannot overlap a cron run. The run is healthy only with one of these
  results:
  - `"status": "nothing_due"` with `"rejected": 0`;
  - `"status": "confirmed"` with a `settlementId`, whose `tabSettlements`
    row is `CONFIRMED` with a transaction hash that the testnet RPC or
    Horizon reports as successful.

  Before stage 6 no tab holds receipts, so the result is `nothing_due`. That
  proves that the settler secret is a valid seed and that the cycle reached
  the RPC and the database. It does not sign anything, so it does not prove
  that the key holds the Tab's settler role or that its account is funded.
  Only a `confirmed` settlement proves that: the first one after the tab tip
  of section 7.1 (section 7.3).

  `"busy"` or `"pending"` proves nothing: run it again after the open
  settlement resolves (within 10 minutes). Stop on `"failed"`, `"expired"`,
  `"rejected"` above 0, `"status": "disabled"`, or an error. Record the time
  and the result of the healthy run. A missing or malformed settler secret
  fails the run with `TAB_SETTLER_UNAVAILABLE` before the settlement cycle
  starts, so that run logs no `TAB_SETTLER_RUN_FAILED`: a scan for
  `TAB_SETTLER_RUN_FAILED` alone does not find it. Do not start stage 6 until
  a healthy run is recorded.

- The acceptor, as far as it can be checked before stage 6. After
  `SETTLEMENT_ENABLED=true` is set, and again after any change to
  `TAB_ACCEPTOR_SECRET`, run `chain/config:refreshChainConfig` from the
  dashboard and check the logs. A valid acceptor seed whose public key is not
  among the Tab's `acceptor_keys` logs `TAB_ACCEPTOR_MISMATCH`. A missing or
  malformed acceptor secret logs nothing here: the refresh treats it as
  acceptance being off. It shows only at the first tab tip, which refuses
  with `TAB_ACCEPTOR_UNAVAILABLE`. So before stage 6 the field check in step
  3 is the only check of the acceptor's format, and the tab tip in section
  7.1 is the first proof that the acceptor works. If that tip refuses with
  `TAB_ACCEPTOR_UNAVAILABLE` or `TAB_ACCEPTOR_MISMATCH`, follow section 6.

**Rollback:** set `SETTLEMENT_ENABLED=false` and remove the contract IDs and
`INDEXER_START_LEDGER`. Nothing user-facing uses the set while
`CHAIN_V2_ENABLED=false`. The indexer then stops, but its cursor keeps
status `OK`; check that `lastRunAt` stops moving and the contract IDs are
empty. Setting the variables again resumes it from its cursor. If the set
itself is wrong, deploy a new set with a new `CHAIN_EPOCH`.

### Stage 4. Contract version backfill and claim records

Run the internal backfill on the live deployment. It is a dry run unless
`"apply": true`. Run it in this order: dry run, apply, dry run again.

```bash
bunx convex run chain/backfill:setContractVersionV1 '{"table":"tips"}'
bunx convex run chain/backfill:setContractVersionV1 '{"table":"tips","apply":true}'
```

Each call handles one page. While the result has `isDone: false`, call again
with `"cursor"` set to the returned `continueCursor`. Repeat for
`"table":"highlightTips"` and `"table":"articleNFTs"`. The operator runs
these with the credential from section 5.0.2.

v1 rows confirmed after this stage (tips in flight at the freeze) have no
`contractVersion`. Stage 6, step 2 runs this backfill once more after the
drain.

**Claim records (#596).** The release records each applied `Claimed` event of
the Tab contract in `tabClaims`, and the `Claimed` handler adds the amount to
`collectedBaseUnits` only when it creates that record. Until a record exists,
a re-dispatch of an applied `Claimed` event would count it again.
`chain/tabClaims:seedClaimRecords` records every applied `Claimed` event of
the current contract set and epoch that has none, and changes no total.
Run it here, after stage 3: while `TAB_CONTRACT_ID` or `TOKEN_CONTRACT_ID` is
unset it returns `seeded: 0` without reading any event. Run, in this order:

```bash
bunx convex run chain/tabClaims:seedClaimRecords '{}'
bunx convex run chain/tabClaims:seedClaimRecords '{"apply": true}'
bunx convex run chain/tabClaims:seedClaimRecords '{}'
bunx convex run chain/tabClaims:recomputeCollected '{}'
```

Each call handles one page. While the result has `isDone: false`, call again
with `"cursor"` set to the returned `continueCursor`. Without `"apply": true`
both functions only count: `seeded` is the number of applied events without a
record, and `differences` lists each writer whose `collectedBaseUnits` differs
from the sum of their records. The `live` set is new at stage 3, so the live
deployment has no tab claim yet: expect `checked: 0` and `seeded: 0` from
every `seedClaimRecords` call, and `"status": "dry_run"` with
`"differences": []` from `recomputeCollected`. The step still runs because it
is the check that no applied claim lacks its record before v2 is switched on.

**Check:** the backfill's final dry run for each table reports
`"toUpdate": 0`; the final `seedClaimRecords` dry run reports `seeded: 0`; and
`recomputeCollected` reports `"differences": []`. If a difference appears,
stop: do not apply `recomputeCollected` without an incident note (chain
runbook, "Collected earnings").
**Rollback:** not needed. `contractVersion` is optional, and an unset value
already reads as `v1`. A claim record changes no total.

### Stage 5. Freeze v1 and drain

1. Set `CHAIN_V1_PREPARES_ENABLED=false`. Record the time as T.
2. Wait at least 15 minutes after T (the v1 intent lifetime).
3. Drain the v1 verifications. In the Convex dashboard **Data** view, filter:
   - `tips`: `status` is `PENDING` or `CONFIRMING`;
   - `highlightTips`: `status` is `PENDING`;
   - `articleTipIntents` and `highlightTipIntents`: `expiresAt` greater than
     now.

   To avoid the 6-hour wait for highlight tips, the operator can run
   `reconcileTips:recoverStuckPendingHighlightTips` and
   `reconcileTips:recoverStuckPendingArticleTips` once from the dashboard.

**Signed v1 transactions in browsers.** The v1 dialogs keep each signed
transaction in the reader's browser storage
(`quilltip:pendingArticleTipReceipt:v2:*` and
`quilltip:pendingHighlightTipReceipt:v2:*`) so that the dialog can register
it again after a reload. The dialogs store the transaction, register it with
the server, and only then send it to Stellar. So a stored transaction is in
one of two cases:

- It was registered: its tip row is one of the rows that the drain above
  waits for.
- It was never registered: it was never sent, and its time bound (the intent
  expiry, at most 15 minutes after prepare) has passed by step 2, so it can no
  longer land on chain. Nothing was paid.

After the drain no stored transaction can create a payment. The release
site cannot register a stored transaction. It removes these entries when an
article tip button renders (`lib/tip/legacyTipStorage.ts`, #559), which
happens only on a registered article with v2 on; until then they stay in the
browser as inert data.

The release site shows no v1 tip action from stage 2 on (section 1.2,
item 2), so this freeze is for the previous site still open in a browser and
for any other caller of the v1 functions.

**Check:** every filter returns 0 rows. A direct call to
`tips:prepareArticleTip` fails with "Tips and NFT actions are paused for a
short time while payments are updated. Nothing was charged." The release
site is unchanged: the article
page and the passage tip action show the same note, and the article NFT
section shows "Article NFTs aren’t available on this site right now."
**Rollback:** none. The release site has no v1 tip flow, so turning v1
prepares on again would only serve the previous site. Leave
`CHAIN_V1_PREPARES_ENABLED=false`.

### Stage 5A. Rebuild the writers' lifetime totals

The release adds lifetime totals to each `authorEarnings` row (#567):
`v1TipCount`, `v1EarnedCents`, `v1ShareStroops`, `v1UnpricedTipCount`,
`tabTipCount`, `tabEarnedCents`, `tabSettledBaseUnits` and
`walletEarnedBaseUnits`, marked complete by `lifetimeTotalsAt`. A row is
rebuilt from its history: the writer's `tips` and `highlightTips`, then the
tab pairs (`tabVouchers`) of the writer's addresses, counting each tab tip by
the net its receipt has been paid on chain. The rebuild writes only
`authorEarnings` (`convex/earningsTotalsBackfill.ts`).

Run this stage after the stage 5 drain, so that every v1 tip has its final
state, and after any `authorEarningsBackfill:run` apply from stage 1, step 6
has completed. Finish it before stage 6. The two jobs write different fields:
`authorEarningsBackfill:run` rewrites the earlier cent totals, which the
rebuild does not read, so the code itself does not need this order; it keeps
both sets of figures from the same final rows.

1. Dry run, page by page, with no writes:

   ```bash
   bunx convex run earningsTotalsBackfill:dryRun '{}'
   bunx convex run earningsTotalsBackfill:dryRun '{"cursor":"<continueCursor>"}'
   ```

   Repeat with each `continueCursor` until `"isDone": true`. A page holds 20
   rows (`limit` sets up to 50). For each writer it shows `shown` (the figures
   the stats screen shows now), `rebuilt` (the figures after the rebuild) and
   `changedFields`. Review the differences and record them. A row that the
   release code created after stage 1 starts with lifetime totals and shows
   `"source": "lifetime"` with no changed field. A writer with settled tab
   tips can show more tips and dollars after the rebuild: the figures shown
   before it include tab tips in the XLM amount, but not in the tip count or
   the dollar estimate.

2. Set `EARNINGS_TOTALS_REBUILD_ENABLED=true`. The cron
   `rebuild lifetime earnings totals` runs `earningsTotalsBackfill:run` every
   minute. A run advances the 20 rows that have waited longest, by up to 10
   steps each; a step reads one page of up to 200 rows. With the switch unset
   or any value other than `true`, a run returns before it reads anything.
3. Poll the progress:

   ```bash
   bunx convex run earningsTotalsBackfill:progress
   ```

   The rebuild is finished when `rebuilt` equals `total`, `waiting` is 0, and
   `inProgress` and `failed` are empty. Do not use `complete` as the finished
   signal: it only says that the progress scan read every row (it stops at
   10,000 `authorEarnings` rows and 10,000 settled tip rows). The counts
   cover at most the first 10,000 `authorEarnings` rows: if `total` is
   10,000, they do not show that every row is rebuilt.
   `settledTabRowsWithoutApplied` counts settled tab tips without
   `earningsAppliedAt`; the rebuild still counts them from their receipts.

A row whose history fits in 10 steps finishes in its first turn, so N rows
take about ⌈N/20⌉ minutes; a longer history takes more turns without holding
up the rows behind it. Measured: on a deployment with one row, the row took 3
steps and was rebuilt at the next cron tick, with all 22 earlier fields
unchanged; in a rehearsal on a local backend with three writers (v1, wallet and
tab tips; wallet and tab tips; v1 tips only), each row took 3 steps, the
rebuild finished 36 s after the switch was set (22 s after a `reset`
restart), no earlier field and no other table changed, and the dry run took
1 s.

Measured at scale on a local backend with 300 synthetic writers (10,935
documents in all):

- All 300 rows were rebuilt in 999.5 s, 18 rows a minute against the code's
  ceiling of 20. No row failed.
- The rebuilt totals matched independently computed totals for every
  writer, with 0 mismatches, including writers credited during the run and
  the largest writer.
- Per writer: up to about 50 history rows took 3 steps; about 1,800 rows
  with 600 tab pairs took 9 steps; about 5,500 rows took 30 steps over 3
  runs and waited its turn between them.
- The dry run over the 300 rows took 197 s, on a machine under heavy load
  (load average 88 to 100).

Leave the switch on. It is needed for a new row of a user who already has v1
tips, for every row after `earningsTotalsBackfill:reset`, and for a retried
row. With nothing waiting, a run costs one indexed query a minute.

**Failed rows.** A step that fails records `lifetimeRebuildError` and
`lifetimeRebuildFailedAt` on its row, and the run goes on with the other
rows. `progress.failed` lists each failed row's id, user, error and time. The
queue skips a failed row until `earningsTotalsBackfill:retryFailed` puts it
back (`'{"id":"<row id>"}'` for one row, `'{}'` for every failed row); it then
resumes from its saved position.

**What readers see.** The previous frontend reads only the earlier fields, so
it shows the same figures as before, for every row. The release frontend
shows the earlier figures for a row until it is rebuilt, and its lifetime
figures after that.

**Check:** the progress reports finished as above, and a second dry run shows
`"source": "lifetime"` and an empty `changedFields` for every writer.
**Rollback:** set `EARNINGS_TOTALS_REBUILD_ENABLED=false`. Each row in
progress keeps its saved position and resumes when the switch is on again.
The lifetime fields are optional and additive; no earlier field changes. To
return the rows to the shape before #567 (for a rollback of the functions),
run `earningsTotalsBackfill:reset '{"mode":"remove"}'`, which unsets every
lifetime field. `'{"mode":"restart"}'` keeps the fields and rebuilds every
row again.

### Stage 6. Switch on v2

1. Confirm that the healthy settler run of stage 3 (**Check**) is recorded,
   with its time and result. If `TAB_SETTLER_SECRET` changed after it,
   record a new healthy run first.
2. Run the stage 4 backfill again for the three tables (dry run, apply, dry
   run), so that the v1 rows confirmed during the drain carry
   `contractVersion: 'v1'`.
3. Set `CHAIN_V2_ENABLED=true` on the live deployment. Record the time.
4. Run the post-cutover verification (section 7) at once.

**Check:** the backfill's final dry runs report `"toUpdate": 0`, and
section 7.1 passes.
**Rollback:** payments off (section 6, row D), then fix forward.

## 6. Rollback plan

The v1 client removal ships in the release (#559). Once the release site
passes the stage 2 check, there is no return to v1 tipping. The rollback is
payments off (`CHAIN_V2_ENABLED=false`), then fix forward. With payments off
the release site shows the paused and unavailable notes (section 1.2,
item 2). The v1 freeze and the 15-minute drain stay (stage 5). v1 history,
receipts and past earnings stay readable in every case.

| Stage reached                       | Rollback                                                                                                                                                                                                                                                         | Data step                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Stage 1                          | Leave the release code with the switches off (stage 1). The previous site keeps working, with the section 2.3 exceptions.                                                                                                                                        | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| B. Stage 2, before its check passes | Only if the release site does not work at all: the Vercel owner runs Instant Rollback (stage 2). Fix and roll forward as soon as possible.                                                                                                                       | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| C. Stage 2 passed, up to stage 5A   | Reverse the last setting of stage 3 or 5A: `SETTLEMENT_ENABLED=false`, remove the v2 contract IDs and `INDEXER_START_LEDGER`, or `EARNINGS_TOTALS_REBUILD_ENABLED=false`. Payments stay off on the site.                                                         | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D. Stage 6 and later: payments off  | 1. Set `CHAIN_V2_ENABLED=false`. Leave `CHAIN_V1_PREPARES_ENABLED=false`. 2. Keep the indexer, the settler and `SETTLEMENT_ENABLED=true`. 3. Pause the v2 Tab: `bun run contracts:roles-v2 --set live --keys-dir <dir> --action pause --contracts tab --submit`. | None. v1 and v2 rows stay and remain visible. Accepted vouchers still settle. A writer can still claim from the collect panel, which calls the Tab contract directly. The contract still lets readers withdraw and revoke keys (I-27), but the app's tab operations (`tabs:prepareWithdrawStart`, `prepareWithdraw`, `prepareRevokeKey` and the others) refuse with `CHAIN_V2_DISABLED` while `CHAIN_V2_ENABLED=false`, so those actions need a wallet or the Stellar CLI. |

No rollback in this plan needs a data step. The stage 0 snapshot restore
(section 6.2) is the last resort.

A return to v1 tipping is not a rollback in this plan. It would mean
restoring the removed client code from Git in a new release and turning v1
prepares on again.

Payments off does not stop v2 records that are already in flight. The
`recheck pending chain submissions` cron and the indexer still resolve them,
because verification does not depend on `CHAIN_V2_ENABLED`.

Never roll back by pushing `main`'s earlier backend code (section 2.2).

A code rollback to an earlier commit of the release branch has a similar
limit. Once a tab settlement is recorded, `tabAccounts.settledUnindexed` and
`tabVouchers.indexedPaid` hold values, and a tab that waited for a
reconciliation has had `tabAccounts.reconcileRequired`. Any code pushed after
stage 1 must keep these optional fields in its schema, or Convex refuses the
push.

### 6.1 Return to v2 after payments off

1. Find the cause and fix it forward. Push backend code with the procedure
   and the push rule in section 5.0.2; site fixes go through the Vercel
   owner.
2. Unpause the v2 Tab:
   `bun run contracts:roles-v2 --set live --keys-dir <dir> --action unpause --contracts tab --submit`.
   The report then shows `tab paused false`.
3. Set `CHAIN_V2_ENABLED=true` and run section 7.1 again. No v1 tip was made
   while payments were off (v1 prepares stayed off), so the stage 4 backfill
   is not needed again.

### 6.2 Snapshot restore (last resort)

A restore is the last resort. Payments off covers every planned rollback
(section 6). After stage 2, fix forward: turn payments off for a payment
defect, and correct other defects in code. Restore only when data
written by a defect cannot be corrected forward, and only with the owner's
decision.

Know what a restore costs, even when every step below succeeds:

- **Payments cannot be reversed.** Every tip, deposit, settlement, claim,
  mint and transfer after the snapshot stays on chain. The restore must bring
  the database back into line with the chain (step 4), not the other way.
- **The whole site is down while the deployment is paused** (steps 1 to 6).
  Every page that reads Convex shows an error.
- **Rows that the defect damaged are lost** where they were written after
  stage 0 and cannot be re-derived. They come back at their stage 0 state.
- **Some payment facts exist only in the database:** the app article for an
  event (an event for an article that is not in the database is an
  `orphan`), v1 intents, the reader's account for a v1 tip, the USD amount and
  price quote at the time, and tip messages. They come from the second export
  (step 2) or not at all.
- **Not in any snapshot:** environment variables, the code, and scheduled
  functions. Pending scheduled functions run when the deployment resumes.

Measured on a disposable local backend with a small data set (5 users,
3 articles, 5 tips, 1 file): the deployment was paused for 4 min 26 s,
including a 2-minute wait to observe scheduled functions. Each command took
under 10 s; the full path, with checks, took about 10 minutes.

A second run added tab activity after the snapshot: a top-up, tab tips to two
writers, a settlement with a skipped pair, a writer's own settlement, a claim,
an accepted tip left unsettled and a settlement recorded but not yet indexed
at the pause. The deployment was paused for 5 min 31 s, and the path from
pause to reopened payments took 8 min 18 s. After the resume the indexer
applied the late settlement, and every tab, payment and earnings figure
matched the chain.

On a cloud development deployment with synthetic data (16,505 documents,
37 MB, and 100 files, 20 MB), with the restore file built in advance: the
deployment was paused for 4 min 39 s; the export took 11 s, the import 67 s,
and an import refused for a type error 25 s. Steps 3 and 4 with live data
take longer than the commands; the operator confirms the path on a
development deployment first (section 1.4).

Use the credential from section 5.0.2 for every command.

#### Step 1. Stop every write

Pause the deployment: Convex dashboard, **Settings → Pause deployment**. The
deployment API offers the same call
(`POST <deployment URL>/api/v1/pause_deployment`, header
`Authorization: Convex <key>`, the credential from section 5.0.2). While
paused, the
deployment refuses every function call: queries, mutations, actions, HTTP
actions (including uploads), sign-up and sign-in, and `convex run`. An open
tab gets an error at once: its queries fail and each mutation it sends is
refused with the paused message. The Convex client does not send a refused
call again, so nothing sent during the pause runs on the restored data. Its
subscriptions answer again within a second of the resume; a page that showed
an error may need a reload. Crons are skipped. Scheduled
functions wait and run at resume. A maintenance page on the site alone is not
enough: an open tab calls Convex directly.

What still works while paused: `convex export`, `convex env set` and
`env remove`, `convex import`, `convex deploy`, `convex data` (also for
`_scheduled_functions`), and **Cancel all** in the Schedules view.

**Check:** a query from outside is refused:

```bash
curl -s -X POST <deployment URL>/api/query -H 'content-type: application/json' \
  -d '{"path":"chain/config:getChainConfig","args":{}}'
```

The answer contains `Cannot run functions while this deployment is paused.`

#### Step 2. Second export

```bash
bunx convex export --include-file-storage --path <after-incident>.zip
```

Keep it beside the stage 0 snapshot, outside the repository. It is the only
copy of the work done after stage 0. Record its size, the time and the latest
testnet ledger (`getLatestLedger`).

#### Step 3. List every payment since the snapshot

From the ledger of the stage 0 snapshot to now:

- **v2:** contract events of the Core, Tab and NFT contracts (RPC
  `getEvents`, contract filter). The public RPC keeps about 7 days of events
  (`oldestLedger` in the answer). Older ledgers need an archive RPC or a
  hosted indexer; their events go in with `chain/indexer:ingestBackfill`.
- **v1:** `tip_article` and `tip_highlight_direct`, the v1 functions the app
  calls, emit no contract event (only the batch functions do). List the
  native XLM contract's `transfer` events to each writer's address, and keep
  the transactions whose operation calls the v1 contract with one of the
  function names the server verifies (`TIP_ARTICLE_FUNCTIONS` and
  `TIP_HIGHLIGHT_FUNCTIONS` in `convex/lib/constants.ts`; Horizon
  `/transactions/<hash>/operations`).
- **Before the snapshot:** check that each final payment row in the stage 0
  snapshot that has a transaction hash has its transaction on chain (Horizon
  `/transactions/<hash>`). Tab tips (`tips` rows with `channel` `tab`) have no
  hash of their own: their payment is the settlement of their pair, which is
  a `tabSettlements` row. A send that failed before it reached the chain has
  no hash either.

The result is a list of transaction hashes that the restored rows must match.

#### Step 4. Build the restore file

Start from the stage 0 snapshot and decide per table, with the second export:

| Table group                                                                                                                                                             | Source in the restore file                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables the defect damaged                                                                                                                                               | Stage 0 snapshot. Re-apply rows from the second export only after review, one by one.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Other non-payment tables (`users`, `articles`, `authAccounts`, `authSessions`, `authRefreshTokens`, `_storage`, uploads, highlights, and the rest)                      | Second export. This keeps new accounts, edited articles and drafts, uploaded files, profile changes and wallet verifications.                                                                                                                                                                                                                                                                                                                                                                       |
| Payment tables with a transaction per row (`tips` except tab tips, `highlightTips`, `articleNFTs`, `nftTransfers`, `chainSubmissions`, `tabSettlements`, `withdrawals`) | A row from the second export only if its transaction hash is in the step 3 list, or if it is not final yet (for example `PENDING`, `PREPARED` or `SUBMITTED`; verification, the recheck cron and the settler resolve it against the chain). Otherwise the stage 0 row if it existed, else leave it out and list it for review. Keep `earningsAppliedAt` and `earningsSkipReason` as exported.                                                                                                       |
| Tab ledger (`tabAccounts`, `tabSessionKeys`, `tabVouchers`, `tabReceipts`, `tabBalanceDebits`, and the `tips` rows with `channel` `tab`)                                | Second export. Accepted vouchers and receipts are signed by the reader and settle on chain later; they have no transaction of their own. Each tab tip's `tips` row is linked to its receipt (`tabReceiptId`, `tipRowId`): keep the two together, or the receipt points to a missing tip and the writer's earnings lose it. Take `tabBalanceDebits` from the same export as `tabAccounts`: an absolute balance subtracts the debit rows after it, so a missing row would leave the balance too high. |
| `chainArticles`                                                                                                                                                         | Second export (the indexer needs these rows to link events).                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `chainEvents`, `chainCursor`                                                                                                                                            | Second export, unless the defect damaged them. They record which events are already applied to the rows above, so the indexer continues from its cursor and applies nothing twice.                                                                                                                                                                                                                                                                                                                  |
| `authorEarnings`, `tabClaims`, `tabClaimCorrections`                                                                                                                    | Second export, unless the defect damaged `authorEarnings` or a credited payment row is left out (see below). Take `tabClaims` from the same export as `authorEarnings`: a claim record marks a `Claimed` event as counted in `collectedBaseUnits`, so a record without its amount is never counted, and an amount without its record is counted again when `chainEvents` is rebuilt.                                                                                                                |
| `chainLeases`, `chainConfig`                                                                                                                                            | Left out; the leases restart empty and step 6 loads the config.                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Rules for conflicts:

- A row changed after stage 0 and not damaged: the second export wins.
- An account created after stage 0 keeps its `users`, `authAccounts`,
  `authSessions` and `authRefreshTokens` rows together, or loses all of them.
  Never keep one without the others.
- Write the restore file in the snapshot format: one folder per table with
  `documents.jsonl` (and `generated_schema.jsonl`), `_storage` with its files,
  and `_tables`.

Earnings are not rebuilt from the rows. `authorEarningsBackfill:run`
recomputes only the cent totals, and only from `CONFIRMED` verified tips: it
leaves out settled tab tips and credited `MISMATCH` tips, and it does not
touch the base-unit fields. Applied after stage 6, it lowers the totals of
writers with such tips. So:

- If `authorEarnings` is not damaged and no credited payment row is left out,
  keep the second export's rows. Do not apply `authorEarningsBackfill:run`.
- Otherwise correct the affected writers' rows by hand from their payment
  rows, and record each correction. A rebuild of the writer totals that
  covers v2 tips is tracked in #552. From the restored rows, per writer:
  - cent fields (`totalEarnedCents`, `availableBalanceCents`, the USD
    fields, `tipCount`, `monthlyEarnings`, `topArticles`): every `tips` and
    `highlightTips` row of the writer with `earningsAppliedAt` set, each
    counted at `amountCents × net ÷ gross` of its base units;
  - `v2TipCount` and `v2EarnedCents`: the same, for direct v2 tips only;
  - `earnedBaseUnits`: the net of the direct v2 tips plus the `earnedNet` of
    the writer's `tabVouchers` rows;
  - `pendingBaseUnits`: the `pendingNet` of those vouchers;
  - `collectedBaseUnits`: not by hand. Step 6 sets it from the claim
    records.
- A hand-written number in the restore file needs a decimal point (`7.0`,
  not `7`): the import reads an integer as `int64` and refuses it for a
  number field. Correcting the row in the dashboard after the import avoids
  this.
- The lifetime fields (stage 5A) are not corrected by hand: step 6 rebuilds
  them for every row with `earningsTotalsBackfill:reset` and the rebuild.
  The rebuild takes the wallet part of a writer's figures from
  `earnedBaseUnits` (less the `earnedNet` of the writer's tab pairs), so it
  runs after the corrections above. It does not read the cent totals that
  `authorEarningsBackfill:run` writes; run it after that job anyway, as in
  stage 5A, so that both come from the same final rows.

If `chainEvents` or `chainCursor` was damaged, leave both out and rebuild
them with a replay in step 6. The replay applies every event again, and each
handler ignores an effect it already applied: a `Claimed` event with a
`tabClaims` record adds nothing to `collectedBaseUnits`. A replay from `INDEXER_START_LEDGER` needs every
event since that ledger within the RPC retention (about 7 days); older events
come from an archive RPC or a hosted indexer through
`chain/indexer:ingestBackfill`.

Keep the release code deployed: the stage 0 data fits the release schema.
Do not go back to `main`'s code: its schema has no place for v2 rows
(section 2.2), and it would return to v1 tipping, which this plan does not do
(section 6).

#### Step 5. Import (still paused)

```bash
bunx convex env set CHAIN_V1_PREPARES_ENABLED false
bunx convex env set CHAIN_V2_ENABLED false
bunx convex import --replace-all -y <restore-file>.zip
```

`--replace-all` replaces every table in the file and clears tables in the
schema that the file leaves out. Document IDs, creation times and files come
back as written in the file. Push code now only if it changes
(`bunx convex deploy --dry-run`, confirm, deploy).

Before resuming, review the `pending` entries in the dashboard **Schedules**
view and cancel those that must not run on the restored data. **Cancel all**
works while the deployment is paused. Cancelling single entries while paused
is untested. The crons repeat their periodic work after resume.

#### Step 6. Resume with payments frozen

Resume the deployment (dashboard, or `POST <deployment URL>/api/v1/unpause_deployment`).
Reading, writing and publishing work again; payments stay off. Then rebuild:

```bash
bunx convex run chain/config:refreshChainConfig
bunx convex run chain/backfill:setContractVersionV1 '{"table":"tips","apply":true}'
```

Run the contract version backfill for `highlightTips` and `articleNFTs` too,
page by page as in stage 4. With `chainEvents` and `chainCursor` from the
second export, the indexer continues from its cursor and reads the events
that reached the chain while the deployment was paused. Only if step 4 left
them out, rebuild them:

```bash
bunx convex run chain/indexer:replayFrom '{"fromLedger": <INDEXER_START_LEDGER>}'
```

The replay links each event to the restored rows.

Events older than the RPC retention (step 3) go in with
`chain/indexer:ingestBackfill` before the replay. Its input is a JSON array
of events in RPC `getEvents` form (`type`, `ledger`, `ledgerClosedAt`,
`contractId`, `id`, `txHash`, `topic`, `value`, and the optional
`operationIndex`, `transactionIndex` and `inSuccessfulContractCall`), such
as the file that `chain:backfill-events` writes (chain runbook, "Indexer
behind retention"). Keep the file outside the repository. Send it in pages
of 100 events (`.[100:200]` for the second page, and so on):

```bash
bun scripts/live-window.ts run convex-run chain/indexer:ingestBackfill "$(jq -c '{events: .[0:100]}' <events>.json)"
```

Stored events are skipped, so a page sent twice changes nothing. If the
replay starts after the ledger the index covers, pass
`"gapBackfilled": true` to `chain/indexer:replayFrom` once the gap is
filled; without it, the replay refuses with `REPLAY_GAP`.

Then check collected tab earnings against the claim records (chain runbook,
"Collected earnings"). Run `chain/tabClaims:seedClaimRecords` with
`"apply": true` until `isDone`: it records each applied `Claimed` event that
has no record and changes no total. Then run
`chain/tabClaims:recomputeCollected` as a dry run. Apply it, with the
incident note, only for the differences that step 4 explains.

Then rebuild the writers' lifetime totals from the restored rows. The
restored rows carry the totals of the stage 0 snapshot or the second export,
which do not match the restored history:

```bash
bunx convex run earningsTotalsBackfill:reset '{"mode":"restart"}'
bunx convex run earningsTotalsBackfill:progress
```

`EARNINGS_TOTALS_REBUILD_ENABLED` is not in the snapshot; it stays as it was
on the deployment, `true` after stage 5A. Poll the progress until it reports
finished (stage 5A). Until a row is rebuilt, the stats screen shows its
earlier figures.

#### Step 7. Reopen payments

Set `CHAIN_V2_ENABLED=true` only when all of these are true. Leave
`CHAIN_V1_PREPARES_ENABLED=false`:

1. Every transaction from step 3 that creates an app record has one: tips
   and registrations (`tips`, `highlightTips`, `chainSubmissions`), NFT mints
   and transfers (`articleNFTs`, `nftTransfers`) and settler settlements
   (`tabSettlements`). Tab deposits, withdrawals, claims and a writer's own
   settlements only change existing rows. Every final `v2` payment row that
   has a transaction hash has it in the step 3 list, or among the stage 0
   rows checked in step 3. Tab tips are checked through their pair's
   settlement.
2. `/ops/chain` shows status `OK`, a `lastRunAt` within the last 2 minutes
   and `events.error: 0`. In the **Data** view, the `chainEvents` rows with
   `handled` `orphan` and `pending` are the same as in the second export.
   Some are normal: the deploy's smoke-flow events stay `orphan`, and events
   that no handler records (role grants, pauses and Tab settings changes,
   for example) stay `pending`. A new
   `orphan` means a restored row is missing. (The `/ops/chain` counts stop
   at 100.)
3. `authorEarnings` equals the second export, apart from the corrections
   recorded in step 4 and the lifetime fields rebuilt in step 6.
   `earningsTotalsBackfill:progress` reports the rebuild finished: `rebuilt`
   equals `total`, `waiting` 0, `inProgress` and `failed` empty.
4. The rows left out in step 4 are reviewed and recorded in the incident
   record.
5. A comparison of a new export with the second export shows the expected
   differences only: the damaged tables and the left-out rows; the lifetime
   fields of `authorEarnings` (`lifetimeTotalsAt` and the totals); `chainConfig`
   and `chainLeases`, which step 4 left out and the deployment rebuilt; the
   events indexed after the resume, with their effect on the rows they
   apply to (`chainEvents`, `chainCursor`, and for example `tabAccounts` and
   `tabVouchers` for a settlement indexed late); and the price cache.
6. `chain/tabClaims:seedClaimRecords` reports `seeded: 0` and
   `chain/tabClaims:recomputeCollected` reports no differences, both as dry
   runs.

Then fix the site forward if needed, and remove the pause notice.

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

**Pending events.** A `chainEvents` row with `handled` `pending` whose event
type has a handler is waiting, for example for a variable or a handler
deploy; it is not at rest. After you set a variable or deploy a handler that
a stored event waits for, run this once:

```bash
bunx convex run chain/indexer:redispatch
```

The result gives `checked` and `resolved`. One run checks at most `limit`
pending rows (default 200, at most 500; for example `'{"limit":500}'`).
Events that no handler records stay `pending` by design, so they count in
`checked`:

- Core and Tab: `role_granted`, `role_revoked`, `role_admin_changed`,
  `admin_transfer_initiated`, `admin_transfer_completed`, `paused` and
  `unpaused`. The contract deploy emits the role grants.
- Tab only: `limits_set`, `treasury_set`, `acceptor_set` and `migrated`.

The NFT contract's events of these kinds have handlers and are recorded as
`done`. `redispatch` reads the oldest `pending` rows first, so rows at rest
stay at the front. If `checked` equals the limit, run again with
`'{"limit":500}'`.

### 7.3 Settler run

After the tab tip in 7.1, the next `settle due tab vouchers` run (every 10
minutes) submits a settlement. Check the Convex logs for the cron: no
`TAB_SETTLER_UNAVAILABLE`, `TAB_SETTLER_RUN_FAILED`, `TAB_SETTLER_REJECTED` or
`TAB_SETTLER_BALANCE_LOW`.
The settler account holds more than 50 testnet XLM.

A settled amount stays held back from the reader's free balance until the
indexer applies its `TabSettled` event. In the Convex **Data** view,
`tabAccounts.settledUnindexed` returns to `0` (or is unset) for the reader
within a few minutes of the settlement. A value above 0 for more than an hour
means a `TabSettled` event was not indexed: check the indexer (7.2). The
reader's free balance then reads lower than the chain balance, which is safe.
There is no correction tool yet; it is tracked in #573.

### 7.4 TTL report

```bash
bun run contracts:extend-v2 --set live --keys-dir <dir>
```

No entry is `archived`. Extend `due` entries with `--submit`.

### 7.5 Flagged payments

`/ops/chain` lists no tip flagged for review. Resolve any flagged tip with
`chain/review:resolveFlaggedTip` as described in [setup](../SETUP.md).

## 8. v1 removal

The v1 client removal (#559) ships in the release: the release site has no
v1 tip or NFT flow and reads no v1 client variable. The rest follows section
8.6 of the specification, in separate PRs to `overhaul/v2` or `main`, each
passing `bun run check` and the Playwright fixture suites.

- **v1 backend functions.** The v1 Convex functions (prepare, submit,
  verification, recovery and their crons, specification section 6.3) stay
  on the backend for now. Until a later backend PR removes them, the
  verification and recovery functions finish the v1 tips registered before
  the freeze, and `CHAIN_V1_PREPARES_ENABLED=false` refuses new v1 records.
  Deploy that PR only after the release site is live and the stage 5 drain
  is complete, so that no open browser tab calls a removed function in
  flight. It also removes the v1 mint metadata path:
  `nftMetadataUpload:uploadNftMetadataForMint`, `nfts:generateNFTMetadata`,
  and `convex/lib/nftMetadata.ts` if nothing else uses it, with their tests
  and `docs/tipping-contract-testnet-deploy.md`. Arweave stays off until it
  ships (section 3.3).
- **v1 data.** v1 rows are kept and stay labelled. The v1 tables
  `articleTipIntents` and `highlightTipIntents` are kept read-only as an
  audit trail: existing tip rows refer to them. The release site reads v1
  history, receipts and earnings through the v1 read queries
  (`tips:getUserSentTips`, `tips:getUserReceivedTips`,
  `highlightTips:getByTipper`, `highlightTips:getByAuthor`,
  `tips:getMyEarningsSummary`, `highlightTips:getArticleStats`), the
  profile NFT tab through `nfts:getNFTsByOwnerPaginated` and
  `nfts:getUserMintedNFTsPaginated`, and the "v1 record" line of the NFT
  section through `nfts:getNFTByArticle` (read only while v2 is on). They
  stay; only unused ones are removed.
- **Vercel variables.** The release site does not read
  `NEXT_PUBLIC_TIPPING_CONTRACT_ID`, `NEXT_PUBLIC_PLATFORM_ADDRESS`,
  `NEXT_PUBLIC_NFT_CONTRACT_ID` or `NEXT_PUBLIC_NFT_METADATA_URL`. Hand-off
  to the Vercel owner: remove them after stage 2 passes. Check: the next
  production build passes the stage 2 health command.
- **Convex variables.** `TIPPING_CONTRACT_ID`, `HORIZON_URL`,
  `RECONCILE_TIPS_ENABLED` and `CHAIN_V1_PREPARES_ENABLED` are removed only
  after the backend PR that stops reading them is deployed.

The Horizon and earlier RPC names have readers outside the v1 code. The PR
that removes them changes each of these:

| Variable                      | Readers outside the v1 code                                                                                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_HORIZON_URL`     | `lib/stellar/v2/config.ts` (checked against the network guard), `lib/stellar/config.ts` (client network guard), `proxy.ts` and `lib/security/contentSecurityPolicy.ts` (`connect-src`), `scripts/lib/network-guard.ts`, `.github/workflows/ci.yml` |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | The same files, and `convex/lib/stellarNetwork.ts`                                                                                                                                                                                                 |
| `HORIZON_URL`                 | `convex/lib/networkGuard.ts`, `scripts/lib/network-guard.ts`                                                                                                                                                                                       |
| `NEXT_PUBLIC_NFT_CONTRACT_ID` | `scripts/stellar/v2-nft-config.test.ts` (checks that the v2 client does not read it)                                                                                                                                                               |
| `TIPPING_CONTRACT_ID`         | `scripts/tips/v1-prepare-switch.test.ts` and `scripts/articles/tip-quote.test.ts` (tests of the v1 functions)                                                                                                                                      |

The tests that set these variables change in the same PR.

The practice wallet (`lib/stellar/practice.ts`) uses the testnet Horizon
origin on its own, so the content security policy keeps that origin after
the variables are gone.

## 9. Maintenance schedule

| Task                                 | When                                                                                           | Command or place                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TTL report and extension, `live` set | Twice a week (for example Monday and Thursday), and within 3 days of any deploy or role change | `bun run contracts:extend-v2 --set live --keys-dir <dir> --submit`                                                                                                                                        |
| TTL report, `integration` set        | Same                                                                                           | `--set integration`                                                                                                                                                                                       |
| Indexer status and flagged tips      | Daily                                                                                          | `/ops/chain`; `tabAccounts.settledUnindexed` above 0 for more than an hour (section 7.3); any tab under "Waiting for a reconciliation" (chain runbook)                                                    |
| Settler balance and lag alerts       | Daily, and on every `TAB_SETTLER_*` log line                                                   | Convex logs; fund the settler from Friendbot below 50 XLM                                                                                                                                                 |
| Settler runs                         | Daily; never 3 days without a run (go/no-go item 8)                                            | `SETTLEMENT_ENABLED=true`; the `settle due tab vouchers` cron has a recent run (dashboard cron jobs list)                                                                                                 |
| Tab reconciliation                   | Daily                                                                                          | [Chain runbook](chain-runbook.md#stale-settlement-reserves): a dry run for each tab listed, from the Convex dashboard (see the note below the table). The command waits up to 2.5 minutes for the indexer |
| Roles report                         | Weekly, and after any role change                                                              | `bun run contracts:roles-v2 --set live --keys-dir <dir>`                                                                                                                                                  |
| Live deployment snapshot             | Weekly, and before the v1 backend removal PR is deployed                                       | Convex dashboard snapshot export                                                                                                                                                                          |
| Testnet reset check                  | After every announced testnet reset                                                            | [Chain runbook, testnet reset](chain-runbook.md#testnet-reset)                                                                                                                                            |
| v1 backend removal PR                | After the release site is live and the stage 5 drain is complete                               | Section 8                                                                                                                                                                                                 |
| Writers' lifetime totals             | After a restore or an `earningsTotalsBackfill:reset`, and when `progress.failed` lists a row   | `bunx convex run earningsTotalsBackfill:progress`; `retryFailed` for a failed row (stage 5A)                                                                                                              |

**Tab reconciliation on the live deployment.** Outside a window, the network
guard has no approval that allows the reconciliation dry run and refuses an
apply: its operational approval does not tell the two apart. The window tool
(section 5.0.3) refuses `chain/tabReconcile:run` in both forms, because the
function is not on its list. Until a guard follow-up adds a dry-run-only
approval, the owner runs the daily dry run from the Convex dashboard
(**Functions**, `chain/tabReconcile:run`, without `apply`). An apply needs a new
window approval, after a reviewed change that adds the function, with its
`apply` and `note` arguments, to the window tool's list.
