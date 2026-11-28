# Deployment

Deploy only within an authorized release task. First review the diff and
verification results, confirm the target account/project/backend/network, and
check environment configuration. A pushed commit, successful build, and deployed
backend are separate results.

## Frontend

[Vercel configuration](../vercel.json) defines the build/install commands, region,
and headers. Inspect it and the linked Vercel project
rather than relying on a copied settings list. A Git push may trigger Vercel's
connected deployment; inspect the resulting deployment and real app flow.

`GET /api/health` reports the build commit, deployment environment, Stellar
network, and Convex reachability. It returns 200 when the backend answers and 503
otherwise. Use it to confirm which commit a deployment serves.

For an authorized manual deployment, use the Vercel integration or current CLI
and confirm whether the target is preview or production. Keep the CLI current
with `npm i -g vercel@latest` (or `pnpm add -g vercel@latest`). Never commit tokens
or `.vercel` account linkage. Check protected previews through an authorized
session rather than weakening deployment protection.

## Convex

`bunx convex deploy` targets production by default for a locally configured
project; a deploy key can instead select production or preview. Inspect
`bunx convex deploy --help` and the target before running it. It can typecheck,
regenerate bindings, and push functions, schema, and indexes.

The reading-room writer/title index backfills automatically after the Convex
functions are deployed. The internal `readingRoomIndex:backfill` job checkpoints
each batch. The Reading Room scans published articles in bounded batches until
the state row reports `complete: true`, then uses the compact index. Check that
state and verify a narrow title search, a broad writer search, and pagination
against the intended backend after deploy. The job reads existing articles and
writes search metadata only.

The frontend and Convex code negotiate support for cursor scans. Existing
frontend sessions continue to use the legacy search contract. New frontend
sessions enable bounded search when the backend advertises support.

Convex environment is separate from Vercel/local environment. For an authorized
production auth-origin change:

```bash
bunx convex env set SITE_URL https://quilltip.me --prod
```

Use [setup](SETUP.md) for configuration responsibilities. Verify the frontend
points to the intended backend; align tipping contract IDs and Stellar networks.

### Balance tip limits

A reader's balance tip limits are set in dollars and converted to XLM at the
price each tip is quoted at:

- `TAB_TIP_MAX_CENTS`: the most one tip may be. Default `500` ($5).
- `TAB_DAILY_LIMIT_CENTS`: the most a reader's tips may add up to in a UTC
  day, counted in the tips' own cents. Default `2000` ($20).

Both take whole cents written as digits only, from `1` to `999999` (no
leading zero, no decimal point: `500`, not `500.0` or `$5`). Any other value
stops balance tips with `TAB_CONFIG_INVALID`.

`TAB_TIP_MAX` and `TAB_DAILY_LIMIT` (XLM base units) are guards against a
broken price. Their defaults are 100 XLM a tip and 400 XLM a day: $5 and $20
at $0.05 a Lumen. The dollar limits hold at any price down to $0.05. Below
it the guards bind, so a reader meets 100 XLM a tip and 400 XLM a day, and a
price read far too low cannot make a $5 tip more than 100 XLM.

A deployment that sets them to small values, such as the former 5 XLM and
20 XLM, keeps those as the limits a reader meets: at $0.1235 a Lumen the
largest tip is $0.61 and a day stops at $2.47, and the day's remainder shown
to the reader is wrong after a price move. Unset them, or set them to guard
values, when this version deploys.

A tip is priced only with a price younger than 30 minutes; with none, no new
tip is priced and the reads state no limits. A tip prepared before that is
still accepted within 5 minutes, at the price it was quoted at.

## Soroban contracts

Contract deployment is a separate operation from deploying the web app/backend.
Check the affected crate with the commands in the
[workflow](workflow/repo-workflow.md), then use the installed Stellar CLI's
`contract build --help` and `contract deploy --help` for its supported artifact and
network options. Confirm signer, network, initialization, and resulting contract
ID before updating configuration. Record the deployment and check the relevant
wallet-to-ledger-to-Convex flow; see the
[testnet note](tipping-contract-testnet-deploy.md).
