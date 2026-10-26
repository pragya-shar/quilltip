# Shared dependency audit remediation — 2026-10-26

Branch: `codex/fix-shared-dependency-audit`, based on freshly fetched `origin/main`
at `0728635`. This supersedes the current-status counts in the historical
[issue #240 review](dependency-audit.md), while retaining its advisory inventory.

## Dependency changes and tradeoffs

- `@ardrive/turbo-sdk`: locked 1.44.1 → exactly pinned 2.1.2. Its published manifest
  moves `x402-fetch` from a required dependency to an optional peer. QuillTip
  does not install that peer or select `X402Funding`. The SDK dynamically imports
  it only on the x402 payment path; the default existing-balance RSA upload path
  works without it. Enabling x402 later requires explicitly installing and
  auditing that stack. No application upload adapter code changed.
  The published ESM loader still caused esbuild to reject the absent peer when
  bundling Convex actions. The version-bound
  [Turbo patch](../../patches/@ardrive%252Fturbo-sdk@2.1.2.patch) adds an immediate
  rejection handler that rethrows the same error. This lets esbuild recognize
  the optional import while preserving the SDK's existing missing-peer message
  and lazy loading. It changes no signing, funding or upload logic. Remove the
  patch when upstream ships bundler-safe optional loading. Both the retained
  esbuild regression check and Convex's own debug bundler pass without x402.
- `happy-dom`: 20.14.6 → exactly overridden 21.0.4, fixing
  [GHSA-834v-8h66-3h79](https://github.com/advisories/GHSA-834v-8h66-3h79).
  This deliberately crosses Tiptap HTML 3.32.0's `^20.8.9` peer range. Tiptap's
  server serializer constructs a Window with script/file/iframe loading disabled;
  the retained rendering tests exercise its real server API and application
  components with the replacement. Reassess the override when Tiptap supports 21.
- Direct `zod` remains declared `^4.6.7`, locked to **4.6.7**. There is no Zod
  override. The final lockfile contains only this Zod version, which is above
  the `<4.6.6` affected range for
  [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

The removed Zod 3 dependency paths were:

| Previous path from Turbo 1.44.1                                                                                                                                             | Removed version |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `x402-fetch@1.2.0 → zod`                                                                                                                                                    | 3.25.76         |
| `x402-fetch@1.2.0 → x402@1.2.0 → zod`                                                                                                                                       | 3.25.76         |
| `x402-fetch@1.2.0 → x402@1.2.0 → wagmi@2.19.5 → @wagmi/connectors@6.2.0 → @base-org/account@2.4.0 → @coinbase/cdp-sdk@1.60.0 → zod`                                         | 3.25.76         |
| `x402-fetch@1.2.0 → x402@1.2.0 → wagmi@2.19.5 → @wagmi/connectors@6.2.0 → @walletconnect/ethereum-provider@2.21.1 → @reown/appkit@1.7.8 → @reown/appkit-wallet@1.7.8 → zod` | 3.22.4          |

The final lock removes x402, wagmi, Coinbase CDP and Reown entirely. Comparing
unique package/version resolutions adds only Turbo 2.1.2 and Happy DOM 21.0.4
and removes 207 old resolutions (including their superseded versions). Existing
Stellar wallet-kit 1.9.5, Stellar SDK 14.6.1, auth, Tiptap and application
dependencies retain their versions. Turbo also drops its unused Cosmos stack.

## Audit enforcement and remaining findings

`bun run check` now includes `test:dependency-compatibility` and `security:audit`.
The existing CI Dependency Audit job and Required aggregation are unchanged.
No exception was added, expanded or extended for this remediation.

The live registry scan reports **0 critical, 6 high, 5 moderate, 1 low** records.
All six high findings match the pre-existing exact reviewed exceptions in
[the enforced policy](../../security/audit-exceptions.json). Each is owned by
`pragya-shar`, reviewed by `Codex dependency reachability review, 2026-10-23`,
and expires **2026-11-06 at 00:00 UTC**:

| Package/version     | Advisory            | Exact affected range | Reachability evidence retained                                                                                                                        |
| ------------------- | ------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| bigint-buffer 1.1.5 | GHSA-3gc7-fjrx-p6mg | `<=1.1.5`            | Turbo → Solana SPL token → buffer-layout-utils. The actual adapter test signs RSA JSON; QuillTip never selects a Solana signer or calls `toBigIntLE`. |
| toml 3.0.0          | GHSA-82x6-q7mm-w9cf | `<4.2.0`             | Stellar SDK and wallet-kit/Trezor dependency paths expose the parser; app callers do not invoke TOML, federation or StellarTomlResolver.              |
| toml 3.0.0          | GHSA-v5mp-jgw5-2x6j | `<4.1.2`             | Same unused parser path.                                                                                                                              |
| toml 3.0.0          | GHSA-4qx8-w7c3-pj3p | `<=5.0.0`            | Same unused parser path.                                                                                                                              |
| toml 3.0.0          | GHSA-9j65-hcg3-gc64 | `<=5.0.0`            | Same unused parser path.                                                                                                                              |
| toml 3.0.0          | GHSA-9qmh-m7c6-f92p | `<=5.0.0`            | Same unused parser path.                                                                                                                              |

A fresh source search across `app`, `components`, `lib` and `convex` found no
callers of `StellarTomlResolver`, `FederationServer`, `toml.parse`, `toBigIntLE`,
Solana signers or x402 funding. These exceptions do not authorize enabling those
APIs. See [the existing review](dependency-audit.md#remaining-exceptions) for
upstream remediation limits.

Moderate records remain for `decode-uri-component` (GHSA-vcc3-ghjq-m6fr,
existing linear decoder backport retained), `stream-json` (GHSA-hqr4-qq8f-hg3x,
GHSA-mjw6-4jj6-33hc, GHSA-528h-pc64-c93x), and `uuid`
(GHSA-w5hq-g745-h8pq). The low record is `elliptic` GHSA-848j-6mx2-7j84.
They remain visible under the existing policy; a passing gate is not a claim
of an advisory-free dependency tree.

## Reproducible compatibility checks

Run `bun run test:dependency-compatibility` (also included in `check`).

- Tiptap/Happy DOM: real server HTML generation and parse/serialize round-trip;
  real `ArticleReadOnlyBody` and `WritingPreview` components. Checks exact
  passage text, escaping, headings, bold/link attributes, image captions and
  dimensions, code blocks, privacy-enhanced YouTube embeds and preview alignment.
- Arweave: real Turbo factory, RSA signer and both app JSON upload adapters;
  ephemeral RSA-4096 key generated in memory. All fetches are intercepted before
  network transmission. Validates ANS-104 signatures, exact JSON bytes, hashes,
  article/metadata tags, timeout signal, returned IDs/URLs and hard size guard.
  No permanent upload, balance purchase or payment request occurs.
  An additional test bundles the actual Convex Arweave action with esbuild,
  without externalizing or installing x402. Convex's installed CLI independently
  passed `dev --once --debug-bundle-path ... --codegen disable --typecheck disable`
  and explicitly reported that it skipped the push. No backend was deployed.
- Wallet: mocked kit boundary with the actual application adapter; connection,
  testnet selection, XDR/address/passphrase forwarding, local Ed25519 signature
  verification using an ephemeral key, rejection handling and disconnect.
  This does not establish real extension or hardware signing compatibility.

Clean installation was checked in a new temporary directory containing only
`package.json`, `bun.lock` and both package patches, using Bun **1.4.4**
and `bun install --frozen-lockfile`. It succeeded with the existing lifecycle
script restrictions intact.

Authenticated regular Chrome checked a production build served from this checkout
at `http://127.0.0.1:3000`: an existing published article rendered, and an existing
private draft opened in the actual writing preview. No draft text was changed,
saved, discarded or published. The wallet screen rendered its testnet state;
the real wallet-kit picker listed installed providers and opened Freighter.
After the user unlocked Freighter, the real connection succeeded and QuillTip
showed Connected on Stellar testnet; disconnect restored its initial state and
left the saved receiving address intact. Live extension transaction signing remains
unverified; no hardware wallet, real transaction signature, contract submission
or permanent upload was exercised. The checked
routes produced no browser warnings/errors; raw private browser evidence stays
outside Git.

Final verification after the Turbo patch: clean Bun 1.4.4 frozen installation
passed with both patches applied; `bun run check` passed formatting, ESLint,
35 component-rule fixtures, TypeScript, 23 audit CLI tests, five compatibility
tests, the live audit and the Next.js production build. `git diff --check` passed.

Local checks do not establish remote CI, deployment, merge or production
remediation. Hosted checks and delivery status must be verified on the pull
request separately.
