# Dependency advisory review for issue #240

Review date: 2026-10-23. Owner: @pragya-shar. Exception deadline: 2026-11-06 (UTC).

The canonical dependency source is `bun.lock`. This review started at commit `c0c8e0a29d9a1986d4548c4ea0ac3143aad218c6`. The initial live `bun audit --json` returned 282 registry records across 49 package names: 9 critical, 110 high, 138 moderate, 25 low. These are registry records, not confirmed application vulnerabilities or evidence of a breach.

After same-major dependency refreshes, Convex Auth 0.0.96, and the reviewed overrides, the live scan returns 13 records: **0 critical, 7 high, 5 moderate, 1 low**. All seven high records have exact reviewed exceptions. `bigint-buffer` was newly introduced by the updated Turbo Solana tree and is included below. No new independently confirmed application root cause was uncovered, so no speculative remediation tickets were filed. The independently tracked Next/Sharp work remains [#238](https://github.com/pragya-shar/quilltip/issues/238).

## Reproduce and enforce

Use Bun 1.4.4, pinned in `packageManager` and CI. A local global upgrade is unnecessary: `npm exec --yes --package=bun@1.4.4 -- bun run security:audit` works with an older global Bun. Run `bun install --frozen-lockfile` first. Version-scoped overrides produce Bun lockfile version 3, which older Bun installers cannot read.

`bun run security:audit` scans the canonical lockfile, validates the registry report, and matches every high/critical advisory against actual installed versions. It rejects unreviewed findings, expired or incomplete exceptions, invalid ranges, unknown schemas, contradictory command status, and registry/command failures. Exceptions bind GHSA ID, package, exact installed version, exact vulnerable range and severity. Low/moderate counts remain visible and do not block under this issue's policy. This is intentionally stricter than a package-wide ignore list.

CI's Dependency Audit job is now a dependency of the existing Required job and no longer uses `|| true`. Required fails when audit fails or is cancelled/skipped. Branch protection must already require the existing Required check for this to block merging; this change does not mutate repository settings. Audit reports can be saved with `--output /tmp/audit.json`; an existing report can be evaluated offline with `--report /tmp/audit.json`.

## Compatibility review of overrides

| Override                         | Why it is compatible                                                                                                                               | Validation and limitation                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| elliptic 6.6.1                   | Patch within 6.x; replaces the old exact 6.5.4 Ethers pin. Keeps elliptic's public API.                                                            | App uses RSA/Ed25519, not ECDSA private keys. Typecheck, build and signing-adapter mocks validate integration; no real transactions.                      |
| protobufjs 7.6.6                 | Remains on 7.x, beyond all audited high/critical affected ranges. Trezor's 7.4.0 exact pin is deliberately overridden.                             | Reflection/codegen is not called by app code; wallet adapter mocks do not validate physical Trezor firmware. Reassess upstream Trezor pin on SDK updates. |
| secp256k1 5.0.2                  | Patch within 5.x; replaces 5.0.0's ECDH implementation.                                                                                            | Stellar wallet path uses Ed25519 and no app ECDH call. No native ECDH/key material was exercised.                                                         |
| ws@^7 to 7.5.13; ws@^8 to 8.21.0 | Bun 1.4.4 applies selectors to declared ranges. Keeps both existing major APIs and covers exact vulnerable pins without moving 7.x callers to 8.x. | Inspected final lock; wallet/SDK adapter mocks, build and test suite check integration. These are not live hardware-wallet or production-network tests.   |

Convex Auth was upgraded through its own release, whose Auth.js peer range permits patched 0.41.x. Tiptap packages move together to 3.32.0; the fresh tree deduplicates ProseMirror model instances. Other transitive patches are resolved within upstream ranges. No major wallet-kit or TOML parser migration is forced. Dependency lifecycle scripts were skipped during review installs; that is not relied on as the exception's security boundary.

## Remaining exceptions

`security/audit-exceptions.json` is the enforced policy. Each entry names its advisory, exact installed version and affected range, reviewer, owner @pragya-shar, expiry **2026-11-06**, rationale and this evidence file. Expiry is exclusive at 00:00 UTC; owner review is required to extend it. Remove an exception when its finding disappears. Do not enable one of the excluded APIs without remediating it first.

| Package             | Scope and installed dependency path                                                                        | Affected function and reachability                                                                                                                                                                                                        | Disposition                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| bigint-buffer 1.1.5 | Runtime manifest: @ardrive/turbo-sdk 1.44.1 → @solana/spl-token 0.4.15 → @solana/buffer-layout-utils 0.3.0 | `toBigIntLE` native conversion. `lib/arweave/client.ts` constructs RSA `ArweaveSigner` and sends JSON; no Solana signer or buffer-layout decoder is called. Importing the SDK alone does not establish the conversion path.               | No patched release. [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg); reassess before Solana support.                    |
| braces 3.0.3        | Dev: eslint-config-next 16.4.2 → @next/eslint-plugin-next 16.4.2 → fast-glob 3.3.1 → micromatch 4.0.8      | Recursive AST walkers process checked-in glob patterns; no runtime request input.                                                                                                                                                         | No patched release. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm); reassess tooling patterns/untrusted configuration. |
| toml 3.0.0          | Runtime manifest: @stellar/stellar-sdk 14.6.1 → toml; also included by wallet-kit/Trezor SDK 13.3.0        | `parse` recursion/key paths/array tables/dotted keys/integer literals. Repository search found no `StellarTomlResolver`, federation, TOML or domain-discovery calls. `lib/stellar/client.ts` uses Horizon/rpc/TransactionBuilder and XDR. | Five exact GHSA entries in policy; patched releases require a major parser migration. Reassess before domain/federation discovery.               |

Remaining moderate/low records (`decode-uri-component`, `elliptic`, `stream-json`, `uuid`) are reported by the scanner and not hidden by exceptions. This work does not claim that every dependency advisory has been fixed.

## Record-by-record high/critical inventory

The following inventories **every one of the 119 initial high/critical registry records**, including duplicated GHSA IDs with different affected ranges. Each package section gives installed baseline versions and resolved dependency paths with runtime/dev **manifest scope**; scope is not a claim of execution. The reachability assessment identifies the affected function and whether its prerequisites were demonstrated. Each record lists matching affected baseline versions and matching affected versions after remediation. “Removed” means the canonical lock no longer contains a version affected by that record, not that exploitability was demonstrated before remediation.

Paths are shortest resolved lockfile paths for each installed version and scope, including declared/optional peers when present. Multiple import routes to the same installed copy are not separate vulnerabilities. No `.env`, key, wallet credential or private runtime data is included.

### @auth/core

Affected function(s): normalizeEmail; getToken. Runtime dependency of Convex Auth. Password is the only configured provider in convex/auth.ts; no email/magic-link provider and no application getToken call. The two advisory prerequisites were not established. Upgrade through Convex Auth 0.0.96 rather than forcing its older Auth.js peer range.

- Runtime manifest, installed `0.37.4` (`@auth/core`): `@convex-dev/auth@0.0.90` → `@auth/core@0.37.4`

Resolved after: `0.41.3`

