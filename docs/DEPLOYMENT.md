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

`PERF_RUN_TOKEN` is test-only: never set it on a deployment. The read check
`perf:prefetch-reads` sets it for its own local app, and the server then sends
it on its public Convex reads (`lib/seo/publicQuery.ts`; see
[page load](performance/page-load.md#link-prefetches-and-backend-reads-630)).

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

Article images, uploads, avatars and covers load only from the backend's own
file storage (`<CONVEX_CLOUD_URL>/api/storage/…`) and the listed hosts in
`lib/security/imageSources.ts`. The frontend reads that origin from
`NEXT_PUBLIC_CONVEX_URL`, so the two must name the same deployment origin; a
custom domain on one side hides every uploaded image. For each release, run
`bunx convex run articleImageHosts:countImageHosts` against the target backend
and check that its `storageOrigin` equals the origin of the frontend's
`NEXT_PUBLIC_CONVEX_URL`. The same report counts, per host, the images readers
no longer see (`publishedRefused`) and the profile photos shown as initials
(`avatars`, `refused`).

## Soroban contracts

Contract deployment is a separate operation from deploying the web app/backend.
Check the affected crate with the commands in the
[workflow](workflow/repo-workflow.md), then use the installed Stellar CLI's
`contract build --help` and `contract deploy --help` for its supported artifact and
network options. Confirm signer, network, initialization, and resulting contract
ID before updating configuration. Record the deployment and check the relevant
wallet-to-ledger-to-Convex flow; see the
[testnet note](tipping-contract-testnet-deploy.md).
