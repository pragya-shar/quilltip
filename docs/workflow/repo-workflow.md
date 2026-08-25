# Quilltip Repo Workflow Policy

This policy applies to Quilltip repo work. It should be read with:

- `docs/workflow/qa-checklist.md`
- `docs/workflow/linear-issue-policy.md`
- `.github/pull_request_template.md`
- `.github/workflows/ci.yml`
- `.github/workflows/pr-hygiene.yml`

## Project Context

- Quilltip is a decentralized publishing app for writers and readers.
- Writers receive 97.5% of each tip. Quilltip keeps 2.5%.
- Current payment work is on Stellar testnet unless a task explicitly says mainnet.
- Published article storage can involve Arweave permanence. Do not recommend throwaway publish and unpublish tests without checking the exact path first.
- Be honest in grant, GTM, and project wording. Do not present testnet activity as production traction, production volume, NAV, or mainnet revenue.

## Branches

- Default base branch: `development`.
- Use `main` only when the task explicitly says the target is `main`.
- Work in a feature branch unless the user explicitly asks for direct work on the current branch.
- For Linear issues, prefer the Linear suggested branch name.
- For non-Linear work, use a short branch name such as `codex/<task-slug>`.
- Before starting, check `git status --short --branch` and confirm the branch is clean enough for the task.
- Before opening a PR, compare the branch against `origin/development` and make sure the diff only contains intended work.

## Merge Direction Policy

Choose the merge method from the branch direction, not from whichever GitHub button is currently available.

| From                  | Into          | Required method  | Reason                                                                  |
| --------------------- | ------------- | ---------------- | ----------------------------------------------------------------------- |
| Feature branch        | `development` | Regular merge    | Preserve the feature commits and their original identities.             |
| `development`         | `main`        | Regular merge    | Preserve the complete development history on `main`.                    |
| Release Please branch | `main`        | Rebase and merge | Land the single generated release commit without an extra branch merge. |
| `main`                | `development` | Regular merge    | Reconnect release commits and metadata to ongoing development.          |

- Do not squash `development` into `main`.
- Do not rebase or force-push the shared `development` branch.
- `main` intentionally allows merge commits. Do not enable required linear history while this policy is active.
- Keep force pushes and branch deletion disabled for `main` and `development`.
- If a different merge method appears necessary, stop and explain the history impact before proceeding.

### Development To Main Preflight

Before opening a `development` to `main` PR:

1. Run `git fetch origin --prune`.
2. Confirm the worktree is clean with `git status --short --branch`.
3. Run `git merge-base --is-ancestor origin/main origin/development`. If it fails, sync current `main` back into `development` before continuing.
4. Review `git log --oneline origin/main..origin/development` for the exact commits being promoted.
5. Review `git diff --stat origin/main...origin/development` and the full diff for unintended files.
6. Confirm the PR base is `main`, the head is `development`, and the PR body follows the repository template.
7. Require `Required` and `PR Hygiene Required` to pass. Review Vercel when GitHub reports a deployment check.
8. Confirm GitHub reports the PR as mergeable and select a regular merge commit.

After Release Please updates `main`, create the sync branch from current `development`, merge current `main` into it, and open a PR back to `development`. Verify that the PR contains only release metadata and other intentional `main`-only changes.

## Agent And Tooling

- Use existing repo patterns before introducing new tools or abstractions.
- Use Bun scripts from `package.json` for app checks.
- Use Convex CLI when backend schema or generated Convex API types need updating.
- Use Cargo for Soroban contract checks under `contracts/`.
- Use Context7 for current library, SDK, API, CLI, framework, or cloud documentation when needed.
- Use Firecrawl only when external search, research, or source gathering is needed.
- Use gstack `/browse` for browser QA and local web browsing when available. Do not use `mcp__claude-in-chrome__*`.
- Use Playwright for existing repo e2e tests or explicit automated browser checks, not as a substitute for required manual QA when a checklist calls for visual behavior.
- Use sub-agents only when the user asks for parallel agent work or the active environment explicitly allows it. Give them repo context, branch context, task scope, and the exact output needed.
- If a requested tool is unavailable, say so clearly and use the safest available fallback.

## Scope Rules

- Keep scope tight to the requested issue, feature, review, or PR.
- Do not include unrelated refactors, cleanup, formatting churn, generated files, screenshots, or files you did not work on.
- Do not commit `.env*`, `.stellar`, contract build artifacts, browser screenshots, private evidence docs, or local QA artifacts unless the user explicitly asks.
- Do not weaken Stellar transaction verification, tip accounting, pause guards, fee math, storage keys, auth boundaries, or Arweave behavior unless that is the stated task.
- If generated Convex files change because the task requires codegen, include them with the related source change and explain why.

## Review And Fix Policy

- Run a critical review before calling work done.
- Grade A through F. A means no unresolved findings.
- Review for bugs, regressions, security, auth boundaries, Stellar trust boundaries, Convex data rules, Arweave permanence, dead code, edge cases, and library correctness.
- Present findings with grade, severity, file or flow reference, required fix, and residual risk.
- Fix every valid in-scope finding, including low-priority findings.
- If a finding cannot be fixed safely in scope, explain why and list it as follow-up risk.
- After fixes, rerun targeted tests before the final verification gate.

## QA

- Follow `docs/workflow/qa-checklist.md` for UI-heavy, risky, demo-blocker, auth, wallet, publishing, tipping, NFT, Arweave, or workflow changes.
- Make QA specific to the real diff and likely regressions.
- For manual QA, watch the page, browser console/network, and dev server output.
- Investigate failures before final verification unless the user explicitly says not to.
- Commit a QA checklist only if the user asks or docs are part of the PR scope.

## Verification

Do not claim completion unless verification outputs were checked.

Standard app gate:

1. `bun run format:check`
2. `bun run typecheck`
3. `bun run lint`
4. `bun run test:once`
5. `bun run build`

Contract gates when touched:

- `cargo test --manifest-path contracts/tipping/Cargo.toml`
- `cargo test --manifest-path contracts/article-nft/Cargo.toml`

Use focused tests first while developing. Run the standard gate before PR or final handoff unless the user explicitly narrows verification.

If `bun run build` fails because network access blocks external font or package fetching, report it as an environment issue only after confirming the error text.

## CI

GitHub Actions run on pull requests and pushes to `development` and `main`.

Protected merge gates:

- `Required`
- `PR Hygiene Required`

Additional signals:

- Review the Vercel deployment check when GitHub reports one for the PR.
- Review `Dependency Audit` findings. The audit remains advisory while its workflow is configured not to fail the job.

Report warnings separately from failures. Do not hide a failed check behind a broad "CI is flaky" explanation without evidence.

## Commits And PRs

- Commit in small groups ordered by dependency.
- Use `type: short description` commit subjects and PR titles.
- Allowed types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
- Keep commit messages lean. No emoji. No em dashes.
- Push with GitHub CLI or git after checks pass.
- Open PRs with GitHub CLI and use `.github/pull_request_template.md`.
- Keep PR bodies plain and limited to summary, changes, testing, and notes.
- Do not paste diffs, full file contents, generated code, or codegen output into PR bodies.
- Follow the merge direction policy above. In particular, preserve `development` history by using a regular merge into `main`.
- After merge, delete merged local and remote feature branches when appropriate.
