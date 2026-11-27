# 6. Assets

Readers pay with what they hold and think in dollars. Writers and verified
project profiles choose which tokens they accept. Adding an asset is one
registry entry, one Tab deployment and one Core allowlist call.

Package: A2 ([work packages](work-packages.md#later-waves)). Each token has
its own Tab instance and an entry in Core's allowlist
([contracts](contracts.md#decisions)); the core packages use XLM only.

## 6.1 The token registry

One entry per asset and network in `lib/stellar/v2/tokens.ts`, imported by
the client and by Convex (Convex bundles files outside `convex/`, as it
already does for `lib/stellar/v2/tab/encoding.ts`). The shape follows the
Stellar rails research:

```ts
export type TokenEntry = {
  id: TokenId // 'usdc', 'xlm', …; stable, used in rows and URLs
  network: 'testnet'
  code: string // 'USDC'
  issuer: string | null // null for native XLM
  sac: string // Stellar Asset Contract id (C…)
  decimals: 7
  tab: string | null // this token's Tab instance; null = wallet tips only
  coreMinTip: string // mirrors Core token_config (base units)
  tabMinDeposit: string // mirrors Tab config (base units)
  minTipCents: number // the app's dollar minimum
  price:
    | { kind: 'peg'; usd: 1; guard: 'reflector' }
    | {
        kind: 'reflector'
        feed: string
        asset: { stellar: string } | { other: string }
      }
    | { kind: 'dex'; quote: 'usdc' }
  display: { name: string; symbol: string; icon: string }
  homeDomain: string | null // stellar.toml domain that vouches for the issuer
  order: number // routing preference: lower first
  enabled: boolean
}

export const TOKENS: readonly TokenEntry[]
export function tokenById(id: TokenId): TokenEntry
```

Testnet entries at A2:

| id      | Kind                | Price                                | Order |
| ------- | ------------------- | ------------------------------------ | ----- |
| `usdc`  | Circle testnet USDC | peg $1, Reflector de-peg guard       | 1     |
| `pyusd` | Paxos testnet PYUSD | peg $1, guard                        | 2     |
| `eurc`  | Circle testnet EURC | Reflector                            | 3     |
| `xlm`   | native              | Reflector, v2 oracle set as fallback | 4     |

The issuers and contract ids are the ones the rails research recorded from
the issuers' pages. USDC becomes the default token: new readers fund in
USDC, amounts are dollars without an oracle, and the 97.5% / 2.5% integer
math is unchanged.

### Convex configuration

The registry says what exists; `tokenConfig` (A2) says what this deployment
enables, refreshed from the contracts' views:

```ts
tokenConfig: defineTable({
  network: chainNetworkValidator,
  token: v.string(), // registry id
  coreEnabled: v.boolean(), // Core.token_config
  tabContractId: v.union(v.string(), v.null()),
  tabPaused: v.boolean(),
  appEnabled: v.boolean(), // operator switch
  priceUnsafe: v.boolean(), // de-peg or stale price
  updatedAt: v.number(),
}).index('by_network_token', ['network', 'token'])
```

`chain.config.refreshChainConfig` (hourly, and after an administration call)
reads Core and every Tab for each entry. The Convex ledger keeps a registry
`token` id next to `tabContractId` on its rows (P5), so queries need no join.

### Administration

`scripts/contracts/ops-v2` gains `tokens:sync`: it compares the registry with
Core's allowlist and the deployed Tabs and, with the admin identity and the
testnet guard, calls `Core.set_token(sac, coreMinTip, enabled)` and deploys
a missing Tab (`deploy-tab`, [contracts C4](contracts.md#c4-deployment)). The
treasury gets one trustline per credit asset, once.

## 6.2 Prices and dollar display

`xlmPriceCache` becomes `prices`, one row per token:

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

- A Convex action reads Reflector SEP-40 `lastprice` every 60 s for
  `reflector` tokens and caches it; for XLM the v2 oracle set is the
  fallback when Reflector is stale.
- `peg` tokens show at $1.00. The Reflector price only flags a de-peg: more
  than 2% off sets `priceUnsafe`, and no route uses the token until it
  returns.
- `dex` (project tokens without a Reflector feed): the Stellar DEX mid price
  against USDC, with a minimum depth (`DEX_PRICE_MIN_DEPTH_CENTS`); no price,
  no route.
- `balance.session.prices` returns each enabled token's current and
  previous price; `priceAt` in `balance.send` names one of them
  ([section 1.4](01-tip-pipeline.md#14-the-balance-route)).
- Every amount the reader sees is dollars (`formatMoney`). Token amounts
  appear only in a detail view ("Paid with 3.92 XLM"). On-chain amounts are
  the dollar amount converted at the cached price and rounded to 7 decimals.
- The balance shown is the sum of the reader's Tab balances in dollars.

## 6.3 Accepted tokens

- `users.acceptedTokens: v.optional(v.array(v.string()))`, default
  `['usdc', 'xlm']` and every later stablecoin. A writer sets it in settings;
  it holds at least one enabled token.
- A classic-account writer can enable a credit asset only with a trustline
  for it (the server checks on save; payouts would fail otherwise). The
  settings screen offers a sponsored-reserve trustline (the writer signs one
  transaction). Passkey accounts need no trustlines.
- `balance.tipContext.acceptedTokens` returns the target's list; routing
  condition R4.6 ([section 1.1](01-tip-pipeline.md#11-routing)) picks the
  reader's Tab whose token the writer accepts, in registry `order` (USDC
  first). The wallet route intersects with the wallet's holdings.
- The server refuses a voucher or a wallet tip prepare in a token the writer
  does not accept (`BALANCE_TOKEN_NOT_ACCEPTED`). The chain does not enforce
  acceptance; a direct `Core.tip` in another allowed token still pays the
  writer.
- Earnings sum every token in dollars at the acceptance price; a detail view
  lists the token split.

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

- Verification: the profile's verified domain equals the token entry's
  `homeDomain`; that domain's `stellar.toml` (SEP-1) lists the asset under
  `CURRENCIES` and the profile's payout address under `ACCOUNTS`. An operator
  approves after the automated check. The check repeats daily; a failed check
  suspends `exclusive`.
- Adding the project's token: a registry entry (`dex` or `reflector`
  price), `Core.set_token`, a Tab deployment, a treasury trustline.
- `exclusive: true` sets `acceptedTokens` to `[token]`. Readers who hold it
  tip as usual; readers who do not see "Add {token}" (section 6.5).
- The profile shows a verified mark and the token's name. Tips follow the
  97.5% / 2.5% split in the project's token.

## 6.5 Conversion

Conversion stays off the tip path: a voucher is in its Tab's token, and a
classic path payment cannot deliver to a contract address or share a
transaction with a contract call. When a reader holds token A and the writer
accepts only B, the sheet offers "Add B". The top-up converts at deposit
time: a Soroswap router `swap_exact_tokens_for_tokens(…, to = reader)`
transaction, then `deposit` into B's Tab (two transactions, two approvals).
A "swap and deposit" router contract (one approval) is a later option with
its own audit scope. Conversion is not needed for the launch tokens, so it
is A2's second step, after the registry, prices and profiles.

## 6.6 Tests (A2)

- Registry: ids unique, `order` total, every `sac` equals the id derived
  from the asset and the testnet passphrase, every enabled entry has a Tab
  and a Core allowlist entry on the integration deployment.
- Prices: the de-peg guard trips at 2% and recovers; a stale Reflector price
  falls back for XLM; a token with no price is never routed.
- Routing over two Tabs: USDC preferred; an exclusive project profile routes
  only its token; a reader without it gets `needs-funds` with "Add".
- Ledger: one reader with balances in two Tabs and one device key in each;
  settlement sends one transaction per Tab; earnings summed in dollars.
- Trustline check on save for a classic-account writer.
- `tokens:sync` dry run against a local network.
