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
4. **Client behaviour while `CHAIN_V2_ENABLED=true`.** `TipButton` and
   `HighlightTipButton` read `chain/config:getChainConfig` and render the v2
   flows (`ArticleTipV2`, `HighlightTipV2`, through `tipsV2`).
   `NFTIntegration` renders `ArticleNftV2` (the v2 NFT functions). The v1
   dialogs render only while v2 is off. On an article that is not
   registered, the tip area shows the unregistered note, not a tip button.
   Both contract IDs must be set before stage 6. If one is missing:
   - No `CORE_CONTRACT_ID`: `chain/articles:getArticleTipAvailability`
     returns `paused`, and the article tip area and the passage tip action
     show the paused note from item 3.
   - No `NFT_CONTRACT_ID`: `nftsV2:getMintProgress` returns `DISABLED`.
     While the v1 code is deployed, the NFT section shows the v1 panel. After
     the removal (section 8) it shows "Article NFTs aren’t available on this
     site right now."
   - No `NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID` on the site, or a value other
     than `NFT_CONTRACT_ID`: the NFT section offers no mint or transfer and
     says that minting is not available on this site (section 2.5).
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

### 1.5 People and material

- The owner is available for the whole window and holds: the live Convex
  deployment access, the Vercel project, and the key directory for the
  `live` contract set (created by stage 3).
- An operator has a Convex user ID in `OPS_USER_IDS` on the live deployment,
  so `/ops/chain` shows the indexer status.
