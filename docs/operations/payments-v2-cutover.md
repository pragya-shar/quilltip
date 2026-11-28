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
7. The site origin is confirmed (section 1.6, item 6): the live deployment's
   `SITE_URL` and `WALLET_LINK_ORIGINS` match the origin readers load.

## Terms

| Term                       | Meaning                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1                         | The earlier testnet tipping contract (`contracts/tipping`), its Horizon-based verification in Convex, and the earlier NFT flow. Its records stay in the database after cutover. |
| v2                         | The Core, Tab and Article NFT contracts, the Convex chain layer (`convex/chain/`, `convex/lib/chain/`) and the client modules in `lib/stellar/v2/`.                             |
| Integration deployment     | The non-production Convex deployment `efficient-tern-39`. It has its own v2 contract set (`integration`).                                                                       |
| Live deployment            | The Convex deployment that serves the public site, `upbeat-mockingbird-579`. It gets its own v2 contract set (`live`) at cutover.                                               |
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
6. **Site origin.** Records disagree on the public origin:
   `docs/DEPLOYMENT.md` sets `SITE_URL` to `https://quilltip.me`, and the site
   is served at `https://www.quilltip.me`. Do not assume either. Before stage
   0, the operator:
   - checks the origin readers load: `curl -sI https://quilltip.me` and
     `curl -sI https://www.quilltip.me`. The one that answers 200 rather than
     redirecting is the site origin, written `<site origin>` in this runbook;
   - reads `SITE_URL` and `WALLET_LINK_ORIGINS` on the live deployment
     (`bunx convex env list --include-values` with the credential from
     section 5.0.2, or the dashboard).

   `SITE_URL` sets three things: the password-reset link
   (`convex/lib/passwordResetEmail.ts`), the origin allowed to request a
   wallet challenge (`convex/walletLink.ts`, together with the comma-separated
   `WALLET_LINK_ORIGINS`), and the v2 NFT metadata URL (section 3.1). Wallet
   verification from a browser on `<site origin>` is refused unless that
   origin is `SITE_URL`'s origin or listed in `WALLET_LINK_ORIGINS`. If
   `SITE_URL` is not `<site origin>`, either set it to `<site origin>` and add
   the old value to `WALLET_LINK_ORIGINS`, or add `<site origin>` to
   `WALLET_LINK_ORIGINS`. Record the decision before stage 0.

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
`<site origin>/api/nft/` (section 1.6, item 6). `contracts:deploy-v2` uses
`https://www.quilltip.me/api/nft/` unless `--nft-base-uri` is given.

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
| 5     | Freeze, 15-minute wait, drain                         | 15 min 17 s                                                                                        |
| 6     | Backfill again, switch on v2, section 7.1             | Registration indexed in 17 s, direct tip confirmed in 35 s; about 15 min for the full 7.1 list     |
| —     | Rollback B, if needed                                 | 54 s                                                                                               |
| —     | Snapshot restore (section 6.2), if needed             | About 10 min with the deployment paused (small data set)                                           |

Plan about 1 hour 15 minutes from stage 0 to the end of stage 6, plus the
owner's own checks. Stage 3, steps 1 and 2 (deploy and extend the contract
set) can run before the window, which shortens it by about 20 minutes. The
set is unused until its IDs are set in step 3, which needs the release
backend from stage 1.

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
     deployment (dashboard, **Settings → Deploy keys**, or, with the owner's
     login,
     `npx convex deployment token create <key name> --deployment upbeat-mockingbird-579`,
     which prints the key).
2. In a clean checkout of the tagged release commit, after
   `bun install --frozen-lockfile`, put the key in the environment without
   writing it to the shell history, and clear any other target:

   ```bash
   unset CONVEX_DEPLOYMENT CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
   read -rs CONVEX_DEPLOY_KEY && export CONVEX_DEPLOY_KEY
   bunx convex deploy --dry-run
   ```

3. Read the dry-run output. It starts with `Deploying code to deployment:`,
   then a line with the deployment type and name, then the deployment URL.
   Continue only if the URL is
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
For this window only, `bun run live-window` runs the Convex steps of stages 0,
1, 4 to 6 and section 6.2 under an operator approval. It builds each Convex CLI
command itself, so no flag can select another deployment.

