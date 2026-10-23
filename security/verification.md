# Security fixes verification — 2026-10-23

Issues: #237 upload ownership, #238 Next/Sharp, #240 dependencies/required audit, #239 pinned Actions. Changes remain uncommitted on `design-revamp-quilltip` in the original checkout. HEAD is still `a5e2953265abea67921f682b3285769af967fbf0`. Preexisting Wallet, landing and account work is preserved.

## Verified

- Full suite: **200 files, 1,158 tests passed** after the final audit-parser fix.
- ESLint, TypeScript, Prettier and production build pass. Prettier remains at 3.8.1 to avoid unrelated formatting changes; local `.superpowers` scratch is excluded.
- Frozen lockfile install with Bun 1.4.4 passes. Local global Bun was not changed; use `npm exec --yes --package=bun@1.4.4 -- bun install --frozen-lockfile` if needed.
- Mandatory audit gate passes with **13 individually reviewed records across seven packages**, expiring **November 6, 2026**. See [dependency review](dependency-review.md) and [exceptions](audit-exceptions.json). This is not a zero-vulnerability result.
- Gate tests cover invalid JSON/schema, command errors/status inconsistency, low-severity findings, exact exception matching, invalid/expired/stale/duplicate exceptions and package spoofing. All 22 pass.
- URI decoder CPU regression timed out before the patch and passes after it. CommonJS/query-string behavior passes. Independent reviewer compared 2,744 inputs against the fixed upstream algorithm.
- All eight Action uses are immutable commit pins resolved from official upstream repositories. Required aggregation rejects failed, skipped, cancelled and missing audit results. Dependabot targets development; CODEOWNERS covers workflow/security changes.
- Convex deployment validation succeeded against **development upbeat-mockingbird-579**, including schema and new ownership/ticket indexes. Production was not deployed.
- Development HTTP upload round-trip: unauthenticated ticket issuance denied; real PNG stored/read; replay rejected; cross-account metadata and deletion denied; owner metadata/deletion succeeded; spoofed PNG rejected. Only the newly created disposable image was deleted.
- Actual signed-in Wallet verified in the user's existing regular Chrome tab: Stellar testnet connected, saved receiving address distinct from connected address, All/Received/Sent counts 32/4/29, self-tip handled correctly, real receipt displayed. No signing, transfer, disconnect or address modification.

The suite emitted the existing jsdom navigation/negative timer warnings and a Vite future-config warning; no test failures. Browser transport progress/cancellation have automated coverage but were not manually exercised in the live browser upload UI.

## Independent review

One fresh read-only review found no Critical or Important issues. One Minor remains: intentional legacy-image/stale-client errors currently use ordinary `Error`, so Convex production redaction may hide refresh/re-upload instructions. A follow-up can use `ConvexError`.

## Decisions and limits

- Keep the existing dirty checkout and uncommitted work; no publish/merge operations.
- Legacy images remain readable; unverified legacy storage IDs cannot authorize metadata/attachment/deletion, so affected owners must re-upload.
- Pin Bun 1.4.4 and apply scoped same-major overrides; retain wallet-kit APIs. Risk: dependency behavior still requires ongoing compatibility checks.
- Retain the established formatter; defer unrelated formatting churn.
- Accept only the documented current-use exceptions until November 6. New affected API use requires reassessment; latent transitive code is not proven safe.
- Storage cleanup compensates for ownership-record failure, but interruption/lost-response orphan reconciliation is not guaranteed. Risk: unused storage accumulation.
- Image ingress checks allowlisted MIME, byte count and signatures, not full decoding or decompression limits. Malformed images may fail later in patched Next/Sharp processing.
- Existing public URL image embedding is preserved; it confers no ownership or deletion authority.
- The user requested existing regular Chrome after gstack's automation connection failed; live verification used that authenticated tab directly and left it open.

Remote CI, required-check/code-owner enforcement in GitHub settings, production rollout and deployed-version verification remain separate work. Issues were not closed or modified. No commit, push, PR, merge or production deploy occurred.