- A snapshot of the live deployment exists from the day of the cutover
  (Convex dashboard, **Settings → Snapshot export**, or
  `bunx convex export --path <file>` with the owner's credentials). Keep it
  outside the repository.
- Authors were told in advance that they must verify their wallet and press
  **Enable tips** on each article after the switch (section 4.3). The owner
  decides who sends this notice and when, relative to stage 6.

### 1.6 Owner decisions recorded before stage 0

Record each answer in the cutover tracking issue.

1. **Backend push method.** How the release functions reach the live
   deployment (deploy key, CLI login or another method). Stage 1 uses it.
2. **Earlier v1 maintenance.** Whether the internal functions
   `legacyTipCleanup:run` and `authorEarningsBackfill:run` were applied on the
   live deployment. If not, v1 tip counts and earnings may include tips that
   were never verified; run them (dry run first) before stage 4.
3. **v1 admin key.** Whether the v1 tipping contract's admin key is available.
   Without it, stage 7 is skipped and section 4.2 applies.
4. **Release scope.** Whether the non-payment work on `overhaul/v2` reaches
   `main` in an earlier release, so that the cutover release holds only the
   payment change.
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
and refuses the push if one does not match. These rows would fail `main`'s
schema:

- a `highlightTips` row without `stellarTxId`, `stellarNetwork`, `stellarMemo`
  or `processedAt` (v2 batch and tab rows);
- an `articleNFTs` row without `mintedBy` or `currentOwner` (a v2 NFT whose
  minter or owner address is not a Quilltip user), or without `tipThreshold`
  or `totalTipsAtMint` (every v2 NFT row, which keeps base-unit totals
  instead);
- an `nftTransfers` row without `fromUserId` or `toUserId` (a v2 transfer
  between addresses that are not Quilltip users).

Rows in the new tables are also outside `main`'s schema. Roll back with the
switches (section 6), and keep the release code deployed.

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

**NFT token URI.** Set `SITE_URL` to the public site URL
(`https://www.quilltip.me`) on the live deployment before the first v2 mint.
The indexer stores each minted token's metadata URL as
`<SITE_URL>/api/nft/<token id>` (`convex/lib/chain/nftStore.ts`) when it
records the mint, and the stored URL does not change afterwards. On the
integration deployment `SITE_URL` is `http://localhost:3000`, so its tokens
point there. The NFT contract's own `base_uri` is set at deploy; check that
the `live` set's value in `docs/contracts/v2-testnet-deployment.md` is
`https://www.quilltip.me/api/nft/`.

### 3.2 Vercel (site)

`NEXT_PUBLIC_*` values are built into the site, so a change needs a new
deployment. Set these on the production environment before stage 2:

| Variable                                                                                                                              | Value                | When                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_STELLAR_NETWORK`                                                                                                         | `TESTNET`            | Already set                                                                                                                                                |
| `NEXT_PUBLIC_STELLAR_RPC_URL`, `NEXT_PUBLIC_NETWORK_PASSPHRASE`                                                                       | Testnet values       | Stage 2                                                                                                                                                    |
| `NEXT_PUBLIC_CORE_CONTRACT_ID`, `NEXT_PUBLIC_TAB_CONTRACT_ID`, `NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID`, `NEXT_PUBLIC_TOKEN_CONTRACT_ID` | The `live` set       | Stage 2 (after stage 3 when the set is new)                                                                                                                |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`                                                                                                | The Reown project ID | Stage 2. Blank turns WalletConnect off; a malformed value stops the build. The project's domain allowlist must include `www.quilltip.me` and `quilltip.me` |
| `NEXT_PUBLIC_NFT_CONTRACT_ID` (v1 NFT)                                                                                                | Unchanged            | Removed with the v1 code (section 2.5)                                                                                                                     |
| `NEXT_PUBLIC_TIPPING_CONTRACT_ID`, `NEXT_PUBLIC_PLATFORM_ADDRESS`, `NEXT_PUBLIC_HORIZON_URL`                                          | Unchanged            | Removed with the v1 code                                                                                                                                   |

If the live contract set is deployed after the site, rebuild the site once the
contract IDs are set. `NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID` must equal the
backend's `NFT_CONTRACT_ID`; unset or different, the NFT section offers no
mint or transfer (section 1.2, item 4).

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
  highlight tips every 6 hours. Stage 5 waits for both.
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

### Stage 0. Freeze and tag

1. Stop merges to `overhaul/v2` except cutover fixes.
2. Tag the release commit: `git tag payments-v2-cutover.1 <sha>` and push the
   tag.
3. Take the live deployment snapshot (section 1.5).

**Check:** the tag points to the commit whose checks are recorded in 1.3.
**Rollback:** none needed.

### Stage 1. Release backend on the live deployment (switches off)

1. Confirm on the live deployment: `CHAIN_V2_ENABLED` is unset or `false`,
   and no v2 contract ID is set.
2. Merge the release PR (`overhaul/v2` into `main`) only when the owner is
   ready to run stage 2 at once. Vercel builds `main` on merge.
3. The owner pushes the release commit's functions and schema to the live
   deployment with the method used for that deployment today (for example
   `bunx convex deploy` with its deploy key). Run
   `bunx convex deploy --dry-run` first with the same credentials.

**Check:**

- The push completes with no schema error.
- Convex dashboard, **Functions**: `chain/indexer:pollEvents`,
  `tabSettler:settleDue` and `tipEarnings:syncV2TipEarnings` exist. Their
  cron logs show that they return without work (no contract configured).
  Without v2 settings the five v2 crons make no RPC call and write no row
  (`scripts/chain/crons-unconfigured.test.ts`). Together they add about
  3,800 short function calls a day (indexer and earnings sync every minute,
  recheck every 2 minutes, settler every 10 minutes, config refresh hourly).
- `GET https://www.quilltip.me/api/health` returns 200.

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
then apply, so roll forward again as soon as possible.

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

2. The owner sets variables 2 to 12 of section 3.1 on the live deployment, in
   that order, with `CHAIN_V2_ENABLED=false`.
3. The owner sets the Vercel contract IDs from section 3.2 and redeploys the
   site if stage 2 already ran.

**Check:**

- `bun run contracts:roles-v2 --set live --keys-dir <dir>` exits 0.
- `bun run contracts:extend-v2 --set live --keys-dir <dir>` shows no `due` or
  `archived` entry.
- Within 2 minutes, `/ops/chain` shows the cursor with status `OK`, the
  `live` contract IDs, and `lagLedgers` under 720.
- Within 1 hour, `chain/config:getChainConfig` returns the `live` IDs and
  `paused: false` for each contract.
- The Convex logs show no `TAB_ACCEPTOR_MISMATCH` and no
  `TAB_SETTLER_RUN_FAILED`.

**Rollback:** set `SETTLEMENT_ENABLED=false` and remove the contract IDs and
`INDEXER_START_LEDGER`. Nothing user-facing uses the set while
`CHAIN_V2_ENABLED=false`. If the set itself is wrong, deploy a new set with a
new `CHAIN_EPOCH`.

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

**Check:** the final dry run for each table reports 0 rows to change.
**Rollback:** not needed. The field is optional, and an unset value already
reads as `v1`.

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

After the drain no stored transaction can create a payment. The entries stay
in browsers as inert data; the removal (section 8) stops reading them.

**Check:** every filter returns 0 rows. An article page shows "Tips are
paused for a short time while payments are updated." in place of the tip
button, and so does the passage tip action. For the article's author or NFT
owner, the NFT actions tab shows "NFT actions are paused for a short time
while payments are updated." instead of the mint and transfer buttons.
**Rollback:** set `CHAIN_V1_PREPARES_ENABLED=true`. No data step.

### Stage 6. Switch on v2

1. Set `CHAIN_V2_ENABLED=true` on the live deployment. Record the time.
2. Run the post-cutover verification (section 7) at once.

**Check:** section 7.1 passes.
**Rollback:** section 6, stage B.

### Stage 7. Pause the v1 contracts

Only if the v1 admin key is available. The v1 tipping contract has
`pause(admin)`. Run it on testnet with the Stellar CLI, passing
`--network testnet`, the testnet RPC URL and the testnet passphrase
explicitly, signed by the v1 admin.

**Check:** a simulated v1 `tip_article` call fails with the contract's paused
error.
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

`/ops/chain` shows status `OK` and `lagLedgers` under 720. Check again after
1 hour and after 24 hours. `events.error` is 0. Alerts are Convex log lines
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
PR that stops reading it is deployed. `NEXT_PUBLIC_NFT_METADATA_URL` is also
read by `lib/stellar/config.ts` into a value nothing uses; it goes with the v1
client code.

The Horizon and earlier RPC names have readers outside the v1 code. The PR
that removes them changes each of these:

| Variable                      | Readers outside the v1 code                                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_HORIZON_URL`     | `lib/stellar/v2/config.ts` (checked against the network guard), `proxy.ts` and `lib/security/contentSecurityPolicy.ts` (`connect-src`), `scripts/lib/network-guard.ts`, `.github/workflows/ci.yml` |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | The same files, and `convex/lib/stellarNetwork.ts`                                                                                                                                                 |
| `HORIZON_URL`                 | `convex/lib/networkGuard.ts`, `scripts/lib/network-guard.ts`                                                                                                                                       |
| `NEXT_PUBLIC_NFT_CONTRACT_ID` | `lib/stellar/v2/config.ts` (refuses a v2 NFT ID that equals the v1 one)                                                                                                                            |
| `TIPPING_CONTRACT_ID`         | `scripts/tips/v1-prepare-switch.test.ts` and `scripts/articles/tip-quote.test.ts` (tests of the v1 functions)                                                                                      |

The practice wallet (`lib/stellar/practice.ts`) uses the testnet Horizon
origin on its own, so the content security policy keeps that origin after
the variables are gone.

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
