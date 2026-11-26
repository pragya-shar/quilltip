# Content Security Policy

Every production page response carries a content security policy that runs
only scripts from the app's own origin and scripts that carry the response's
nonce. Inline scripts without that nonce do not run. Issue #454; specification
sections 6.8 and 3.5 of the payments v2 architecture.

## Where it is built

- `lib/security/contentSecurityPolicy.ts` builds the policy from a nonce and
  the public environment. It holds every third-party origin the browser may
  reach, with the reason for each.
- `proxy.ts` creates a 128-bit nonce per request, sets the policy on the
  response, and forwards it to the renderer as request headers
  (`Content-Security-Policy` and `x-nonce`).
- Next.js reads the nonce from the request's `Content-Security-Policy` header
  and adds it to its framework scripts, the inline React Server Components
  payload and its preload links.
- `app/layout.tsx` reads `x-nonce` and passes it to the theme provider, so the
  inline script that applies the dark or light theme before paint carries it.

Development serves no policy, because Fast Refresh evaluates code at run time.

## Policy

Production, with the Convex deployment and Stellar testnet values from
`.env.example`:

| Directive         | Sources                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `default-src`     | `'self'`                                                                                                                              |
| `script-src`      | `'self'` `'nonce-…'` (Vercel previews add `https://vercel.live`)                                                                      |
| `style-src`       | `'self'` `'unsafe-inline'`                                                                                                            |
| `img-src`         | `'self'` `data:` `blob:`, the Convex deployment, `*.convex.cloud` `*.convex.site`, article image hosts, wallet icon CDNs              |
| `font-src`        | `'self'`                                                                                                                              |
| `connect-src`     | `'self'`, the Convex deployment (HTTPS and WebSocket), Stellar testnet Horizon, RPC and Friendbot, the configured RPC, wallet origins |
| `frame-src`       | `'self'`, YouTube, `https://albedo.link`, `https://hot-labs.org`                                                                      |
| `object-src`      | `'none'`                                                                                                                              |
| `base-uri`        | `'none'`                                                                                                                              |
| `form-action`     | `'self'`                                                                                                                              |
| `frame-ancestors` | `'none'`                                                                                                                              |

### Scripts

`script-src` has no `'unsafe-inline'` and no `'unsafe-eval'`. It keeps
`'self'` and omits `'strict-dynamic'`: Next.js chunks and Vercel Analytics add
script elements at run time from the same origin, and host entries such as the
preview toolbar keep working. No route uses `eval` or `new Function`.

### Connections

`connect-src` lists only these origins:

- The Convex deployment from `NEXT_PUBLIC_CONVEX_URL`, as HTTPS and as the
  matching WebSocket origin.
- Stellar testnet: `horizon-testnet.stellar.org`, `soroban-testnet.stellar.org`
  and `friendbot.stellar.org`, plus the origins of `NEXT_PUBLIC_HORIZON_URL`,
  `NEXT_PUBLIC_SOROBAN_RPC_URL` and `NEXT_PUBLIC_STELLAR_RPC_URL`. A second
  testnet RPC provider is therefore allowed as soon as it is configured; the
  same build that reads the new RPC URL lists it. The network guard in
  `lib/stellar/config.ts` refuses mainnet endpoints before any call.
- Stellar Wallets Kit: the HOT Wallet relay (`https://h4n.app`) and the
  WalletConnect relay used by Wallets Kit 2.x (`wss://relay.walletconnect.com`,
  `wss://relay.walletconnect.org`).

Product analytics needs no entry: the browser sends events to the app's own
`/api/analytics`, which relays them after consent.

### Wallets

Browser-extension wallets (Freighter, LOBSTR, Rabet, Hana, Klever, xBull) talk
to the page through `window` and `postMessage`, which the policy does not
restrict. Albedo and xBull sign in popups. Albedo keeps an implicit-flow
session in an iframe and HOT Wallet shows its widget in an iframe, so both are
in `frame-src`. The wallet picker's icons load from `stellar.creit.tech` and
`storage.herewallet.app`.

## Not tightened

- **`style-src 'unsafe-inline'`.** React `style` attributes, Motion and the
  wallet picker's web components set inline styles. Nonces do not apply to
  style attributes. Styles cannot run script.
- **`img-src *.convex.cloud` and `*.convex.site`.** Older articles reference
  storage URLs of other Convex deployments.
