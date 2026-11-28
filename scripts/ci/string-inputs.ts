/**
 * Inputs that code names as strings, which no bundler follows:
 * `import.meta.glob` patterns, vitest `setupFiles`, Playwright
 * `globalSetup`, and files or folders read with `node:fs` (file-set checks,
 * route trees, fixtures read at request time).
 *
 * `scripts/ci/plan.ts` scans every file in a job's computed inputs for these
 * constructs (`STRING_CONSTRUCTS`). A file that has one must match an entry
 * here; the entry's `to` globs become inputs of every job whose inputs hold
 * that file. A file with a construct and no entry makes its job's inputs
 * unknown, so the job runs, and `scripts/ci/string-inputs.test.ts` fails.
 */

export type StringInput = {
  /** Glob of the files that name the inputs. */
  from: string
  /** What they read, as globs; empty when the read is covered otherwise. */
  to: readonly string[]
  /** Why, in a few words. */
  why: string
}

/** Constructs that name an input as a string. */
export const STRING_CONSTRUCTS =
  /import\.meta\.glob\(|\bsetupFiles\s*:|\bglobalSetup\s*:|\b(?:readdirSync|readFileSync|readFile|existsSync|statSync|opendirSync|opendir|createReadStream)\(/

export const STRING_INPUTS: readonly StringInput[] = [
  // Fixture suites.
  {
    from: 'e2e/fixtures/*/server.mjs',
    to: [],
    why: 'public/ and font folders read at request time: serverLiterals adds the folders a server names',
  },
  {
    from: 'playwright.config.ts',
    to: [],
    why: 'globalSetup: Playwright --list reports it, so it is in the import closure',
  },
  {
    from: 'e2e/**/*.config.ts',
    to: [],
    why: 'globalSetup: Playwright --list reports it, so it is in the import closure',
  },
  {
    from: 'e2e/wallet-{connect,coverage}.spec.ts',
    to: [],
    why: 'axe-core from node_modules: a package, covered by bun.lock',
  },
  {
    from: 'lib/routing/signInPath.ts',
    to: ['app/(app)/**/signin/page.*'],
    why: 'the sign-in link depends on whether a sign-in page exists',
  },
  {
    from: 'lib/routing/legacyRouteTree.ts',
    to: ['app/(legacy)/**/page.*', 'app/(legacy)/**/route.*'],
    why: 'the legacy route tree is the pages and routes under app/(legacy)',
  },
  {
    from: 'lib/routing/legacyWriterPage.ts',
    to: ['app/(legacy)/[username]/page.tsx'],
    why: 'whether the legacy writer page exists',
  },
  // Contracts (local network).
  {
    from: 'scripts/integration/*.test.ts',
    to: ['convex/**'],
    why: "import.meta.glob('../../convex/**/*.ts'): Convex functions loaded by path",
  },
  {
    from: 'scripts/integration/*.config.mts',
    to: ['scripts/lib/edge-runtime-uint8array.ts'],
    why: 'vitest setupFiles',
  },
  {
    from: 'scripts/integration/{harness,summary}.ts',
    to: [],
    why: 'reads built Wasm and the run output in RUNNER_TEMP, not repository files',
  },
  {
    from: 'scripts/contracts/bindings.ts',
    to: ['lib/stellar/v2/bindings/**'],
    why: 'the bindings check compares the committed files, by listing the folder',
  },
]

/** The entries that cover a file, or `undefined` when none does. */
export function entriesFor(
  file: string,
  matches: (file: string, patterns: readonly string[]) => boolean,
  entries: readonly StringInput[] = STRING_INPUTS
): StringInput[] | undefined {
  const found = entries.filter((e) => matches(file, [e.from]))
  return found.length > 0 ? found : undefined
}
