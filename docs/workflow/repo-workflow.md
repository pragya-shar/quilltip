# Development workflow

[AGENTS.md](../../AGENTS.md) holds the shared project instructions for Codex,
Claude Code, and contributors. `CLAUDE.md` imports it instead of maintaining a
second copy. This document covers collaboration and delivery; read the other
guides only for the task they cover.

## Work loop

1. State the outcome, constraints, and how success will be checked. Inspect the
   relevant code and existing patterns. Plan multi-file or uncertain work before
   implementing; a small, well-defined edit needs no separate planning artifact.
2. Make a focused change, then run the smallest useful check while iterating.
   For UI changes, inspect the real page, console/network, and backend behavior
   using the [QA guide](qa-checklist.md).
3. Review the final diff for correctness and regressions. Fix in-scope findings;
   report any unresolved findings with severity and file/flow references. Re-review
   affected behavior after fixes; if repeated reviews keep failing, reconsider
   the approach rather than starting another unbounded cleanup cycle.
4. Run the final verification appropriate to the diff. Report completed checks
   and limits, then commit/push when requested. PR, merge, and deployment actions
   each need authorization within the task.

Keep durable project constraints in `AGENTS.md`, task-specific reference in the
linked docs, and temporary evidence in the chat or ignored local files. Promote
recurring lessons into the smallest relevant rule or automated check. Existing
Husky hooks, ESLint, commitlint, and CI enforce deterministic rules; avoid repeating
their configuration as prose or adding another hook to run the same checks.

## Branches and pull requests

- Base work on `origin/main`; use Linear's suggested branch name when applicable,
  otherwise a short descriptive name. For a new branch:

  ```bash
  git fetch origin
  git switch -c codex/task-name origin/main
  ```

- Preserve others' local changes and shared commit history. Refresh a shared
  feature branch by merging `origin/main`; merge PRs with a regular merge commit.
- Before a PR, fetch and review `git log origin/main..HEAD` and
  `git diff origin/main...HEAD`. Confirm the diff contains only intended work.
- Use Conventional Commit subjects; allowed types/scopes are enforced by
  `commitlint.config.js` and `.github/workflows/pr-hygiene.yml`.
- Use the [PR template](../../.github/pull_request_template.md). Include concise
  results, not raw logs, full diffs, or private evidence.
- Before merging, require `Required` and `PR Hygiene Required` to pass and confirm
  GitHub reports the PR as mergeable. Inspect Vercel checks when present.
- Release bookkeeping and dependency updates are manual. Add release/changelog
  or dependency PR automation only when requested.

## Verification and CI

`bun run check` runs formatting, lint, component-rule fixtures, typecheck, audit
CLI tests, and the production build. Docs-only edits need formatting and
`git diff --check`; run the full check if scripts or executable config changed.

For affected browser behavior, run the relevant existing Playwright spec against
an explicitly selected running app; see [setup](../SETUP.md). For Rust changes,
run the affected contract check:

```bash
cargo check --locked --target wasm32v1-none --manifest-path contracts/tipping/Cargo.toml
cargo check --locked --target wasm32v1-none --manifest-path contracts/article-nft/Cargo.toml
```

[CI](../../.github/workflows/ci.yml) runs on pushes to `main` and PRs into `main`.
`Required` aggregates quality, build, and dependency audit. The audit is a required
job; its severity/exception rules are defined in the
[audit policy](../../security/dependency-review.md). PR hygiene runs on PRs.
Local success does not establish remote CI or deployment success.

## Using Codex and Claude Code

- Give the agent an outcome and evidence: a route, error, reproduction, expected
  behavior, and constraints. Example: "Fix draft recovery after reload on `/write`;
  preserve publishing and show the restored draft in the signed-in browser."
- Codex loads `AGENTS.md`. Claude Code loads the same text through `@AGENTS.md` in
  `CLAUDE.md`, including versions/settings without native AGENTS support. Use
  Claude's `/context` to inspect loaded instructions.
- Use a fresh chat for unrelated work. For a long task, retain a short handoff:
  objective, branch, decisions, checks, and next step. Keep private session notes
  and machine-specific permissions out of tracked project instructions.
- Use skills for repeatable specialist work. Add a repository skill only after
  repeated use demonstrates a need; give it a precise trigger and load detailed
  references on demand.
- When parallel work is authorized, assign independent scopes and explicit
  ownership. Separate editing agents into worktrees; concurrent readers can share
  a checkout. Give review work a correctness question and verification criteria.

Research and source-to-repo decisions: [agent workflow sources](agent-workflow-sources.md).
