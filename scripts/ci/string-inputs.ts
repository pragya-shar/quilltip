/**
 * Inputs that code names as strings, which no bundler follows:
 * `import.meta.glob` patterns, vitest `setupFiles`, Playwright
 * `globalSetup`, files and folders read with `node:fs` or Bun's file API,
 * URLs built from `import.meta.url`, template `import()`s, and child
 * processes (`STRING_CONSTRUCTS`).
 *
 * `scripts/ci/plan.ts` scans every code file in a job's computed inputs. A
 * file with an entry here gets the entry's globs as inputs of every job whose
 * inputs hold the file, whether or not the scan finds a construct; this is
 * how a read the constructs miss is listed by hand. Each entry states how
 * many constructs its file has. A file whose count differs from its entry,
 * or that has constructs and no entry, makes its job's inputs unknown, so
 * the job runs, and `scripts/ci/string-inputs.test.ts` fails until the entry
 * is brought up to date.
 */

export type StringInput = {
  /**
   * The file that names the inputs, or a glob for files of one standard
   * shape (every fixture server, every Playwright config).
   */
  from: string
  /**
   * How many `STRING_CONSTRUCTS` matches the file has; for a glob, each
   * matching file that has any.
   */
  constructs: number
  /** What it reads by content, as globs. */
  to?: readonly string[]
  /**
   * What it reads by name only (which files exist), as globs: a file added
   * or deleted there counts, an edit to one does not.
   */
  paths?: readonly string[]
  /** Why, in a few words. */
  why: string
}

/**
 * Constructs that name an input as a string. Generic names such as
 * `stat(`, `access(` and `exec(` are left out: they match too much else.
 */
export const STRING_CONSTRUCTS =
  /import\.meta\.glob\(|\bsetupFiles\s*:|\bglobalSetup\s*:|\b(?:readdirSync|readdir|readFileSync|readFile|existsSync|statSync|lstatSync|lstat|accessSync|opendirSync|opendir|createReadStream|globSync|spawnSync|spawn|execSync|execFileSync)\(|\bBun\.(?:file|Glob)\b|\bnew URL\([^)]*import\.meta\.url|\bimport\(\s*`/g

/** How many constructs a source has. */
export function constructCount(source: string): number {
  return [...source.matchAll(STRING_CONSTRUCTS)].length
}

const SERVER =
  'public/ and font folders read at request time: serverLiterals adds the folders a server names'
const GLOBAL_SETUP =
  'globalSetup: Playwright --list reports it, so it is in the import closure'
const AXE = 'axe-core from node_modules: a package, covered by bun.lock'
const CONVEX_GLOB =
  "import.meta.glob('../../convex/**/*.ts'): Convex functions loaded by path"
const SETUP_FILE = 'vitest setupFiles'

export const STRING_INPUTS: readonly StringInput[] = [
  // Fixture suites.
  { from: 'e2e/fixtures/*/server.mjs', constructs: 1, why: SERVER },
  { from: 'playwright.config.ts', constructs: 1, why: GLOBAL_SETUP },
  { from: 'e2e/**/*.config.ts', constructs: 1, why: GLOBAL_SETUP },
  {
    from: 'scripts/run-fixture-e2e.ts',
    constructs: 2,
    why: 'starts each suite server and Playwright, both inputs already',
  },
  { from: 'e2e/wallet-connect.spec.ts', constructs: 1, why: AXE },
  { from: 'e2e/wallet-coverage.spec.ts', constructs: 1, why: AXE },
  {
    from: 'lib/routing/signInPath.ts',
    constructs: 1,
    paths: ['app/(app)/**/signin/page.*'],
    why: 'the sign-in link depends on whether a sign-in page exists',
  },
  {
    from: 'lib/routing/legacyRouteTree.ts',
    constructs: 4,
    paths: ['app/(legacy)/**/page.*', 'app/(legacy)/**/route.*'],
    why: 'the legacy route tree is which pages and routes exist under app/(legacy)',
  },
  {
    from: 'lib/routing/legacyWriterPage.ts',
    constructs: 1,
    paths: ['app/(legacy)/[username]/page.tsx'],
    why: 'whether the legacy writer page exists',
  },
  // Contracts (local network).
  ...[
    'scripts/integration/nft-v2-client.test.ts',
    'scripts/integration/nft-v2.test.ts',
    'scripts/integration/tab-settlement.test.ts',
    'scripts/integration/tab-ui-flow.test.ts',
    'scripts/integration/tips-v2.test.ts',
  ].map((from) => ({
    from,
    constructs: 1,
    to: ['convex/**'],
    why: CONVEX_GLOB,
  })),
  ...[
    'scripts/integration/settlement.config.mts',
    'scripts/integration/tab-ui.config.mts',
  ].map((from) => ({
    from,
    constructs: 1,
    to: ['scripts/lib/edge-runtime-uint8array.ts'],
    why: SETUP_FILE,
  })),
  {
    from: 'scripts/integration/run.ts',
    constructs: 2,
    why: 'runs Docker and the vitest configs in scripts/integration/, inputs already',
  },
  {
    from: 'scripts/lib/stellar-cli.ts',
    constructs: 1,
    why: 'runs the Stellar CLI, a binary the job installs',
  },
  {
    from: 'scripts/integration/harness.ts',
    constructs: 1,
    why: 'reads the built Wasm in RUNNER_TEMP, not a repository file',
  },
  {
    from: 'scripts/integration/summary.ts',
    constructs: 1,
    why: 'reads the run output in RUNNER_TEMP, not a repository file',
  },
  {
    from: 'scripts/contracts/bindings.ts',
    constructs: 7,
    to: ['lib/stellar/v2/bindings/**'],
    why: 'the bindings check compares the committed files, by listing the folder',
  },
]

/**
 * The entry for a file: the one naming it exactly, else a glob entry when
 * the file has constructs (a glob covers only files that read something).
 */
export function entryFor(
  file: string,
  count: number,
  matches: (file: string, patterns: readonly string[]) => boolean,
  entries: readonly StringInput[] = STRING_INPUTS
): StringInput | undefined {
  const exact = entries.find((e) => e.from === file)
  if (exact) return exact
  if (count === 0) return undefined
  return entries.find((e) => /[*{]/.test(e.from) && matches(file, [e.from]))
}
