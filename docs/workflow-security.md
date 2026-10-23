# GitHub Actions maintenance

Every external `uses:` reference must use a full 40-character commit SHA with the
release version in a trailing comment. Resolve releases from the action's upstream
repository, review the release notes and changes, and verify the commit and action
inputs before updating a pin. Do not substitute a major or release tag for a SHA.

The initial pins retain the existing major versions. Release notes, verified
upstream commits, and action manifests were checked on 2026-10-23:

| Action                             | Release                                                                           | Commit                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `actions/checkout`                 | [v4.4.0](https://github.com/actions/checkout/releases/tag/v4.4.0)                 | [11d5960a326750d5838078e36cf38b85af677262](https://github.com/actions/checkout/commit/11d5960a326750d5838078e36cf38b85af677262)                 |
| `oven-sh/setup-bun`                | [v2.2.0](https://github.com/oven-sh/setup-bun/releases/tag/v2.2.0)                | [0c5077e51419868618aeaa5fe8019c62421857d6](https://github.com/oven-sh/setup-bun/commit/0c5077e51419868618aeaa5fe8019c62421857d6)                |
| `googleapis/release-please-action` | [v4.4.1](https://github.com/googleapis/release-please-action/releases/tag/v4.4.1) | [5c625bfb5d1ff62eadeeb3772007f7f66fdcf071](https://github.com/googleapis/release-please-action/commit/5c625bfb5d1ff62eadeeb3772007f7f66fdcf071) |

## Updates and permissions

Dependabot checks action updates weekly and opens `ci:` PRs against `main`.
Keep its configuration on the default branch (`main`), where GitHub reads it. Review upstream
changes and keep the full SHA and version comment together when merging updates;
do not automatically merge action updates.

Workflow token permissions default to none. Only checkout jobs receive
`contents: read`; checkout does not persist credentials for subsequent commands.
The release job alone receives `contents: write` and `pull-requests: write` to
create releases and release PRs. Its trigger remains a push to `main`.

## Ownership and review

`.github/CODEOWNERS` assigns workflows, Dependabot configuration, and CODEOWNERS
itself to the existing maintainers: `@pragya-shar` (admin) and `@0xbhvn` (write),
whose repository access was verified on 2026-10-23. GitHub uses the CODEOWNERS file
on the PR's base branch, so this ownership must reach `main`.
Existing ownership for audit policy, dependency files, and patches remains assigned
to the repository owner.

CODEOWNERS requests reviews; it does not by itself require approval before merge.
The branch protections on `main` require the `Required`
and `PR Hygiene Required` status checks, but do not require code-owner approval
(verified 2026-10-23). Repository settings are managed separately from these files.
To enforce approval, enable **Require review from Code Owners** on `main`
after this ownership file lands. Keep at least two code owners with write
access so one can approve the other's PR: GitHub does not let authors approve
their own PRs. The retired `development` branch is no longer part of the review path.

## Safe validation

Run `actionlint .github/workflows/*.yml` and the normal format, lint, typecheck,
and build checks. Inspect the release action's inputs at the pinned commit and
confirm that release write permissions remain scoped to its job. Do not dispatch
the release action, push to `main`, or create a production release for validation.

References: [Dependabot configuration](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file),
[CODEOWNERS and required reviews](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).
