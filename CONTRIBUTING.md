# Contributing to Quilltip

Fork and clone the repository, then follow [setup](docs/SETUP.md).

1. Start a focused feature branch from the latest `origin/main`.
2. Follow [AGENTS.md](AGENTS.md) for project constraints and relevant references.
   Both human contributors and coding agents use these conventions.
3. Run `bun run check` for code/tooling changes. For docs-only changes, run
   `bun run format:check` and `git diff --check`. Add relevant behavioral checks
   from the [QA guide](docs/workflow/qa-checklist.md).
4. Write the product name as **Quilltip** (one capital letter, also at the start
   of a sentence and in headings). `bun run check` runs `bun run brand:check`;
   run `bun run brand:apply` to fix a failure.
5. Commit with a Conventional Commit subject, such as `fix: restore draft focus`.
6. Open a PR into `main` using the [template](.github/pull_request_template.md).
   Explain the behavior changed, verification results, and remaining risks.

See [workflow](docs/workflow/repo-workflow.md) for branch/merge conventions and CI,
[component organization](docs/component-organization.md) for React conventions,
and [architecture](docs/ARCHITECTURE.md) for service boundaries.

For bugs, include reproduction steps, expected/actual behavior, and relevant
browser or environment details. Report vulnerabilities privately through
[SECURITY.md](SECURITY.md).

Contributions are licensed under the repository's [MIT license](LICENSE).