| Advisory                                                                 | Severity | Affected range    | Affected installed before | Still affected after | Affected operation / record title                                                                           |
| ------------------------------------------------------------------------ | -------- | ----------------- | ------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| [GHSA-7rqj-j65f-68wh](https://github.com/advisories/GHSA-7rqj-j65f-68wh) | critical | `>=0.1.0 <0.41.3` | 0.37.4                    | Removed              | Auth.js: Email normalizer validates the address before Unicode normalization, allowing a homoglyph @ bypass |
| [GHSA-xmf8-cvqr-rfgj](https://github.com/advisories/GHSA-xmf8-cvqr-rfgj) | high     | `>=0.1.0 <0.41.3` | 0.37.4                    | Removed              | Auth.js: getToken() throws an uncaught exception on malformed Bearer authorization headers                  |

### @fastify/busboy

Affected function(s): multipart header parsing. Transitive HTTP multipart parser. No app-controlled busboy server or attacker multipart-to-parser call was established; HTTP clients and SDKs include the parser. Refreshed within parent ranges.

- Runtime manifest, installed `2.1.1` (`@fastify/busboy`): `@ardrive/turbo-sdk@1.41.0` → `@permaweb/aoconnect@0.0.57` → `warp-arbundles@1.0.4` → `warp-isomorphic@1.0.7` → `undici@5.29.0` → `@fastify/busboy@2.1.1`

Resolved after: package removed from the canonical tree.

| Advisory                                                                 | Severity | Affected range   | Affected installed before | Still affected after | Affected operation / record title                                                         |
| ------------------------------------------------------------------------ | -------- | ---------------- | ------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| [GHSA-x8mw-p69m-v3mx](https://github.com/advisories/GHSA-x8mw-p69m-v3mx) | high     | `>=1.0.0 <3.2.1` | 2.1.1                     | Removed              | @fastify/busboy vulnerable to Denial of Service via prototype-named multipart part header |

### @tiptap/core

Affected function(s): Markdown attribute parsing. Editor core executes in the browser. No Markdown import/attribute-parser entry point was established in the editor; it uses Tiptap JSON. Upgrade also removes GHSA-cp6q-959q-f8rh. Fixed image attribute schemas in lib/tiptap/readExtensions.ts do not establish arbitrary attributes reaching mergeAttributes.

- Runtime manifest, installed `3.20.0` (`@tiptap/core`): `@tiptap/extension-code-block-lowlight@3.20.0` → `@tiptap/core@3.20.0`

Resolved after: `3.32.0`

| Advisory                                                                 | Severity | Affected range    | Affected installed before | Still affected after | Affected operation / record title                                      |
| ------------------------------------------------------------------------ | -------- | ----------------- | ------------------------- | -------------------- | ---------------------------------------------------------------------- |
| [GHSA-j95f-988m-3j2f](https://github.com/advisories/GHSA-j95f-988m-3j2f) | high     | `>=3.7.0 <3.30.5` | 3.20.0                    | Removed              | Tiptap: Quadratic ReDoS in block and inline Markdown attribute parsing |

### axios

Affected function(s): Node HTTP adapter, config merge, cookie parsing, HTTP/2 adapter. SDK HTTP clients execute in runtime. Horizon/Soroban and Turbo endpoints are configured by the app. Advisory-specific polluted config, proxy credentials, custom cookies and HTTP/2 controls were not demonstrated as attacker-controlled. Refreshed all compatible transitive copies.

- Runtime manifest, installed `1.13.5` (`axios`): `@stellar/stellar-sdk@14.5.0` → `axios@1.13.5`

Resolved after: `1.20.0`

| Advisory                                                                 | Severity | Affected range     | Affected installed before | Still affected after | Affected operation / record title                                                                                                  |
| ------------------------------------------------------------------------ | -------- | ------------------ | ------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-q8qp-cvcw-x6jj](https://github.com/advisories/GHSA-q8qp-cvcw-x6jj) | high     | `>=1.0.0 <1.15.2`  | 1.13.5                    | Removed              | Axios has prototype pollution read-side gadgets in HTTP adapter that allow credential injection and request hijacking              |
| [GHSA-hfxv-24rg-xrqf](https://github.com/advisories/GHSA-hfxv-24rg-xrqf) | high     | `>=1.0.0 <1.16.0`  | 1.13.5                    | Removed              | Axios: Regular Expression Denial of Service (ReDoS) via Cookie Name Injection                                                      |
| [GHSA-777c-7fjr-54vf](https://github.com/advisories/GHSA-777c-7fjr-54vf) | high     | `>=1.7.0 <1.16.0`  | 1.13.5                    | Removed              | Allocation of Resources Without Limits or Throttling in Axios                                                                      |
| [GHSA-p92q-9vqr-4j8v](https://github.com/advisories/GHSA-p92q-9vqr-4j8v) | high     | `>=1.0.0 <1.16.0`  | 1.13.5                    | Removed              | Axios: Proxy-Authorization Credential Leak to Origin Server Across HTTP-to-HTTPS Redirect in Axios Node.js HTTP Adapter            |
| [GHSA-j5f8-grm9-p9fc](https://github.com/advisories/GHSA-j5f8-grm9-p9fc) | high     | `>=1.0.0 <1.16.0`  | 1.13.5                    | Removed              | Axios: Proxy-Authorization header leaks to redirect target when proxy is re-evaluated to direct connection                         |
| [GHSA-3g43-6gmg-66jw](https://github.com/advisories/GHSA-3g43-6gmg-66jw) | high     | `>=1.0.0 <1.15.2`  | 1.13.5                    | Removed              | axios Vulnerable to Credential Theft and Response Hijacking via Prototype Pollution Gadget in Config Merge                         |
| [GHSA-35jp-ww65-95wh](https://github.com/advisories/GHSA-35jp-ww65-95wh) | high     | `>=1.0.0 <1.16.0`  | 1.13.5                    | Removed              | axios Vulnerable to Full Man-in-the-Middle via Prototype Pollution Gadget in config.proxy                                          |
| [GHSA-pmwg-cvhr-8vh7](https://github.com/advisories/GHSA-pmwg-cvhr-8vh7) | high     | `>=1.0.0 <1.15.1`  | 1.13.5                    | Removed              | Axios: Incomplete Fix for CVE-2025-62718 — NO_PROXY Protection Bypassed via RFC 1122 Loopback Subnet (127.0.0.0/8) in Axios 1.15.0 |
| [GHSA-pf86-5x62-jrwf](https://github.com/advisories/GHSA-pf86-5x62-jrwf) | high     | `>=1.0.0 <1.15.1`  | 1.13.5                    | Removed              | Axios: Prototype Pollution Gadgets - Response Tampering, Data Exfiltration, and Request Hijacking                                  |
| [GHSA-6chq-wfr3-2hj9](https://github.com/advisories/GHSA-6chq-wfr3-2hj9) | high     | `>=1.0.0 <1.15.1`  | 1.13.5                    | Removed              | Axios: Header Injection via Prototype Pollution                                                                                    |
| [GHSA-3pq3-5fj3-cg6v](https://github.com/advisories/GHSA-3pq3-5fj3-cg6v) | high     | `>=1.13.0 <1.20.0` | 1.13.5                    | Removed              | Axios: HTTP/2 adapter bypasses configured DNS lookup and proxy controls                                                            |
| [GHSA-542g-h47m-68v8](https://github.com/advisories/GHSA-542g-h47m-68v8) | high     | `>=1.13.0 <1.20.0` | 1.13.5                    | Removed              | Axios: Denial of Service via Unhandled 'error' Event in HTTP/2 ClientHttp2Session Initialization                                   |

### brace-expansion

Affected function(s): brace expansion and parseCommaParts. Development glob matching; only repository lint/build patterns are passed. Refreshed all version lines within declared ranges.

- Dev manifest, installed `1.1.12` (`brace-expansion`): `@eslint/eslintrc@3.3.4` → `minimatch@3.1.5` → `brace-expansion@1.1.12`
- Dev manifest, installed `5.0.3` (`@typescript-eslint/typescript-estree/minimatch/brace-expansion`): `eslint-config-next@16.0.10` → `typescript-eslint@8.56.1` → `@typescript-eslint/typescript-estree@8.56.1` → `minimatch@10.2.4` → `brace-expansion@5.0.3`

Resolved after: `1.1.21`, `5.0.12`

| Advisory                                                                 | Severity | Affected range    | Affected installed before | Still affected after | Affected operation / record title                                                               |
| ------------------------------------------------------------------------ | -------- | ----------------- | ------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | high     | `<1.1.17`         | 1.1.12                    | Removed              | brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash      |
| [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | high     | `>=4.0.0 <5.0.8`  | 5.0.3                     | Removed              | brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash      |
| [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | high     | `>=4.0.0 <5.0.9`  | 5.0.3                     | Removed              | brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation |
| [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | high     | `<1.1.18`         | 1.1.12                    | Removed              | brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation |
| [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | high     | `<1.1.16`         | 1.1.12                    | Removed              | brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups      |
| [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | high     | `>=3.0.0 <5.0.7`  | 5.0.3                     | Removed              | brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups      |
| [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | high     | `>=4.0.0 <5.0.11` | 5.0.3                     | Removed              | brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion |
| [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | high     | `<1.1.19`         | 1.1.12                    | Removed              | brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion     |
| [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | high     | `>=4.0.0 <5.0.10` | 5.0.3                     | Removed              | brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion     |
| [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | high     | `<1.1.20`         | 1.1.12                    | Removed              | brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion |

### braces

Affected function(s): recursive brace AST walkers. Development-only eslint-config-next > fast-glob > micromatch. Repository patterns, no request input; no patched release. See remaining exceptions.

- Dev manifest, installed `3.0.3` (`braces`): `lint-staged@16.2.7` → `micromatch@4.0.8` → `braces@3.0.3`

Resolved after: `3.0.3`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                                      |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | high     | `<=3.0.3`      | 3.0.3                     | 3.0.3                | braces vulnerable to stack-exhaustion denial of service through deeply nested patterns |

### browserslist

Affected function(s): query cache and normalizeStats. Build/lint browser-target resolution. Browser queries and stats are developer-controlled; no request data is supplied. Refreshed within ranges.

- Dev manifest, installed `4.28.1` (`browserslist`): `eslint-config-next@16.0.10` → `eslint-plugin-react-hooks@7.0.1` → `@babel/core@7.29.0` → `@babel/helper-compilation-targets@7.28.6` → `browserslist@4.28.1`

Resolved after: `4.29.4`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                                                                  |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) | high     | `<=4.28.6`     | 4.28.1                    | Removed              | Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM      |
| [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | high     | `<=4.28.6`     | 4.28.1                    | Removed              | Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats) |

### defu

Affected function(s): defaults merge. Wallet SDK dependency. No app-controlled untrusted defaults object reaching defu was demonstrated. Updated transitives.

- Runtime manifest, installed `6.1.4` (`defu`): `@creit.tech/stellar-wallets-kit@1.9.5` → `@walletconnect/sign-client@2.11.2` → `@walletconnect/core@2.11.2` → `@walletconnect/keyvaluestorage@1.1.1` → `unstorage@1.17.4` → `h3@1.15.5` → `defu@6.1.4`

Resolved after: `6.1.7`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ---------------------------------------------------------------- |
| [GHSA-737v-mqg7-c878](https://github.com/advisories/GHSA-737v-mqg7-c878) | high     | `<=6.1.4`      | 6.1.4                     | Removed              | defu: Prototype pollution via **proto** key in defaults argument |

### elliptic

Affected function(s): ECDSA sign. Crypto dependencies under ArDrive/Ethers, Trezor and NEAR. QuillTip uses RSA ArweaveSigner and delegates Stellar Ed25519 signing to wallets. No app ECDSA secret signs attacker messages through elliptic. Same-major 6.6.1 override removes the critical record; a moderate upstream nonce advisory remains outside the blocking threshold.

- Runtime manifest, installed `6.5.4` (`@dha-team/arbundles/@ethersproject/signing-key/elliptic`): `@ardrive/turbo-sdk@1.41.0` → `@dha-team/arbundles@1.0.4` → `@ethersproject/signing-key@5.7.0` → `elliptic@6.5.4`

Resolved after: `6.6.1`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                                         |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| [GHSA-vjh7-7g9h-fjfh](https://github.com/advisories/GHSA-vjh7-7g9h-fjfh) | critical | `<=6.6.0`      | 6.5.4                     | Removed              | Elliptic's private key extraction in ECDSA upon signing a malformed input (e.g. a string) |

### fast-uri

Affected function(s): parse, normalize and serialize. Development AJV/ESLint schema tooling, not app URL routing or SSRF enforcement. Updated within ranges.

- Dev manifest, installed `3.1.0` (`fast-uri`): `@commitlint/cli@20.4.2` → `@commitlint/load@20.4.0` → `@commitlint/config-validator@20.4.0` → `ajv@8.18.0` → `fast-uri@3.1.0`

Resolved after: `3.1.9`

| Advisory                                                                 | Severity | Affected range    | Affected installed before | Still affected after | Affected operation / record title                                                   |
| ------------------------------------------------------------------------ | -------- | ----------------- | ------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc) | high     | `>=3.0.0 <3.1.6`  | 3.1.0                     | Removed              | fast-uri vulnerable to server-side request forgery via malformed IPv6 normalization |
| [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp) | high     | `>=3.0.0 <3.1.6`  | 3.1.0                     | Removed              | fast-uri vulnerable to host confusion via percent-encoded scheme normalization      |
| [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) | high     | `>=3.0.0 <3.1.5`  | 3.1.0                     | Removed              | fast-uri vulnerable to host confusion via backslash authority introducer            |
| [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) | high     | `>=3.0.0 <=3.1.3` | 3.1.0                     | Removed              | fast-uri vulnerable to host confusion via literal backslash authority delimiter     |
| [GHSA-4c8g-83qw-93j6](https://github.com/advisories/GHSA-4c8g-83qw-93j6) | high     | `>=3.0.0 <3.1.3`  | 3.1.0                     | Removed              | fast-uri vulnerable to host confusion via failed IDN canonicalization               |
| [GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6) | high     | `>=3.0.0 <=3.1.0` | 3.1.0                     | Removed              | fast-uri vulnerable to path traversal via percent-encoded dot segments              |
| [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc) | high     | `>=3.0.0 <=3.1.1` | 3.1.0                     | Removed              | fast-uri vulnerable to host confusion via percent-encoded authority delimiters      |
| [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3) | high     | `>=3.0.0 <3.1.7`  | 3.1.0                     | Removed              | fast-uri vulnerable to authority injection via an unvalidated port in serialize     |

### flatted

Affected function(s): parse/revive. Development ESLint cache serialization. No application parser endpoint or untrusted cache file was established.

- Dev manifest, installed `3.3.3` (`flatted`): `eslint@9.39.3` → `file-entry-cache@8.0.0` → `flat-cache@4.0.1` → `flatted@3.3.3`

Resolved after: `3.4.4`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                     |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | --------------------------------------------------------------------- |
| [GHSA-25h7-pfq9-p65f](https://github.com/advisories/GHSA-25h7-pfq9-p65f) | high     | `<3.4.0`       | 3.3.3                     | Removed              | flatted vulnerable to unbounded recursion DoS in parse() revive phase |
| [GHSA-rf6f-7fwh-wjgh](https://github.com/advisories/GHSA-rf6f-7fwh-wjgh) | high     | `<=3.4.1`      | 3.3.3                     | Removed              | Prototype Pollution via parse() in NodeJS flatted                     |

### form-data

Affected function(s): multipart field/filename serialization. Runtime HTTP client SDK dependency. No call supplying attacker-controlled field names or filenames was demonstrated. Both major lines refreshed within ranges.

- Runtime manifest, installed `4.0.5` (`form-data`): `@stellar/stellar-sdk@14.5.0` → `axios@1.13.5` → `form-data@4.0.5`
- Runtime manifest, installed `3.0.4` (`superagent/form-data`): `@ardrive/turbo-sdk@1.41.0` → `@dha-team/arbundles@1.0.4` → `algosdk@1.13.1` → `superagent@6.1.0` → `form-data@3.0.4`

Resolved after: `3.0.5`, `4.0.6`

| Advisory                                                                 | Severity | Affected range   | Affected installed before | Still affected after | Affected operation / record title                                                        |
| ------------------------------------------------------------------------ | -------- | ---------------- | ------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) | high     | `>=4.0.0 <4.0.6` | 4.0.5                     | Removed              | form-data: CRLF injection in form-data via unescaped multipart field names and filenames |
| [GHSA-hmw2-7cc7-3qxx](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx) | high     | `>=3.0.0 <3.0.5` | 3.0.4                     | Removed              | form-data: CRLF injection in form-data via unescaped multipart field names and filenames |

### h3

Affected function(s): SSE field serialization. Transitive wallet/connect infrastructure; no application H3 SSE server. Updated compatible tree.

- Runtime manifest, installed `1.15.5` (`h3`): `@creit.tech/stellar-wallets-kit@1.9.5` → `@walletconnect/sign-client@2.11.2` → `@walletconnect/core@2.11.2` → `@walletconnect/keyvaluestorage@1.1.1` → `unstorage@1.17.4` → `h3@1.15.5`

Resolved after: `1.15.11`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                                     |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| [GHSA-22cc-p3c6-wpvm](https://github.com/advisories/GHSA-22cc-p3c6-wpvm) | high     | `<1.15.6`      | 1.15.5                    | Removed              | h3 has a Server-Sent Events Injection via Unsanitized Newlines in Event Stream Fields |

### hono

Affected function(s): serveStatic and CORS middleware. Transitive tooling/SDK dependency; app routes use Next.js/Convex and instantiate no Hono static server or CORS middleware. Updated compatible tree.

- Runtime manifest, installed `4.12.3` (`hono`): `@ardrive/turbo-sdk@1.41.0` → `x402-fetch@1.1.0` → `x402@1.1.0` → `wagmi@2.19.5` → `@wagmi/connectors@6.2.0` → `porto@0.2.35` → `hono@4.12.3`

Resolved after: `4.13.13`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                                               |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| [GHSA-q5qw-h33p-qvwr](https://github.com/advisories/GHSA-q5qw-h33p-qvwr) | high     | `<4.12.4`      | 4.12.3                    | Removed              | Hono vulnerable to arbitrary file access via serveStatic vulnerability                          |
| [GHSA-88fw-hqm2-52qc](https://github.com/advisories/GHSA-88fw-hqm2-52qc) | high     | `<4.12.25`     | 4.12.3                    | Removed              | hono: CORS Middleware reflects any Origin with credentials when origin defaults to the wildcard |

### ip-address

Affected function(s): Address4 parsing. Transitive network/proxy code; no application IP allowlist or domain validation uses this parser. Updated compatible tree.

- Runtime manifest, installed `10.1.0` (`ip-address`): `@creit.tech/stellar-wallets-kit@1.9.5` → `@trezor/connect-plugin-stellar@9.2.1` → `@trezor/connect@9.6.2` → `@trezor/blockchain-link@2.5.2` → `socks-proxy-agent@8.0.5` → `socks@2.8.7` → `ip-address@10.1.0`

Resolved after: `10.7.4`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                                                                                         |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-mwp4-54f8-5fhr](https://github.com/advisories/GHSA-mwp4-54f8-5fhr) | high     | `<=10.3.0`     | 10.1.0                    | Removed              | ip-address: Address4 decodes leading-zero octets as decimal while resolvers decode them as octal, allowing SSRF and trust-boundary bypass |

### js-yaml

Affected function(s): merge key and !!omap resolution. Development ESLint/config parser; checked-in configs rather than request bodies. Updated compatible tree.

- Dev manifest, installed `4.1.1` (`js-yaml`): `@eslint/eslintrc@3.3.4` → `js-yaml@4.1.1`

Resolved after: `4.3.2`

| Advisory                                                                 | Severity | Affected range   | Affected installed before | Still affected after | Affected operation / record title                                                                         |
| ------------------------------------------------------------------------ | -------- | ---------------- | ------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m) | high     | `>=4.0.0 <4.3.0` | 4.1.1                     | Removed              | js-yaml: YAML merge-key chains can force quadratic CPU consumption                                        |
| [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) | high     | `>=4.0.0 <4.3.1` | 4.1.1                     | Removed              | JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported |
| [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) | high     | `>=4.0.0 <4.3.2` | 4.1.1                     | Removed              | js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources                                 |

### linkify-it

Affected function(s): match and mailto validator scanning. Included through editor Markdown tooling. App edits Tiptap JSON; no Markdown parser entry was established. Updated compatible tree.

- Runtime manifest, installed `5.0.0` (`linkify-it`): `@tiptap/pm@3.20.0` → `prosemirror-markdown@1.13.4` → `markdown-it@14.1.1` → `linkify-it@5.0.0`

Resolved after: package removed from the canonical tree.

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                                         |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| [GHSA-22p9-wv53-3rq4](https://github.com/advisories/GHSA-22p9-wv53-3rq4) | high     | `<=5.0.0`      | 5.0.0                     | Removed              | LinkifyIt#match scan loop has quadratic algorithmic complexity                            |
| [GHSA-v245-v573-v5vm](https://github.com/advisories/GHSA-v245-v573-v5vm) | high     | `<=5.0.1`      | 5.0.0                     | Removed              | linkify-it: Quadratic-complexity DoS via the mailto: validator scan-loop on attacker text |

### lodash

Affected function(s): template imports. Runtime wallet/SDK utility tree. No application \_.template call or untrusted imports mapping. Updated compatible tree.

- Runtime manifest, installed `4.17.23` (`lodash`): `@ardrive/turbo-sdk@1.41.0` → `x402-fetch@1.1.0` → `x402@1.1.0` → `wagmi@2.19.5` → `@wagmi/connectors@6.2.0` → `@gemini-wallet/core@0.3.2` → `@metamask/rpc-errors@7.0.2` → `@metamask/utils@11.10.0` → `lodash@4.17.23`

Resolved after: `4.18.1`

| Advisory                                                                 | Severity | Affected range      | Affected installed before | Still affected after | Affected operation / record title                                     |
| ------------------------------------------------------------------------ | -------- | ------------------- | ------------------------- | -------------------- | --------------------------------------------------------------------- |
| [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) | high     | `>=4.0.0 <=4.17.23` | 4.17.23                   | Removed              | lodash vulnerable to Code Injection via \_.template imports key names |

### markdown-it

Affected function(s): link-reference and smartquotes rendering. Included through editor Markdown tooling; no application Markdown parsing entry was established. Updated compatible tree.

- Runtime manifest, installed `14.1.1` (`markdown-it`): `@tiptap/pm@3.20.0` → `prosemirror-markdown@1.13.4` → `markdown-it@14.1.1`

Resolved after: package removed from the canonical tree.

| Advisory                                                                 | Severity | Affected range     | Affected installed before | Still affected after | Affected operation / record title                                                                                                   |
| ------------------------------------------------------------------------ | -------- | ------------------ | ------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-gfr2-rv44-r23c](https://github.com/advisories/GHSA-gfr2-rv44-r23c) | high     | `>=14.1.0 <14.3.3` | 14.1.1                    | Removed              | markdown-it: Quadratic-time rendering of a single multi-line link reference definition with default options (regression since 14.0) |
| [GHSA-r7fv-28h4-cvq7](https://github.com/advisories/GHSA-r7fv-28h4-cvq7) | high     | `<14.3.2`          | 14.1.1                    | Removed              | markdown-it: Quadratic complexity in smartquotes with unmatched closing quotes                                                      |

### nanoid

Affected function(s): non-secure and custom generators. Build/runtime transitive identifier generation; no application caller supplies attacker-controlled sizes. Updated compatible copies.

- Runtime manifest, installed `3.3.11` (`nanoid`): `next@16.1.6` → `postcss@8.4.31` → `nanoid@3.3.11`
- Dev manifest, installed `3.3.11` (`nanoid`): `vitest@4.0.18` → `vite@7.3.1` → `postcss@8.5.6` → `nanoid@3.3.11`

Resolved after: `3.3.20`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                      |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ---------------------------------------------------------------------- |
| [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) | high     | `<3.3.16`      | 3.3.11                    | Removed              | nanoid: non-secure generators can loop indefinitely with negative size |
| [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | high     | `<3.3.18`      | 3.3.11                    | Removed              | nanoid: custom generators can loop indefinitely when size is zero      |
| [GHSA-xwg4-73v4-xw9w](https://github.com/advisories/GHSA-xwg4-73v4-xw9w) | high     | `<3.3.12`      | 3.3.11                    | Removed              | nanoid: Integer Overflow or Wraparound                                 |

### next

Affected function(s): Server Components, Server Actions, middleware/proxy routing, image optimization and cache functions. Runtime App Router and next/image are reachable. Platform-specific and optional feature prerequisites vary by advisory; no app RCE/SSRF proof was produced. Refreshed to 16.4.2 within the existing major. Dedicated Next/Sharp root-cause tracking is issue #238; this is not a claim that its deployment has completed.

- Runtime manifest, installed `16.1.6` (`next`): `next@16.1.6`

Resolved after: `16.4.2`

| Advisory                                                                 | Severity | Affected range            | Affected installed before | Still affected after | Affected operation / record title                                                                                         |
| ------------------------------------------------------------------------ | -------- | ------------------------- | ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-8h8q-6873-q5fj](https://github.com/advisories/GHSA-8h8q-6873-q5fj) | high     | `>=16.0.0 <16.2.5`        | 16.1.6                    | Removed              | Next.js Vulnerable to Denial of Service with Server Components                                                            |
| [GHSA-26hh-7cqf-hhc6](https://github.com/advisories/GHSA-26hh-7cqf-hhc6) | high     | `>=16.0.0 <16.2.6`        | 16.1.6                    | Removed              | Next.js has a Middleware / Proxy bypass in App Router applications via segment-prefetch routes - Incomplete Fix Follow-Up |
| [GHSA-mg66-mrh9-m8jx](https://github.com/advisories/GHSA-mg66-mrh9-m8jx) | high     | `>=16.0.0 <16.2.5`        | 16.1.6                    | Removed              | Next.js vulnerable to Denial of Service via connection exhaustion in applications using Cache Components                  |
| [GHSA-c4j6-fc7j-m34r](https://github.com/advisories/GHSA-c4j6-fc7j-m34r) | high     | `>=16.0.0 <16.2.5`        | 16.1.6                    | Removed              | Next.js vulnerable to server-side request forgery in applications using WebSocket upgrades                                |
| [GHSA-492v-c6pp-mqqv](https://github.com/advisories/GHSA-492v-c6pp-mqqv) | high     | `>=16.0.0 <16.2.5`        | 16.1.6                    | Removed              | Next.js has a Middleware / Proxy bypass through dynamic route parameter injection                                         |
| [GHSA-267c-6grr-h53f](https://github.com/advisories/GHSA-267c-6grr-h53f) | high     | `>=16.0.0 <16.2.5`        | 16.1.6                    | Removed              | Next.js has a Middleware / Proxy bypass in App Router applications via segment-prefetch routes                            |
| [GHSA-36qx-fr4f-26g5](https://github.com/advisories/GHSA-36qx-fr4f-26g5) | high     | `>=16.0.0 <16.2.5`        | 16.1.6                    | Removed              | Next.js has a Middleware / Proxy bypass in Pages Router applications using i18n                                           |
| [GHSA-q4gf-8mx6-v5v3](https://github.com/advisories/GHSA-q4gf-8mx6-v5v3) | high     | `>=16.0.0-beta.0 <16.2.3` | 16.1.6                    | Removed              | Next.js has a Denial of Service with Server Components                                                                    |
| [GHSA-89xv-2m56-2m9x](https://github.com/advisories/GHSA-89xv-2m56-2m9x) | high     | `>=16.0.0 <16.2.11`       | 16.1.6                    | Removed              | Next.js: Server-Side Request Forgery in Server Actions on custom servers                                                  |
| [GHSA-6gpp-xcg3-4w24](https://github.com/advisories/GHSA-6gpp-xcg3-4w24) | high     | `>=16.0.0 <16.2.11`       | 16.1.6                    | Removed              | Next.js: Middleware / Proxy bypass in App Router applications using Turbopack and single locale                           |
| [GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj) | high     | `>=16.0.0 <16.2.11`       | 16.1.6                    | Removed              | Next.js: Denial of Service in App Router using Server Actions                                                             |
| [GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4) | high     | `>=16.0.0 <16.2.11`       | 16.1.6                    | Removed              | Next.js: Server-Side Request Forgery in rewrites via attacker-controlled destination hostname                             |
| [GHSA-cjq9-62q9-8jv4](https://github.com/advisories/GHSA-cjq9-62q9-8jv4) | high     | `>=16.0.0 <16.3.8`        | 16.1.6                    | Removed              | Next.js has Server-Side Request Forgery in Image Optimization                                                             |
| [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) | critical | `>=16.0.0 <16.3.3`        | 16.1.6                    | Removed              | Next.js: Unauthenticated Remote Code Execution on windows-hosted servers                                                  |
| [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) | critical | `>=16.0.0 <16.3.3`        | 16.1.6                    | Removed              | Next.js: Unauthenticated Remote Code Execution in Image Optimization API when AVIF files are used                         |
| [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r) | high     | `>=16.0.0 <=16.4.0`       | 16.1.6                    | Removed              | Next.js: Denial of Service in App Router using Server Actions                                                             |
| [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw) | critical | `>=16.0.0 <=16.4.0`       | 16.1.6                    | Removed              | Next.js: Unauthenticated Remote Code Execution in Image Optimization API when SVG files are used                          |
| [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr) | critical | `>=16.0.0 <=16.4.0`       | 16.1.6                    | Removed              | Next.js: Unauthenticated Remote Code Execution in use cache functions returning typed arrays                              |

### picomatch

Affected function(s): extglob matching. Build/tooling and SDK glob matching; no application request-to-glob entry was established. Updated each compatible major.

- Runtime manifest, installed `2.3.1` (`anymatch/picomatch`): `@creit.tech/stellar-wallets-kit@1.9.5` → `@walletconnect/sign-client@2.11.2` → `@walletconnect/core@2.11.2` → `@walletconnect/keyvaluestorage@1.1.1` → `unstorage@1.17.4` → `anymatch@3.1.3` → `picomatch@2.3.1`
- Dev manifest, installed `2.3.1` (`micromatch/picomatch`): `lint-staged@16.2.7` → `micromatch@4.0.8` → `picomatch@2.3.1`
- Dev manifest, installed `4.0.3` (`picomatch`): `vitest@4.0.18` → `picomatch@4.0.3`

Resolved after: `2.3.2`, `4.0.7`

| Advisory                                                                 | Severity | Affected range   | Affected installed before | Still affected after | Affected operation / record title                           |
| ------------------------------------------------------------------------ | -------- | ---------------- | ------------------------- | -------------------- | ----------------------------------------------------------- |
| [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) | high     | `<2.3.2`         | 2.3.1                     | Removed              | Picomatch has a ReDoS vulnerability via extglob quantifiers |
| [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) | high     | `>=4.0.0 <4.0.4` | 4.0.3                     | Removed              | Picomatch has a ReDoS vulnerability via extglob quantifiers |

### postcss

Affected function(s): previous source-map auto-loading. Build-time CSS tooling, including Next and Tailwind. CSS comes from source files; no app service compiles attacker-submitted CSS. Updated compatible copies.

- Dev manifest, installed `8.5.6` (`postcss`): `vitest@4.0.18` → `vite@7.3.1` → `postcss@8.5.6`
- Runtime manifest, installed `8.4.31` (`next/postcss`): `next@16.1.6` → `postcss@8.4.31`

Resolved after: `8.5.23`, `8.5.31`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                                                                      |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) | high     | `<=8.5.11`     | 8.4.31, 8.5.6             | Removed              | PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments       |
| [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | high     | `<=8.5.17`     | 8.4.31, 8.5.6             | Removed              | PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure |

### prosemirror-view

Affected function(s): clipboard paste HTML parser. Browser editor uses ProseMirror and can receive pasted HTML, so the affected surface is plausibly reachable. No app-specific exploit payload or newly confirmed root cause was produced; upgrade to 1.42.7 removes the affected version. Existing editor/rendering tests cover compatibility, not a proof of exploitability.

- Runtime manifest, installed `1.41.6` (`prosemirror-view`): `@tiptap/pm@3.20.0` → `prosemirror-view@1.41.6`

Resolved after: `1.42.7`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                        |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ------------------------------------------------------------------------ |
| [GHSA-c8x8-7fp4-3x9w](https://github.com/advisories/GHSA-c8x8-7fp4-3x9w) | high     | `<1.42.3`      | 1.41.6                    | Removed              | ProseMirror has a XSS vulnerability in prosemirror-view's paste handling |

### protobufjs

Affected function(s): reflection/codegen, option paths, recursive decoding and Any JSON conversion. Trezor wallet-kit dependency pinned to 7.4.0. QuillTip never loads caller-supplied protobuf schemas or calls protobuf reflection/codegen directly. Same-major 7.6.6 override removes the critical and high records; no code-execution proof was produced.

- Runtime manifest, installed `7.4.0` (`protobufjs`): `@creit.tech/stellar-wallets-kit@1.9.5` → `@trezor/connect-plugin-stellar@9.2.1` → `@trezor/connect@9.6.2` → `@trezor/protobuf@1.4.2` → `protobufjs@7.4.0`

Resolved after: `7.6.6`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                                    |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| [GHSA-66ff-xgx4-vchm](https://github.com/advisories/GHSA-66ff-xgx4-vchm) | high     | `<=7.5.5`      | 7.4.0                     | Removed              | protobuf.js: Code injection through bytes field defaults in generated toObject code  |
| [GHSA-75px-5xx7-5xc7](https://github.com/advisories/GHSA-75px-5xx7-5xc7) | high     | `<=7.5.5`      | 7.4.0                     | Removed              | protobuf.js: Code generation gadget after prototype pollution                        |
| [GHSA-jvwf-75h9-cwgg](https://github.com/advisories/GHSA-jvwf-75h9-cwgg) | high     | `<=7.5.5`      | 7.4.0                     | Removed              | protobuf.js: Process-wide denial of service through unsafe option paths              |
| [GHSA-685m-2w69-288q](https://github.com/advisories/GHSA-685m-2w69-288q) | high     | `<=7.5.5`      | 7.4.0                     | Removed              | protobuf.js: Denial of service through unbounded protobuf recursion                  |
| [GHSA-xq3m-2v4x-88gg](https://github.com/advisories/GHSA-xq3m-2v4x-88gg) | critical | `<7.5.5`       | 7.4.0                     | Removed              | Arbitrary code execution in protobufjs                                               |
| [GHSA-wcpc-wj8m-hjx6](https://github.com/advisories/GHSA-wcpc-wj8m-hjx6) | high     | `<=7.6.0`      | 7.4.0                     | Removed              | protobufjs: Denial of service through unbounded Any expansion during JSON conversion |

### secp256k1

Affected function(s): ECDH. Turbo arbundles and NEAR crypto include secp256k1. Stellar signing uses Ed25519 wallet adapters and Arweave uses RSA. No app ECDH secret is processed here. Same-major 5.0.2 override.

- Runtime manifest, installed `5.0.0` (`secp256k1`): `@ardrive/turbo-sdk@1.41.0` → `@dha-team/arbundles@1.0.4` → `secp256k1@5.0.0`

Resolved after: `5.0.2`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                      |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ------------------------------------------------------ |
| [GHSA-584q-6j8j-r5pm](https://github.com/advisories/GHSA-584q-6j8j-r5pm) | high     | `=5.0.0`       | 5.0.0                     | Removed              | secp256k1-node allows private key extraction over ECDH |

### sharp

Affected function(s): image decode through libvips/libheif/librsvg. Runtime Next image optimization decodes allowed remote images. Refreshed Next tree selects patched Sharp 0.35.5. Dedicated follow-up remains #238; no malicious image was uploaded or published during verification.

- Runtime manifest, installed `0.34.5` (`sharp`): `next@16.1.6` → `sharp@0.34.5`

Resolved after: `0.35.5`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                                                          |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | high     | `<0.35.0`      | 0.34.5                    | Removed              | sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 |
| [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) | high     | `<0.35.4`      | 0.34.5                    | Removed              | sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545                             |
| [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) | high     | `<0.35.5`      | 0.34.5                    | Removed              | sharp : Vulnerability in librsvg dependency CVE-2026-96889                                                 |

### shell-quote

Affected function(s): quote object .op escaping and parse. Development npm-run-all commands use fixed package scripts. No application input reaches shell-quote. Updated compatible transitive release.

- Dev manifest, installed `1.8.3` (`shell-quote`): `npm-run-all@4.1.5` → `shell-quote@1.8.3`

Resolved after: `1.12.0`

| Advisory                                                                 | Severity | Affected range    | Affected installed before | Still affected after | Affected operation / record title                                        |
| ------------------------------------------------------------------------ | -------- | ----------------- | ------------------------- | -------------------- | ------------------------------------------------------------------------ |
| [GHSA-w7jw-789q-3m8p](https://github.com/advisories/GHSA-w7jw-789q-3m8p) | critical | `>=1.1.0 <=1.8.3` | 1.8.3                     | Removed              | shell-quote quote() does not escape newlines in object .op values        |
| [GHSA-395f-4hp3-45gv](https://github.com/advisories/GHSA-395f-4hp3-45gv) | high     | `<=1.8.4`         | 1.8.3                     | Removed              | shell-quote: Quadratic-complexity Denial of Service in parse() (CWE-407) |

### socket.io-parser

Affected function(s): binary attachment reconstruction. Transitive wallet transport dependency; no application Socket.IO server. Malicious-peer prerequisites were not established. Updated compatible tree.

- Runtime manifest, installed `4.2.5` (`socket.io-parser`): `@ardrive/turbo-sdk@1.41.0` → `x402-fetch@1.1.0` → `x402@1.1.0` → `wagmi@2.19.5` → `@wagmi/connectors@6.2.0` → `@metamask/sdk@0.33.1` → `socket.io-client@4.8.3` → `socket.io-parser@4.2.5`

Resolved after: `4.2.7`

| Advisory                                                                 | Severity | Affected range   | Affected installed before | Still affected after | Affected operation / record title                          |
| ------------------------------------------------------------------------ | -------- | ---------------- | ------------------------- | -------------------- | ---------------------------------------------------------- |
| [GHSA-2m8v-j782-fhvr](https://github.com/advisories/GHSA-2m8v-j782-fhvr) | high     | `>=4.0.0 <4.2.7` | 4.2.5                     | Removed              | Socket.IO: Zero-attachment Memory Exhaustion               |
| [GHSA-677m-j7p3-52f9](https://github.com/advisories/GHSA-677m-j7p3-52f9) | high     | `>=4.0.0 <4.2.6` | 4.2.5                     | Removed              | socket.io allows an unbounded number of binary attachments |

### source-map-js

Affected function(s): indexed source-map section offsets. Build/render tooling. No user-authored source map is parsed by an application endpoint. Updated compatible tree.

- Runtime manifest, installed `1.2.1` (`source-map-js`): `@tailwindcss/postcss@4.2.1` → `@tailwindcss/node@4.2.1` → `source-map-js@1.2.1`
- Dev manifest, installed `1.2.1` (`source-map-js`): `jsdom@29.0.1` → `css-tree@3.2.1` → `source-map-js@1.2.1`

Resolved after: `1.2.2`

| Advisory                                                                 | Severity | Affected range   | Affected installed before | Still affected after | Affected operation / record title                                                            |
| ------------------------------------------------------------------------ | -------- | ---------------- | ------------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | high     | `>=1.0.0 <1.2.2` | 1.2.1                     | Removed              | source-map-js allows event-loop denial of service through indexed source-map section offsets |

### tmp

Affected function(s): temporary filename prefix/postfix handling. Transitive SDK/CLI dependency. No application input supplies tmp prefixes/postfixes. Updated compatible tree.

- Runtime manifest, installed `0.2.5` (`tmp`): `@ardrive/turbo-sdk@1.41.0` → `@dha-team/arbundles@1.0.4` → `tmp-promise@3.0.2` → `tmp@0.2.5`

Resolved after: `0.2.7`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                                   |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65) | high     | `<0.2.6`       | 0.2.5                     | Removed              | tmp has Path Traversal via unsanitized prefix/postfix that enables directory escape |

### toml

Affected function(s): parse: recursion, key paths, tables and integer literals. SDK includes StellarTomlResolver/federation/domain-discovery helpers. Application callers use Horizon, Soroban, transaction and XDR APIs, not these helpers. No attacker TOML reaches parse. Patched parser changes major; see remaining exceptions.

- Runtime manifest, installed `3.0.0` (`toml`): `@stellar/stellar-sdk@14.5.0` → `toml@3.0.0`

Resolved after: `3.0.0`

| Advisory                                                                 | Severity | Affected range | Affected installed before | Still affected after | Affected operation / record title                                                                            |
| ------------------------------------------------------------------------ | -------- | -------------- | ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| [GHSA-82x6-q7mm-w9cf](https://github.com/advisories/GHSA-82x6-q7mm-w9cf) | high     | `<4.2.0`       | 3.0.0                     | 3.0.0                | toml-node: Uncontrolled Recursion                                                                            |
| [GHSA-v5mp-jgw5-2x6j](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j) | high     | `<4.1.2`       | 3.0.0                     | 3.0.0                | toml-node: Prototype Pollution Leads to Object.prototype Corruption via **proto** Key-Path Desynchronization |
| [GHSA-4qx8-w7c3-pj3p](https://github.com/advisories/GHSA-4qx8-w7c3-pj3p) | high     | `<=5.0.0`      | 3.0.0                     | 3.0.0                | toml-node: Quadratic-complexity DoS via many array-of-tables headers in toml.parse()                         |
| [GHSA-9j65-hcg3-gc64](https://github.com/advisories/GHSA-9j65-hcg3-gc64) | high     | `<=5.0.0`      | 3.0.0                     | 3.0.0                | toml-node: Quadratic-complexity DoS via long dotted keys or table paths in toml.parse()                      |
| [GHSA-9qmh-m7c6-f92p](https://github.com/advisories/GHSA-9qmh-m7c6-f92p) | high     | `<=5.0.0`      | 3.0.0                     | 3.0.0                | toml-node: Uncontrolled resource consumption (CPU DoS) via unbounded-length integer literals in toml.parse() |

### undici

Affected function(s): WebSocket frame/extension handling, HTTP cache and proxy/TLS dispatch. Transitive runtime and tooling clients. No app Undici WebSocket, SOCKS proxy or private-cache configuration was established. Refreshed each compatible major.

- Runtime manifest, installed `5.29.0` (`warp-isomorphic/undici`): `@ardrive/turbo-sdk@1.41.0` → `@permaweb/aoconnect@0.0.57` → `warp-arbundles@1.0.4` → `warp-isomorphic@1.0.7` → `undici@5.29.0`
- Dev manifest, installed `7.24.6` (`undici`): `jsdom@29.0.1` → `undici@7.24.6`

Resolved after: package removed from the canonical tree.

| Advisory                                                                 | Severity | Affected range     | Affected installed before | Still affected after | Affected operation / record title                                                                                   |
| ------------------------------------------------------------------------ | -------- | ------------------ | ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [GHSA-vrm6-8vpv-qv8q](https://github.com/advisories/GHSA-vrm6-8vpv-qv8q) | high     | `<6.24.0`          | 5.29.0                    | Removed              | Undici has Unbounded Memory Consumption in WebSocket permessage-deflate Decompression                               |
| [GHSA-v9p9-hfj2-hcw8](https://github.com/advisories/GHSA-v9p9-hfj2-hcw8) | high     | `<6.24.0`          | 5.29.0                    | Removed              | Undici has Unhandled Exception in WebSocket Client Due to Invalid server_max_window_bits Validation                 |
| [GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272) | high     | `>=7.0.0 <7.29.0`  | 7.24.6                    | Removed              | undici vulnerable to cross-user information disclosure and parse-time crash via degenerate private cache directives |
| [GHSA-vmh5-mc38-953g](https://github.com/advisories/GHSA-vmh5-mc38-953g) | high     | `>=7.23.0 <7.28.0` | 7.24.6                    | Removed              | undici vulnerable to TLS certificate validation bypass via dropped requestTls in SOCKS5 ProxyAgent                  |
| [GHSA-vxpw-j846-p89q](https://github.com/advisories/GHSA-vxpw-j846-p89q) | high     | `>=7.0.0 <7.28.0`  | 7.24.6                    | Removed              | undici WebSocket client vulnerable to denial of service via fragment count bypass                                   |
| [GHSA-vxpw-j846-p89q](https://github.com/advisories/GHSA-vxpw-j846-p89q) | high     | `<6.27.0`          | 5.29.0                    | Removed              | undici WebSocket client vulnerable to denial of service via fragment count bypass                                   |
| [GHSA-hm92-r4w5-c3mj](https://github.com/advisories/GHSA-hm92-r4w5-c3mj) | high     | `>=7.23.0 <7.28.0` | 7.24.6                    | Removed              | undici vulnerable to cross-origin request routing via SOCKS5 proxy pool reuse                                       |
| [GHSA-rfgv-xxqx-mfg5](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5) | high     | `>=7.0.0 <7.29.1`  | 7.24.6                    | Removed              | undici vulnerable to Denial of Service via unrequested WebSocket subprotocol                                        |
| [GHSA-w293-vg96-wgc3](https://github.com/advisories/GHSA-w293-vg96-wgc3) | high     | `>=7.24.1 <7.29.1` | 7.24.6                    | Removed              | undici vulnerable to TLS certificate validation bypass via dropped connect options in BalancedPool                  |

### vite

Affected function(s): development filesystem and WebSocket handlers. Vitest development dependency, not the production Next server. Updated compatible Vite 7 tree. CI uses vitest run; no public Vite server is started.

- Dev manifest, installed `7.3.1` (`vite`): `vitest@4.0.18` → `vite@7.3.1`

Resolved after: `8.3.5`

| Advisory                                                                 | Severity | Affected range    | Affected installed before | Still affected after | Affected operation / record title                                         |
| ------------------------------------------------------------------------ | -------- | ----------------- | ------------------------- | -------------------- | ------------------------------------------------------------------------- |
| [GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r) | high     | `>=7.1.0 <=7.3.1` | 7.3.1                     | Removed              | Vite: server.fs.deny bypassed with queries                                |
| [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583) | high     | `>=7.0.0 <=7.3.1` | 7.3.1                     | Removed              | Vite Vulnerable to Arbitrary File Read via Vite Dev Server WebSocket      |
| [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | high     | `>=7.0.0 <=7.3.4` | 7.3.1                     | Removed              | vite: server.fs.deny bypass on Windows alternate paths                    |
| [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | high     | `>=7.0.0 <=7.3.6` | 7.3.1                     | Removed              | launch-editor: fs.existsSync() existence check can be bypassed on Windows |

### vitest

Affected function(s): UI server filesystem access and execution. Development-only test runner. App never mounts Vitest UI; CI uses run. Upgrade removes advisory regardless of UI reachability.

- Dev manifest, installed `4.0.18` (`vitest`): `vitest@4.0.18`

Resolved after: `4.1.12`

| Advisory                                                                 | Severity | Affected range   | Affected installed before | Still affected after | Affected operation / record title                                           |
| ------------------------------------------------------------------------ | -------- | ---------------- | ------------------------- | -------------------- | --------------------------------------------------------------------------- |
| [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) | critical | `>=4.0.0 <4.1.0` | 4.0.18                    | Removed              | When Vitest UI server is listening, arbitrary file can be read and executed |

### ws

Affected function(s): server header handling and fragment/chunk buffering. Runtime Convex and optional wallet/SDK transports plus development analyzer. App exposes no ws server. Updated all 7.x and 8.x consumers separately with Bun version-scoped overrides, preserving their major APIs.

- Runtime manifest, installed `7.4.6` (`@ethersproject/providers/ws`): `@ardrive/turbo-sdk@1.41.0` → `@dha-team/arbundles@1.0.4` → `@ethersproject/providers@5.7.2` → `ws@7.4.6`
- Runtime manifest, installed `8.18.0` (`ws`): `convex@1.32.0` → `ws@8.18.0`
- Runtime manifest, installed `8.19.0` (`@solana/rpc-subscriptions-channel-websocket/ws`): `@ardrive/turbo-sdk@1.41.0` → `x402-fetch@1.1.0` → `x402@1.1.0` → `@solana/kit@5.5.1` → `@solana/rpc-subscriptions@5.5.1` → `@solana/rpc-subscriptions-channel-websocket@5.5.1` → `ws@8.19.0`
- Runtime manifest, installed `8.18.3` (`@trezor/websocket-client/ws`): `@creit.tech/stellar-wallets-kit@1.9.5` → `@trezor/connect-web@9.6.2` → `@trezor/websocket-client@1.2.2` → `ws@8.18.3`
- Runtime manifest, installed `8.19.0` (`@xrplf/isomorphic/ws`): `@creit.tech/stellar-wallets-kit@1.9.5` → `@trezor/connect-plugin-stellar@9.2.1` → `@trezor/connect@9.6.2` → `@trezor/blockchain-link@2.5.2` → `xrpl@4.6.0` → `@xrplf/isomorphic@1.0.1` → `ws@8.19.0`
- Runtime manifest, installed `8.18.3` (`engine.io-client/ws`): `@ardrive/turbo-sdk@1.41.0` → `x402-fetch@1.1.0` → `x402@1.1.0` → `wagmi@2.19.5` → `@wagmi/connectors@6.2.0` → `@metamask/sdk@0.33.1` → `socket.io-client@4.8.3` → `engine.io-client@6.6.4` → `ws@8.18.3`
- Runtime manifest, installed `8.17.1` (`ethers/ws`): `@ardrive/turbo-sdk@1.41.0` → `ethers@6.16.0` → `ws@8.17.1`
- Runtime manifest, installed `8.19.0` (`happy-dom/ws`): `@tiptap/html@3.23.5` → `happy-dom@20.9.0` → `ws@8.19.0`
- Dev manifest, installed `8.19.0` (`happy-dom/ws`): `vitest@4.0.18` → `happy-dom@20.9.0` → `ws@8.19.0`
- Runtime manifest, installed `8.18.3` (`viem/ws`): `@ardrive/turbo-sdk@1.41.0` → `x402-fetch@1.1.0` → `viem@2.46.3` → `ws@8.18.3`
- Runtime manifest, installed `7.5.10` (`@cosmjs/socket/ws`): `@ardrive/turbo-sdk@1.41.0` → `@cosmjs/stargate@0.33.1` → `@cosmjs/tendermint-rpc@0.33.1` → `@cosmjs/socket@0.33.1` → `ws@7.5.10`
- Runtime manifest, installed `7.5.10` (`@walletconnect/jsonrpc-ws-connection/ws`): `@creit.tech/stellar-wallets-kit@1.9.5` → `@walletconnect/sign-client@2.11.2` → `@walletconnect/core@2.11.2` → `@walletconnect/jsonrpc-ws-connection@1.0.14` → `ws@7.5.10`
- Runtime manifest, installed `7.5.10` (`jayson/ws`): `@ardrive/turbo-sdk@1.41.0` → `@solana/web3.js@1.98.4` → `jayson@4.3.0` → `ws@7.5.10`
- Dev manifest, installed `7.5.10` (`webpack-bundle-analyzer/ws`): `@next/bundle-analyzer@16.2.2` → `webpack-bundle-analyzer@4.10.1` → `ws@7.5.10`
- Runtime manifest, installed `7.5.10` (`@walletconnect/ethereum-provider/@walletconnect/sign-client/@walletconnect/core/@walletconnect/jsonrpc-ws-connection/ws`): `@ardrive/turbo-sdk@1.41.0` → `x402-fetch@1.1.0` → `x402@1.1.0` → `wagmi@2.19.5` → `@wagmi/connectors@6.2.0` → `@walletconnect/ethereum-provider@2.21.1` → `@walletconnect/sign-client@2.21.1` → `@walletconnect/core@2.21.1` → `@walletconnect/jsonrpc-ws-connection@1.0.16` → `ws@7.5.10`
- Runtime manifest, installed `7.5.10` (`@walletconnect/universal-provider/@walletconnect/sign-client/@walletconnect/core/@walletconnect/jsonrpc-ws-connection/ws`): `@ardrive/turbo-sdk@1.41.0` → `x402-fetch@1.1.0` → `x402@1.1.0` → `wagmi@2.19.5` → `@wagmi/connectors@6.2.0` → `@walletconnect/ethereum-provider@2.21.1` → `@walletconnect/universal-provider@2.21.1` → `@walletconnect/sign-client@2.21.1` → `@walletconnect/core@2.21.1` → `@walletconnect/jsonrpc-ws-connection@1.0.16` → `ws@7.5.10`
- Runtime manifest, installed `7.5.10` (`@reown/appkit-controllers/@walletconnect/universal-provider/@walletconnect/sign-client/@walletconnect/core/@walletconnect/jsonrpc-ws-connection/ws`): `@ardrive/turbo-sdk@1.41.0` → `x402-fetch@1.1.0` → `x402@1.1.0` → `wagmi@2.19.5` → `@wagmi/connectors@6.2.0` → `@walletconnect/ethereum-provider@2.21.1` → `@reown/appkit@1.7.8` → `@reown/appkit-controllers@1.7.8` → `@walletconnect/universal-provider@2.21.0` → `@walletconnect/sign-client@2.21.0` → `@walletconnect/core@2.21.0` → `@walletconnect/jsonrpc-ws-connection@1.0.16` → `ws@7.5.10`
- Runtime manifest, installed `7.5.10` (`@reown/appkit-utils/@walletconnect/universal-provider/@walletconnect/sign-client/@walletconnect/core/@walletconnect/jsonrpc-ws-connection/ws`): `@ardrive/turbo-sdk@1.41.0` → `x402-fetch@1.1.0` → `x402@1.1.0` → `wagmi@2.19.5` → `@wagmi/connectors@6.2.0` → `@walletconnect/ethereum-provider@2.21.1` → `@reown/appkit@1.7.8` → `@reown/appkit-utils@1.7.8` → `@walletconnect/universal-provider@2.21.0` → `@walletconnect/sign-client@2.21.0` → `@walletconnect/core@2.21.0` → `@walletconnect/jsonrpc-ws-connection@1.0.16` → `ws@7.5.10`
- Runtime manifest, installed `7.5.10` (`@reown/appkit/@walletconnect/universal-provider/@walletconnect/sign-client/@walletconnect/core/@walletconnect/jsonrpc-ws-connection/ws`): `@ardrive/turbo-sdk@1.41.0` → `x402-fetch@1.1.0` → `x402@1.1.0` → `wagmi@2.19.5` → `@wagmi/connectors@6.2.0` → `@walletconnect/ethereum-provider@2.21.1` → `@reown/appkit@1.7.8` → `@walletconnect/universal-provider@2.21.0` → `@walletconnect/sign-client@2.21.0` → `@walletconnect/core@2.21.0` → `@walletconnect/jsonrpc-ws-connection@1.0.16` → `ws@7.5.10`

Resolved after: `7.5.13`, `8.21.0`

| Advisory                                                                 | Severity | Affected range    | Affected installed before      | Still affected after | Affected operation / record title                                   |
| ------------------------------------------------------------------------ | -------- | ----------------- | ------------------------------ | -------------------- | ------------------------------------------------------------------- |
| [GHSA-3h5v-q93c-6h6q](https://github.com/advisories/GHSA-3h5v-q93c-6h6q) | high     | `>=7.0.0 <7.5.10` | 7.4.6                          | Removed              | ws affected by a DoS when handling a request with many HTTP headers |
| [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | high     | `>=8.0.0 <8.21.0` | 8.17.1, 8.18.0, 8.18.3, 8.19.0 | Removed              | ws: Memory exhaustion DoS from tiny fragments and data chunks       |
| [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | high     | `>=7.0.0 <7.5.11` | 7.4.6, 7.5.10                  | Removed              | ws: Memory exhaustion DoS from tiny fragments and data chunks       |

## Verification

The audit CLI is tested through its command-line boundary with saved registry reports and a stubbed registry command. The tests cover new high/critical findings, current exact exceptions, mismatched IDs/versions/ranges/severities, expired/incomplete policies, invalid ranges, missing locked packages, malformed reports, command failure and status/report contradictions. Existing wallet connection/signing mocks, article HTML/YouTube rendering, and Arweave JSON adapter tests are used for compatibility. No real signing, transfer, publishing or permanent Arweave upload is authorized by this review.

Verified after rebasing onto design baseline `0173641`:

- Clean Bun 1.4.4 frozen-lockfile install (including the retained decoder patch): passed.
- Formatting, ESLint and TypeScript: passed.
- All retained tests (`bun run test:security`): 1 file, 23 audit CLI tests passed. The design branch's intentional removal of the broader application suite is preserved.
- Temporary compatibility harness using the integrated source and the previously existing tests: 7 files, 18 tests passed. Covers wallet connection/loading, article/highlight signing adapters, Arweave JSON adapter, read-only YouTube rendering and image captions. Test-only DOM tools were installed only in the temporary harness, not restored to the application manifest.
- Next.js 16.4.2 production build: passed, all 24 static pages generated. The sandboxed compile remained idle; retry with normal network/subprocess permissions completed successfully.
- Live registry gate: passed with 0 critical, 7 high, 5 moderate and 1 low records. The seven exact high exceptions expire 2026-11-06.
- Independent Standards and Spec reviews: grade A, no actionable findings.

No real transactions were signed and no permanent content was published. These are local results; they do not establish remote CI, deployment or branch-protection settings.
