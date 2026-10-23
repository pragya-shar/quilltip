# Demo restoration QA — 2026-10-22

## Environment and setup

- Branch: design-revamp-quilltip. Base: development. No PR or push.
- App: http://127.0.0.1:3000, verified PID 75602 cwd /Users/pragyasharma/quilltip.
- Reference: saved onboarding-flow dist/client, http://127.0.0.1:4197.
- Backend unchanged; demos do not invoke payment, publication, or draft mutations.

## Automated verification

- [x] Format, typecheck and lint passed. Full suite: 191 files, 1096 tests passed.
- [x] Production build passed with network access after the sandbox run stalled.
- [x] Writer's three focused tests passed again after correcting explicit Resume while the control retains focus.

## Primary changed workflows

- [x] Hero CTA bindings point to public reader/writer demos. Navigation still links directly to Articles and Writing desk. Route tests pass.
- [x] Scroll home at 1440x1000: paper progress .625 to 1 and computed transform changes from tilted/scaled matrix to upright/full scale. No console errors observed.

## Module-specific workflows

- [x] Reader desktop: select exact fragment “words we read”, preview 2 test XLM; quote remains exact and receipt explicitly says no payment made. Browser console clear.
- [x] Reader mobile: select sentence, appreciate; sheet displays exact passage. Escape closes and restores sentence focus. Browser console clear.
- [x] Writer: Preview and Back to draft change sample view; keyboard End/Home/arrow keys select tabs. Unit tests confirm no editable draft or publication.

## Cross-feature regressions

- [x] Existing app suite passes, including auth, editor, article, wallet and backend tests.
- [-] No real publication or transaction performed; no claim of end-to-end payment verification.

## Responsive checks

- [x] Reader and writer at 390x844: no horizontal overflow. Reader receipt sheet fits viewport; writer flow stacks with readable controls.

## Auth and public/internal boundary

- [x] Demo exits link to /articles and /write. The existing /write auth gate is unchanged. Demos are public and sample-only.
- [-] Authenticated manual writing persistence not retested; production editor unchanged.

## Persistence, reload and caching

- [x] Reader demo copy states highlights stay in the demo; no transfer into unrelated real stories promised.
- [x] Writer sample creates no draft storage. Existing drafts/recovery untouched.

## Error, empty, loading and disabled states

- [x] Reader kept-passage button disabled until a passage exists.
- [x] Writer focus pauses automatic stepping. Stable accessible sample prose is available alongside visual typewriter output.
- [x] Reduced motion hook and static writer behavior covered by unit tests.
- [-] Live reduced-motion emulation unavailable in installed gstack binary (unknown cdp command); not claimed visually checked.

## Wallet, Stellar, Convex and Arweave

- [-] Unchanged. Reader tip is explicitly simulated; no wallet connection or network transaction.

## Cleanup and artifacts

- [x] Existing two QA notes preserved. Screenshots in /tmp; Account concepts under ~/.gstack, outside git. Account remains visual exploration only.
- [x] No commits, PRs or pushes made.
