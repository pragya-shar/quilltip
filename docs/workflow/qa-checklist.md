# Quilltip QA Checklist Policy

Use this policy for UI-heavy work, risky user workflows, demo blockers, wallet flows, publishing, tipping, NFT flows, Arweave behavior, auth changes, or any PR where manual QA matters.

## File

- Create the checklist in `docs/`.
- File name format: `docs/<issue-or-feature>-qa-checklist.md`.
- Make the checklist specific to the actual diff.
- Include changed flows and plausible regressions from touched areas.
- Do not commit the checklist unless the user asks or docs are part of the PR scope.

## Setup Details

Include:

- Branch
- Base branch
- Local URL
- Backend target, usually local Convex or the named Convex deployment
- Stellar network, usually TESTNET
- Contract IDs if wallet, tipping, batch, or NFT work is involved
- PR number, if known
- Date

## Row Status

Use these markers:

- `[ ]` not tested yet
- `[x]` passed
- `[-]` partial, blocked, intentionally skipped, or not applicable with a note
- `[!]` failed, with the failure note and linked fix or follow-up

## Row Content

Every QA row must include:

- Area
- Exact action to perform
- Expected result
- What to watch in the UI
- What to watch in browser console or network
- What to watch in the dev server terminal
- Final status marker and note

## Required Sections

1. Environment and setup
2. Automated verification
3. Primary changed workflows
4. Module or feature-specific workflows
5. Cross-feature regressions
6. Responsive checks
7. Auth, permissions, and public/internal boundary checks
8. Persistence, reload, caching, and session checks
9. Error, empty, loading, and disabled states
10. Wallet, Stellar, Convex, Arweave, or contract checks when touched
11. Cleanup and uncommitted artifact checks

## Execution

- Run the app locally with the correct backend environment.
- Use gstack `/browse` for browser QA and local web browsing when available.
- Use Playwright only for existing repo e2e tests or explicit automated checks.
- Test checklist rows one by one. Do not batch-mark rows.
- Keep the browser console and network panel visible or otherwise inspected.
- Keep the `bun run dev` terminal visible.
- Watch for React errors, failed requests, hydration warnings, Convex errors, wallet errors, and unexpected network calls.
- Update each row immediately after testing it.

## Quilltip-Specific Checks

- For publishing, remember Arweave can be permanent. Do not publish throwaway content unless the user explicitly approves the risk.
- For testnet tipping, verify the UI never presents testnet activity as real-money production traction.
- For article tips, highlight tips, and batch tips, watch both the wallet approval path and the Convex record state.
- For contract work, test pause behavior, fee math, storage updates, minimum tip checks, and verification paths that changed.
- For private evidence, screenshots, or local measurement files, keep them out of git unless explicitly requested.

## Failure Handling

- Use `[!]` for failed rows.
- Add a concrete note explaining what failed.
- Investigate and fix failures before final verification unless the user explicitly says not to.
- Use `[-]` only for partial, blocked, risky, or intentionally deferred checks.
- Explain what blocked full verification.

## Commit Scope

- Commit the QA checklist only if requested or if docs are part of the PR scope.
- Do not commit Playwright screenshots, browser screenshots, videos, downloaded files, `.env*`, `.stellar`, or local evidence files.
