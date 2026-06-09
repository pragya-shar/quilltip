# ENG-246 / PR #199 Evidence

## Scope

- PR: `#199`
- Branch: `eng-246/simplify-writer-canvas`
- Base: `development`
- Verified code head before adding evidence docs: `fa5beddcd68c9d690e2762f16a61cdb86693b432`
- Review worktree: `/private/tmp/quilltip-pr199`
- Evidence date: `2026-06-09`

## Branch Freshness

- Fetched latest `origin/development`, which advanced to `f3d10cb` from ENG-245 / PR #198.
- Merged `origin/development` into `eng-246/simplify-writer-canvas` cleanly.
- Pushed updated branch to GitHub.
- `git rev-list --left-right --count origin/development...HEAD`: `0 2`
- `git rev-list --left-right --count origin/eng-246/simplify-writer-canvas...HEAD`: `0 0`
- GitHub PR head after push: `fa5beddcd68c9d690e2762f16a61cdb86693b432`

## Diff Scope

Changed files from `origin/development...HEAD`:

- `app/globals.css`
- `components/editor/EditorActionBar.test.tsx`
- `components/editor/EditorActionBar.tsx`
- `components/editor/EditorBubbleToolbar.tsx`
- `components/editor/EditorFloatingInsert.tsx`
- `components/editor/WriteEditorWorkspace.tsx`

Scope classification: clean. The diff is limited to the `/write` editor surface, related editor controls, editor placeholder CSS, and focused tests.

## Code Review Notes

- Publish safety remains server-enforced through existing Convex title and listing-ready guards.
- The PR changes when users see excerpt/tags requirements, not whether invalid articles can publish.
- No wallet, Stellar, tipping, NFT, contract, or Arweave persistence implementation files are changed by the ENG-246 diff.
- The branch now includes latest `development`, including ENG-245 article-reader work, but the PR contribution remains editor-scoped under the three-dot diff.
- Review grade so far: A, no unresolved code findings from the local diff review.

## Automated Verification Log

- `bun run test:once -- components/editor/EditorActionBar.test.tsx`
  - Result: passed
  - Evidence: 1 test file, 14 tests passed
- `bun run test:once -- convex/lib/articleListingReady.test.ts convex/lib/articleTitle.test.ts convex/articles.publishListingReady.test.ts convex/articles.publishTitle.test.ts`
  - Result: passed
  - Evidence: 4 test files, 27 tests passed
- `git diff --check origin/development...HEAD`
  - Result: passed, no whitespace errors
- `bun run format:check`
  - Result: passed after formatting the QA checklist
- `bun run typecheck`
  - Result: passed
- `bun run lint`
  - Result: passed
- `bun run test:once`
  - Result: passed
  - Evidence: 110 test files, 613 tests passed
  - Note: existing warning/log noise from Stellar config, Radix dialog descriptions, mocked login/upload failures, and reconcile/tip tests; no test failures
- `bun run build`
  - First run with symlinked `node_modules`: failed because Turbopack rejects a symlink that points outside the worktree root
  - Second run after real locked install: failed because sandboxed network blocked Google font fetches
  - Third run with network and public Convex URL placeholder: passed
  - Verified command: `NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud bun run build`

## GitHub Checks After Sync Push

After pushing `fa5bedd`, GitHub reported:

- `Build`: pass
- `Commit subjects`: pass
- `Dependency Audit`: pass
- `Lint, Typecheck & Test`: pass
- `PR Hygiene Required`: pass
- `PR title`: pass
- `Required`: pass
- `Vercel`: pass
- `Vercel Preview Comments`: pass
- Merge state: `CLEAN`

## Manual Preview Smoke Test

Latest preview URL after sync push:

`https://quilltip-git-eng-246-si-574efe-pragya-sharmas-projects-a6320130.vercel.app`

Smoke list is maintained in `docs/eng-246-qa-checklist.md`.

gstack unauthenticated smoke result:

- Command: `browse goto <preview-url>` via gstack browse
- Result: preview root returned `401`
- Network evidence: root `GET` returned `401`, Vercel SSO redirect returned `307`, Vercel login page returned `200`
- Console evidence: one expected failed-resource error for the protected preview root
- Security note: no cookies were imported, no authenticated browser session was used, and no app secrets were exposed

Status: app-level `/write` smoke is manual-only unless the user explicitly authorizes an authenticated preview browser session.

## PR Body Follow-Up

The PR body now follows `.github/pull_request_template.md` with `Summary`, `Changes`, `Testing`, and `Notes`.
