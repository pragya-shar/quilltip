# GitHub Actions maintenance

- Pin every external `uses:` reference to a full 40-character commit SHA with a
  release-version comment. Verify the release, upstream changes, commit, and
  inputs in the action's own repository when updating a pin.
- Update pins manually. Keep workflow permissions empty by default and grant
  minimum job-level access. Checkout jobs use `contents: read` and
  `persist-credentials: false`.
- [.github/CODEOWNERS](../.github/CODEOWNERS) defines review ownership for workflows,
  security policy, dependency files, and patches. GitHub uses the base branch's
  file; code-owner review requests alone do not enforce approval.
- Branch protection is managed separately in GitHub settings. Before changing or
  relying on it, inspect the current settings; retain required checks and prevent
  force pushes/deletion on `main`. Require code-owner approval only when the owner
  requests that settings change, with enough eligible reviewers to avoid deadlock.
- Validate changed workflows with `actionlint .github/workflows/*.yml` and run
  `bun run check`. Inspect trigger, permission, fork/secret exposure, and required
  job aggregation changes in the diff.

The workflow YAML and CODEOWNERS are authoritative for current pins and owners;
GitHub settings are authoritative for live protection. See
[GitHub's CODEOWNERS documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).
