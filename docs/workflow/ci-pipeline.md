# How CI decides what to run

[CI](../../.github/workflows/ci.yml) runs every job on pushes to `main` and the
overhaul branches. On a pull request, a first job, **What changed**
([scripts/ci/plan.ts](../../scripts/ci/plan.ts)), reads the files that the
pull request's merge commit changes against its base (`HEAD^1..HEAD`) and turns
on only the jobs those files can affect. Its job summary lists each job, whether
it runs, and the changed file that made it run.

## The job groups

| Group                                                                       | Runs on a pull request when a changed file is                                                                   |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Lint & Typecheck, Dependency Audit                                          | always                                                                                                          |
| Production build checks, Page-load Budget, Font Fallbacks, local auth       | any file that is not in `OUTSIDE_APP` (docs, Markdown, contracts, contract and integration scripts, PR hygiene) |
| Contracts                                                                   | under `contracts/` or `scripts/contracts/`                                                                      |
| Contracts (local network)                                                   | under `contracts/`, `scripts/contracts/` or `scripts/integration/`, or a file those scripts import              |
| Playwright (fixtures, _shard_), one job per shard in `scripts/ci/shards.ts` | an input of one of the shard's suites; the job runs only those suites                                           |

A change to `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`,
`.github/workflows/ci.yml` or `scripts/ci/`, or to a path under a top-level
entry that the base does not have, runs everything.

A change to a shared input runs every fixture shard, whatever its bundle
reads. The shared inputs (`SHARED` and `SHARED_ENTRIES`) are the files that
change what every fixture suite sees but sit in no suite's bundle:
`proxy.ts` and everything it imports, the routing registries
(`lib/routing/redirects/`, `lib/routing/segments/`: a redirect or a reserved
segment moves another suite's paths), `next.config.ts` and its imports, the
CSP module, the TypeScript and Playwright configs, and the fixture runner
with the suite registry (`scripts/fixture-suites.ts`, `e2e/suites/`). The
shell, the layouts and the generated API types are not on the list: a suite
that renders them has them in its bundle.

## A fixture suite's inputs

The inputs come from the code, computed on every run:

- the files the suite's server bundles: `scripts/ci/record-bundle.ts` runs the
  server up to `Bun.serve` and records what each `Bun.build` call read,
  including the stand-in modules its plugins substitute;
- the specs `playwright test --list` finds for the suite, its config and global
  setup, and every repository file they import;
- the server's own folder, and the paths it names as strings (stand-in modules
  in other fixture folders, `public/`, font folders it reads at request time);
- the CSS that `app/globals.css` and the server's own CSS pull in with
  `@import`;
- the runner and registry files every suite shares (`FIXTURE_COMMON`), and for
  a rebuilt surface's suite, its package file in `e2e/suites/`.

## Failing closed

- What changed writes the full plan first, before it installs anything, and
  replaces it with the filtered plan only when planning succeeds within five
  minutes. A planning error or timeout leaves the full plan.
- When What changed itself fails, every job still runs (the fixture suites in
  one job), and Required fails.
- What changed must pass, or Required fails.
- A job may be skipped only when What changed planned it off. A skipped job
  that was planned on fails Required, as does any failed or cancelled job.
- If planning throws, every job runs. If one suite's inputs cannot be computed
  (its server or specs do not build, Playwright cannot list it), that suite
  runs. A deleted file that a remaining file still imports makes the importer's
  bundle fail, so its suite runs.
- Pushes to `main` and the overhaul branches run everything, so a merge that
  the filter judged wrongly shows on the branch's own run.

## A full run on a pull request

- **Re-run all jobs** on the run's page: from attempt 2 on, What changed plans
  everything. **Re-run failed jobs** keeps the first plan.
- The `ci-full` label: every later push to the pull request runs everything,
  until the label is removed. Adding the label starts no run by itself.

Recommended practice: use a full run before merging a pull request that
changes `proxy.ts`, a routing registry, or the shell's sheet and focus code,
and one whose filtered runs passed while a job it skipped failed on the base
branch's push run.

## What the filter does not see

- Tailwind scans the whole repository for class names, so a class added in an
  unrelated file adds a CSS rule to every fixture page. The rule only matters
  for an element that carries that class, and such an element's file is an
  input. A class name built at run time from parts is the exception.
- A server that builds more code after it starts serving is not recorded. No
  server does so today.

## Run the same steps locally

`bun scripts/ci/local.ts` reads the steps from `ci.yml` and runs the jobs that
the checkout's changes (commits and uncommitted files, against the merge base
with `origin/overhaul/v3`) turn on, then prints a table of every step. It makes
each production build once and runs every check that reads that build after
it. `--all` runs everything; `--jobs` (ids, or `app`), `--shards` and
`--light` (lint, typecheck, unit tests, audit: no build, no browser) choose;
`--list` prints the steps without running them. Steps run with `CI=1`, so
each Playwright config uses its CI worker count (one or two), and
`--workers` caps the unit-test workers (default 1). It leaves out runner setup:
actions, "Install ..." steps, `bun install` and failure-only steps; no CI step
reads a secret. The script's header lists what the machine needs for the
result to mean what CI's does. On a shared machine, run `--light` under the
machine's lock for medium jobs and anything else under its lock for heavy
jobs.

## Failure output

A failed Playwright job writes each failed test's name, location and error into
its job summary (`scripts/ci/failure-summary.ts`) and uploads `test-results/`
(traces of retried tests, page snapshots) as an artifact for three days.
