# Profile NFT collection fixtures

These fixtures bundle the production profile NFT components with stand-ins for
the paginated Convex queries. They never write to a backend. The article NFT
section has its own fixture in `e2e/fixtures/nft-v2`.

```bash
bun e2e/fixtures/nft/server.mjs
NFT_FIXTURES=1 bunx playwright test e2e/nft-presentation.spec.ts
```

Open `http://127.0.0.1:4174` for manual QA. The app server is independent; the
fixtures never ship as a Next.js route.

`state=profile` renders the profile pagination and collection header.
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