- **Trusted Types.** Not required by the issue. The app renders article HTML
  through React and Tiptap; a Trusted Types policy is a separate change.

## Rendering cost

Next.js adds nonces only while it renders a page, so a page prerendered at
build time would carry scripts without a nonce. The root layout reads the
request headers, which renders every page per request.

- **Which pages change.** Before this change, 26 routes were prerendered,
  among them `/`, `/register`, `/guide`, `/privacy`, `/terms` and
  `/wallet/practice`. `/login`, `/articles`, article and writer pages already
  rendered per request. Only `robots.txt` stays static.
- **Server time.** Local production build, 40 requests per route after 5
  warm-up requests: `/` takes 2.6 ms to the first byte instead of 0.9 ms. The
  other measured routes were already dynamic and did not change.
- **Caching.** Prerendered pages were served with `s-maxage=31536000`, so a
  CDN could cache them. They are now `private, no-store`, and each view runs
  the page function.
- **Font preloads.** Rendered per request, React would send font preloads as
  `Link` response headers. Fonts then started before the HTML was parsed and
  delayed the render-blocking stylesheets: the landing page's LCP rose by
  about 290 ms under applied mobile throttling. `reactMaxHeadersLength: 0` in
  `next.config.ts` keeps preloads in the HTML, as on prerendered pages.

## Results

Lighthouse 12.8.2, local production build with the public read-only data,
median of 5 runs. Before: `overhaul/v2` at `4630566`. After: this change.
Profiles as in [page-load](../performance/page-load.md#device-profiles). LCP in
ms.

| Route       | Profile         | LCP before | LCP after | CLS before | CLS after |
| ----------- | --------------- | ---------: | --------: | ---------: | --------: |
| `/`         | Mobile          |       3913 |      3982 |      0.002 |     0.002 |
| `/`         | Mobile, applied |       1726 |      1771 |      0.001 |     0.001 |
| `/`         | Desktop         |        816 |       815 |      0.004 |     0.004 |
| `/login`    | Mobile          |       2913 |      2912 |      0.000 |     0.000 |
| `/login`    | Mobile, applied |       1571 |      1570 |      0.016 |     0.016 |
| `/login`    | Desktop         |        621 |       621 |      0.000 |     0.000 |
| `/articles` | Mobile          |       4202 |      3897 |      0.005 |     0.005 |
| `/articles` | Mobile, applied |       1766 |      1791 |      0.005 |     0.005 |
| `/articles` | Desktop         |       1033 |       867 |      0.003 |     0.003 |
| Article     | Mobile          |       3912 |      3916 |      0.000 |     0.000 |
| Article     | Mobile, applied |       1745 |      1769 |      0.000 |     0.000 |
| Article     | Desktop         |        776 |       780 |      0.001 |     0.001 |

With applied mobile throttling and on desktop, every route stays under 2 s LCP
and 0.1 CLS. The simulated mobile profile misses 2 s before and after; the
reasons are in
[page-load](../performance/page-load.md#remaining-gap-simulated-mobile).

## Checks

- `bun run test:security` builds responses through `proxy()` and asserts the
  directives, the forwarded nonce, a fresh nonce per response, the 404 path and
  the development exemption.
- `e2e/content-security-policy.spec.ts` loads `/`, `/login`, `/articles`,
  `/wallet/practice` and an article page from a production build and fails on
  any `securitypolicyviolation` event or CSP console error, or on a server
  script without the response nonce.
- `bun run test:e2e:csp` runs that spec without secrets: it serves the public
  queries from the fixture backend (`scripts/perf/fixture-backend.ts`) and
  starts `next start`. Build first with
  `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299`. The **Content Security
  Policy** CI job runs it and is a required check.
- ESLint rejects `import ... from 'zod'` in app code; use `@/lib/zod`.

## Library probes for `eval`

Two sources tested for `Function(...)` on load. Each probe sits in a `try`
block, so nothing broke, but the browser reported a violation each time:

- **Zod 4** probes before compiling object parsers. `lib/zod.ts` sets
  `jitless`, which skips the probe. Production already ran without the JIT,
  because the probe failed.
- **Node `crypto`** in `lib/stellar/client.ts` pulled crypto-browserify and a
  `util` shim that probes for generator functions into the tip flow (about
  450 KB). The short article ID now uses Web Crypto SHA-256, with identical
  output.

The Stellar SDK 17.4 browser build has no such probe.
