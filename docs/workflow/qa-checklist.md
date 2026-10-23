# Behavioral QA

Use for changed UI, auth, wallet/tipping, publishing, NFT, storage, or persistence
behavior. Choose checks from the actual diff and likely regressions; documentation
edits do not require a browser checklist.

## Record

Keep a short checklist in the chat or an ignored local file. Commit a
`docs/<feature>-qa-checklist.md` only when requested or when the checklist itself
is a deliverable. Existing feature QA/evidence documents are historical results,
not proof that the current checkout passes.

Record the branch/commit, date, app URL and serving checkout, auth state, Convex
target, and Stellar network/contract IDs when relevant. Never record credentials.

| Status | Action / precondition | Expected result | Observed result / evidence |
| ------ | --------------------- | --------------- | -------------------------- |
| `[ ]`  | Exact reproduction    | Visible outcome | Not tested                 |

Use `[x]` for observed passes, `[!]` for failures, and `[-]` for partial, skipped,
or blocked checks with a reason. Update rows after observing the result.

## Execute

- Start or reuse the correct app/backend using [setup](../SETUP.md). Inspect the
  page, browser console/network, and server output. Use the available browser tool;
  Playwright tests complement visual/manual checks.
- Cover the changed happy path and relevant failure/loading/empty states.
  For responsive UI, include narrow and desktop widths, keyboard/focus behavior,
  and reduced motion when animation changes.
- For auth/data changes, check signed-out, owner, and non-owner behavior as
  relevant; verify reload/session persistence and backend results.
- For tips, verify wallet approval/rejection and matching Convex transaction state.
  Check changed verification, accounting, pause/minimum guards, and fee behavior.
- For publishing/storage, confirm the environment and Arweave permanence risk
  before creating content. Follow the invariants in [AGENTS.md](../../AGENTS.md).
- Run relevant existing checks/specs. Mark unavailable coverage as blocked;
  investigate failures and distinguish app errors from extension/tool noise.
- Finish with the result, unresolved risks, and artifact cleanup. Keep raw
  screenshots, traces, wallet material, and private evidence out of Git.