The approval is one variable, set in the shell (never in a file):
`QUILLTIP_LIVE_WINDOW_APPROVAL=<deployment>@<release commit>@<UTC start>+<hours>h`.
The commit is the full 40-character SHA; the start is `YYYY-MM-DDTHH:MMZ`;
the window lasts 1 to 4 hours. The tool refuses if the checkout is not at that
commit or has any change or untracked file, if the window has not started or
has ended, if the value is malformed, if a `.env*` file or a committed file
holds it, if another Convex target is set, or if `CONVEX_DEPLOY_KEY` is not a
development deploy key for that deployment. Mainnet is refused as always.

1. Set it, in the clean checkout of the tag, after `bun install --frozen-lockfile`:

   ```bash
   unset CONVEX_DEPLOYMENT CONVEX_DEPLOYMENT_TOKEN CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
   export QUILLTIP_NETWORK_GUARD_OPT_IN=testnet NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
   read -rs CONVEX_DEPLOY_KEY && export CONVEX_DEPLOY_KEY
   export QUILLTIP_LIVE_WINDOW_APPROVAL="upbeat-mockingbird-579@$(git rev-parse 'payments-v2-cutover.1^{commit}')@<YYYY-MM-DDTHH:MMZ>+3h"
   ```

2. Verify it (dry mode: local checks only, nothing is sent):
   `bun run live-window check` lists the allowed operations, and
   `bun run live-window check <operation> <args>` checks one command.
