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

`state=profile-pagination` renders the production profile NFT tab with controlled
query results. Use `total` (default `9`), `nftOwnedPage`, and `nftMintedPage` to
exercise saved URLs, or the shrink button to reduce both collections to 9 items.
`loading=1` holds the initial query results. Profile pagination links update the
URL without reloading or remounting the production tab, using its real URL builder.

Add `controlled=1&total=19` to hold each collection's next page result as
`undefined`. The **Resolve owned/minted page** buttons release only that
collection's requested result. **Resolve owned/minted empty page** reduces only
that collection to 9 items and resolves the requested page, allowing cached-card
replacement and recovery to be tested without backend writes or timing delays.
