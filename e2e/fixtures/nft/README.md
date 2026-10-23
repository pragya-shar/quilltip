# NFT presentation fixtures

These fixtures bundle the production NFT components and Radix primitives with
isolated wallet/Convex collaborators. They never upload metadata, sign a real
transaction, or write to a backend. They test presentation and client interaction;
they do not establish contract or backend correctness.

```bash
bun e2e/fixtures/nft/server.mjs
NFT_FIXTURES=1 bunx playwright test e2e/nft-presentation.spec.ts
```

Open `http://127.0.0.1:4174` for manual QA. `state` selects `owner`, `visitor`,
`unminted-visitor`, `eligible`, `ineligible`, or `loading`. `mode` selects `success` (default),
`disconnected`, `preparing`, `signing`, `confirming`, `busy` (pending transfer),
or `failure`. Pending modes intentionally remain pending until navigation.
The app server is independent; the fixtures never ship as a Next.js route.
