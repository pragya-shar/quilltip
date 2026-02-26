# Deployment

## Production Build

```bash
bun run build
bun run start
```

## Vercel

The project is configured for Vercel via `vercel.json`:

- **Region**: `cle1` (US Cleveland)
- **Function timeout**: 15 seconds for API routes and article pages
- **Cache-Control**: no-cache, no-store (dynamic content)

```bash
vercel
```

## Convex

Deploy backend functions to production:

```bash
npx convex deploy --prod
```

Set production environment variables on the Convex deployment:

```bash
npx convex env set SITE_URL https://quilltip.me --prod
```

## Smart Contracts

Two Soroban contracts. Only needed if deploying your own contracts (not required for frontend work):

```bash
# Tipping contract
cd contracts/tipping
cargo build --target wasm32-unknown-unknown --release
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/tipping.wasm

# NFT contract
cd contracts/article-nft
cargo build --target wasm32-unknown-unknown --release
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/article_nft.wasm
```

After deployment, update `NEXT_PUBLIC_TIPPING_CONTRACT_ID` and `NEXT_PUBLIC_NFT_CONTRACT_ID` in your environment.