3. Run each step as `bun run live-window run <operation> <args>`. Each run
   prints the deployment, commit, operation and expiry, and appends a line to
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
   bun run live-window check
   ```

Outside the approval: the secrets `TAB_ACCEPTOR_SECRET`, `TAB_SETTLER_SECRET`
and `ARWEAVE_WALLET_KEY` (dashboard only), `ARWEAVE_ENABLED`, reading the
deployment's variables, the dashboard **Data** and **Schedules** views, the
Vercel settings and promotion of stage 2, and the contract steps of stage 3
and 7. Contract tools refuse to run while the approval is set: unset it first,
and set it again for the next Convex step. Maintenance functions that call
`assertNonProductionBackend` stay refused on the live deployment.

### Stage 0. Freeze and tag

1. Stop merges to `overhaul/v2` except cutover fixes.
2. Tag the release commit: `git tag payments-v2-cutover.1 <sha>` and push the
   tag.
3. Take the live deployment snapshot with file storage, outside the
   repository: `bunx convex export --include-file-storage --path <file>.zip`
   (section 5.0.2 for the credential), or a dashboard backup. Record the
   live deployment's environment variable names and values in the owner's
   password store: a snapshot does not contain them. Record the latest testnet
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
  check `SITE_URL` and `WALLET_LINK_ORIGINS` (section 1.6, item 6).
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

3. The owner sets variables 2 to 12 of section 3.1 on the live deployment, in
   that order, with `CHAIN_V2_ENABLED=false`.
4. The owner sets the Vercel contract IDs from section 3.2 and redeploys the
   site if stage 2 already ran.

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

A code rollback to an earlier commit of the release branch has a similar
limit. Once a tab settlement is recorded, `tabAccounts.settledUnindexed` and
`tabVouchers.indexedPaid` hold values, and a tab that waited for a
reconciliation has had `tabAccounts.reconcileRequired`. Any code pushed after
stage 1 must keep these optional fields in its schema, or Convex refuses the
push.

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

A restore is the last resort. The switches cover every planned rollback
(section 6). After stage 2, fix forward is preferred: reverse the switches for
a payment defect, and correct other defects in code. Restore only when data
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
under 10 s; the full path, with checks, took about 10 minutes. A cloud
deployment with live data takes longer; the owner confirms the path on a
development deployment first (section 1.4).

A second run added tab activity after the snapshot: a top-up, tab tips to two
writers, a settlement with a skipped pair, a writer's own settlement, a claim,
an accepted tip left unsettled and a settlement recorded but not yet indexed
at the pause. The deployment was paused for 5 min 31 s, and the path from
pause to reopened payments took 8 min 18 s. After the resume the indexer
applied the late settlement, and every tab, payment and earnings figure
matched the chain.

Use the credential from section 5.0.2 for every command.

#### Step 1. Stop every write

Pause the deployment: Convex dashboard, **Settings → Pause deployment**. The
deployment API offers the same call
(`POST <deployment URL>/api/v1/pause_deployment`). While paused, the
deployment refuses every function call: queries, mutations, actions, HTTP
actions (including uploads), sign-up and sign-in, and `convex run`. A call
over an already open WebSocket connection gets no answer while paused; the
client can send it again after resume, so it may run on the restored data
(step 6 keeps payments off until step 7). Crons are skipped. Scheduled
functions wait and run at resume. A maintenance page on the site alone is not
enough: an open tab calls Convex directly.

What still works while paused: `convex export`, `convex env set` and
`env remove`, `convex import`, and `convex deploy`.

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

If `chainEvents` or `chainCursor` was damaged, leave both out and rebuild
them with a replay in step 6. The replay applies every event again, and each
handler ignores an effect it already applied: a `Claimed` event with a
`tabClaims` record adds nothing to `collectedBaseUnits`. A replay from `INDEXER_START_LEDGER` needs every
event since that ledger within the RPC retention (about 7 days); older events
come from an archive RPC or a hosted indexer through
`chain/indexer:ingestBackfill`.

Keep the release code deployed: the stage 0 data fits the release schema.
Going back to `main`'s code is a separate decision (section 2.2): `main`'s
schema has no place for v2 rows, so they stay on chain until the release
returns.

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
works while the deployment is paused; cancelling single entries while paused
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

Then check collected tab earnings against the claim records (chain runbook,
"Collected earnings"). Run `chain/tabClaims:seedClaimRecords` with
`"apply": true` until `isDone`: it records each applied `Claimed` event that
has no record and changes no total. Then run
`chain/tabClaims:recomputeCollected` as a dry run. Apply it, with the
incident note, only for the differences that step 4 explains.

#### Step 7. Reopen payments

Set `CHAIN_V2_ENABLED=true` (and `CHAIN_V1_PREPARES_ENABLED` as it was before
the incident) only when all of these are true:

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
   that no handler records (role grants, for example) stay `pending`. A new
   `orphan` means a restored row is missing. (The `/ops/chain` counts stop
   at 100.)
3. `authorEarnings` equals the second export, apart from the corrections
   recorded in step 4.
4. The rows left out in step 4 are reviewed and recorded in the incident
   record.
5. A comparison of a new export with the second export shows the expected
   differences only: the damaged tables and the left-out rows; `chainConfig`
   and `chainLeases`, which step 4 left out and the deployment rebuilt; the
   events indexed after the resume, with their effect on the rows they
   apply to (`chainEvents`, `chainCursor`, and for example `tabAccounts` and
   `tabVouchers` for a settlement indexed late); and the price cache.
6. `chain/tabClaims:seedClaimRecords` reports `seeded: 0` and
   `chain/tabClaims:recomputeCollected` reports no differences, both as dry
   runs.

Then roll the site forward or back as needed, and remove the pause notice.

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

The tests that set these variables change in the same PR.

The practice wallet (`lib/stellar/practice.ts`) uses the testnet Horizon
origin on its own, so the content security policy keeps that origin after
the variables are gone.

## 9. Maintenance schedule

| Task                                 | When                                                                                           | Command or place                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TTL report and extension, `live` set | Twice a week (for example Monday and Thursday), and within 3 days of any deploy or role change | `bun run contracts:extend-v2 --set live --keys-dir <dir> --submit`                                                                                     |
| TTL report, `integration` set        | Same                                                                                           | `--set integration`                                                                                                                                    |
| Indexer status and flagged tips      | Daily                                                                                          | `/ops/chain`; `tabAccounts.settledUnindexed` above 0 for more than an hour (section 7.3); any tab under "Waiting for a reconciliation" (chain runbook) |
| Settler balance and lag alerts       | Daily, and on every `TAB_SETTLER_*` log line                                                   | Convex logs; fund the settler from Friendbot below 50 XLM                                                                                              |
| Roles report                         | Weekly, and after any role change                                                              | `bun run contracts:roles-v2 --set live --keys-dir <dir>`                                                                                               |
| Live deployment snapshot             | Weekly during the hold, and before each removal PR is deployed                                 | Convex dashboard snapshot export                                                                                                                       |
| Testnet reset check                  | After every announced testnet reset                                                            | [Chain runbook, testnet reset](chain-runbook.md#testnet-reset)                                                                                         |
| Removal PRs                          | After the hold of one release                                                                  | Section 8                                                                                                                                              |
