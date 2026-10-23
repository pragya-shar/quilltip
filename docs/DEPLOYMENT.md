# Deployment

Deploy only within an authorized release task. First review the diff and
verification results, confirm the target account/project/backend/network, and
check environment configuration. A pushed commit, successful build, and deployed
backend are separate results.

## Frontend

[Vercel configuration](../vercel.json) defines the build/install commands, region,
function limits, headers, and rewrites. Inspect it and the linked Vercel project
rather than relying on a copied settings list. A Git push may trigger Vercel's
connected deployment; inspect the resulting deployment and real app flow.

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

Convex environment is separate from Vercel/local environment. For an authorized
production auth-origin change:

```bash
bunx convex env set SITE_URL https://quilltip.me --prod
```

Use [setup](SETUP.md) for configuration responsibilities. Verify the frontend
points to the intended backend; align tipping contract IDs and Stellar networks.

## Soroban contracts

Contract deployment is a separate operation from deploying the web app/backend.
Check the affected crate with the commands in the
[workflow](workflow/repo-workflow.md), then use the installed Stellar CLI's
`contract build --help` and `contract deploy --help` for its supported artifact and
network options. Confirm signer, network, initialization, and resulting contract
ID before updating configuration. Record the deployment and check the relevant
wallet-to-ledger-to-Convex flow; see the
[testnet note](tipping-contract-testnet-deploy.md).
