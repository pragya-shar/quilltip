# QuillTip agent guide

QuillTip is a Next.js App Router publishing app with Convex Auth/backend,
Stellar/Soroban tipping, and optional permanent Arweave storage. Use Bun;
`package.json` and `bun.lock` define scripts and dependency versions.

## Working agreements

- Check the current branch and working tree first. Preserve existing local work
  and use the current checkout unless the user requests isolation.
- Use `main` as the base and PR target; `development` is retired. Default to a
  feature branch. Direct commits to `main` need an explicit user request.
- Plan significant or ambiguous changes before editing. For a clear, small task,
  proceed directly. Keep the change limited to the requested outcome.
- Use available skills when relevant to the user's request. Choose tools available
  in the active environment; no particular plugin is required by this repo.
- Create or change PRs, merge, deploy, or send messages only when authorized.
  A request to push does not authorize those other actions. Preserve shared Git
  history with regular merges; do not force-push `main`.

## QuillTip invariants

- Preserve auth/ownership boundaries and transaction verification, tip accounting,
  pause guards, fee math, and storage keys. Writers receive 97.5%; the platform 2.5%.
- Payment development uses Stellar testnet unless mainnet is explicitly in scope.
  Describe testnet activity as testnet activity in UI, docs, and external claims.
- Arweave uploads may be permanent. Check the configured path before publishing
  test content; get approval for an irreversible upload.
- Never commit secrets, wallet keys, `.env.local`, `.stellar`, build output, or
  private QA evidence. `.env.example` contains placeholders only.
- Published content is called **articles**; article links say **Read more**.

## Verification

- Docs-only changes: `bun run format:check` and `git diff --check`.
- Application/tooling changes: `bun run check`, plus tests for the changed behavior.
  Available tooling tests and Playwright suites are listed in `package.json` and
  `e2e/`; there is no general application unit-test suite.
- Inspect the actual result of each check. For UI work, verify the real route and
  relevant authenticated state. Confirm the serving checkout before trusting it.
- Report local checks, remote CI, deployment, and merge status separately, with
  any unverified or blocked behavior stated explicitly.

## Read when relevant

- Setup, server startup, environment: [setup](docs/SETUP.md).
- Service boundaries or data flow: [architecture](docs/ARCHITECTURE.md).
- Branches, commits, PRs, CI, or working with agents: [workflow](docs/workflow/repo-workflow.md).
- UI, auth, payments, publishing, or persistence changes: [QA](docs/workflow/qa-checklist.md).
- React components: [component organization](docs/component-organization.md).
- Linear issue work: [issue conventions](docs/workflow/linear-issue-policy.md).
- Deployments: [deployment](docs/DEPLOYMENT.md). GitHub Actions or ownership changes:
  [workflow security](docs/workflow-security.md).
