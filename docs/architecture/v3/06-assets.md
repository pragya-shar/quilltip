# 6. Assets

Readers pay with what they hold and think in dollars. Writers and verified
project profiles choose which tokens they accept. Adding an asset is one
registry entry and one administration call per contract.

Package: A2 ([work packages](work-packages.md#later-waves)). The v3 contracts
already support several tokens ([contracts](contracts.md)); the core
packages use XLM only.

## 6.1 The token registry

One entry per asset in `lib/stellar/v2/tokens.ts`, imported by the client and
by Convex (Convex bundles files outside `convex/`, as it already does for
`lib/stellar/v2/tab/encoding.ts`).

```ts
export type TokenEntry = {
  id: TokenId // 'xlm', 'usdc', …; stable, used in rows and URLs
  code: string // asset code shown in detail views: 'XLM', 'USDC'
  name: string // 'Stellar Lumens', 'USD Coin'
  kind: 'native' | 'stablecoin' | 'project'
  decimals: number // 7 for Stellar assets
  /** Classic asset per network; null issuer for the native asset. */
  asset: { testnet: { issuer: string | null } }
  /** Soroban token contract per network; omitted for a Stellar Asset Contract (derived). */
  contractId?: { testnet: string }
  price:
    | { source: 'oracles' } // XLM: the v2 oracle set
    | { source: 'peg'; currency: 'USD' | 'EUR'; guard: 'usdc' | 'none' }
    | { source: 'dex'; quote: 'usdc' } // project tokens: Stellar DEX mid price
  minTipCents: number
  order: number // routing preference: lower first
}

export const TOKENS: readonly TokenEntry[]
export function tokenById(id: TokenId): TokenEntry
export function tokenContractId(entry: TokenEntry, passphrase: string): string // SAC id when not set
```

A Stellar Asset Contract id is derived from the asset and the network
passphrase, so a classic asset needs no stored contract id. A token that is
not a classic asset sets `contractId`.

**Initial entries (testnet):** `xlm` (native, `oracles`) and `usdc`
(Circle's testnet issuer, `peg` USD). Further stablecoins are entries once
their testnet issuers are confirmed by the Stellar rails research; the
registry shape does not change.

### Convex configuration

The registry says what exists; the `tokenConfig` table (A2) says what this
deployment enables, per network:

```ts
tokenConfig: defineTable({
  network: chainNetworkValidator,
  token: v.string(), // registry id
  contractId: v.string(),
  coreEnabled: v.boolean(), // from Core.token_config (refreshChainConfig)
  tabEnabled: v.boolean(), // from Tab.token_config
  appEnabled: v.boolean(), // operator switch
  updatedAt: v.number(),
}).index('by_network_token', ['network', 'token'])
```

A token is usable for a route when `appEnabled` and the route's contract flag
are true. `chain.config.refreshChainConfig` (hourly, and after an
administration call) reads both contracts' views for every registry entry.

### Contract administration

`scripts/contracts/ops-v2` gains `tokens:sync`: it compares the registry with
`Core.token_config` and `Tab.token_config` and, with the admin identity and
the testnet guard, calls `Core.set_token(token, min_tip, enabled)` and
`Tab.set_token(token, max_balance, min_deposit, enabled)` for differences.
Contract minimums stay at the fee-bearing floor (`MIN_FEE_BEARING_AMOUNT`);
the dollar minimum is the app's `minTipCents`.

## 6.2 Prices and dollar display

`xlmPriceCache` becomes `prices` (one row per token):

```ts
prices: defineTable({
  token: v.string(),
  usd: v.number(),
  at: v.number(),
  source: v.string(),
  previousUsd: v.optional(v.number()),
  previousAt: v.optional(v.number()),
}).index('by_token', ['token'])
```

- `oracles`: the v2 sources for XLM, every 5 minutes, as today.
- `peg`: the peg value (USD 1.00, EUR at the EUR/USD rate from the same
  oracle set). With `guard: 'usdc'` the refresh also reads the asset's market
  price; outside 2% of the peg, the token is marked `priceUnsafe` and no
  route uses it until it returns.
- `dex`: the Stellar DEX mid price against USDC from Horizon order books,
  with a minimum depth (`DEX_PRICE_MIN_DEPTH_CENTS`); no price, no route.
- `balance.session.prices` returns every enabled token's current and
  previous price; `priceAt` in `balance.send` names one of them (section 1.4).
- Display: every amount the reader sees is dollars (`formatMoney`). Token
  amounts appear only in a detail view ("Paid with 3.92 XLM").

## 6.3 Accepted tokens

- `users.acceptedTokens: v.optional(v.array(v.string()))`. Unset means every
  enabled token. A writer sets it in settings; the list must contain at least
  one enabled token.
- `balance.tipContext.acceptedTokens` returns the target's list; routing
  condition R4.6 ([section 1.1](01-tip-pipeline.md#11-routing)) intersects
  it with the reader's balances and the wallet route with the wallet's
  holdings.
- A tip in a token the writer accepts is paid in that token. The writer's
  earnings view sums every token in dollars at the acceptance price and lists
  the token split in a detail view.

## 6.4 Verified project profiles

A Stellar project can have a verified profile that accepts only its own
token.

```ts
projectProfiles: defineTable({
  userId: v.id('users'),
  name: v.string(),
  homeDomain: v.string(),
  token: v.string(), // registry id of the project's token
  exclusive: v.boolean(), // accept only this token
  verifiedAt: v.number(),
  verifiedBy: v.id('users'), // operator
  tomlCheckedAt: v.number(),
}).index('by_user', ['userId'])
```

- Verification: the project's `stellar.toml` (SEP-1) at `homeDomain` lists
  the token under `CURRENCIES` with its issuer, and lists the profile's
  payout address under `ACCOUNTS`. An operator approves after the automated
  check. The check repeats daily; a failed check suspends `exclusive`.
- The project's token gets a registry entry (`kind: 'project'`, `dex`
  price) and an administration call per contract.
- `exclusive: true` sets `acceptedTokens` to `[token]`. Readers who hold the
  token tip as usual; readers who do not see "Get {token} to tip" (section
  6.5).
- The profile shows a verified mark and the token's name. Tips to a project
  follow the same 97.5% / 2.5% split, taken in the project's token.

## 6.5 Conversion

Assumption until the Stellar rails research decides: conversion happens when
funds are added, not inside a tip. "Add funds" and "Get {token}" run a
Stellar path payment (strict receive) from an asset the reader holds into the
target token, to the reader's own address, then a deposit. Each is its own
transaction and approval. A tip itself always moves the token the writer
receives, so `Core.tip`, the vouchers and the fee rule stay single-token.

If the research picks per-tip conversion through a router contract, the
seam is the wallet route's `invoke` call ([section 5.1](05-accounts.md#51-the-wallet-provider-seam)):
the route builds the router call instead of `Core.tip`, and the router must
call `Core.tip` with the reader as `tipper` so attribution and the split stay
on chain. The balance route does not change.

## 6.6 Tests (A2)

- Registry: every entry's derived contract id matches the testnet deploy;
  ids are unique; `order` is total.
- Prices: peg guard trips at 2% and recovers; DEX depth floor; a token with
  no price is never routed.
- Routing over two tokens: stablecoin preferred; exclusive project profile
  routes only its token; a reader without it gets `needs-funds` with "Get".
- Ledger: two tokens on one account and one key; settlement batch with both
  tokens; earnings summed in dollars.
- `tokens:sync` dry run against a local network.
