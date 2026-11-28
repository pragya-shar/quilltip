/**
 * Decides which CI jobs a pull request can affect, from the files it changes
 * (docs/workflow/ci-pipeline.md).
 *
 *   bun scripts/ci/plan.ts --base <rev> [--head <rev>]   print the plan
 *   bun scripts/ci/plan.ts --full                        print the full plan
 *   bun scripts/ci/plan.ts --github ...                  also write job outputs
 *   bun scripts/ci/plan.ts --inputs                      print each suite's inputs
 *
 * Each job group has a set of inputs. A group runs when a changed file is one
 * of its inputs; the fixture shards' inputs come from the code itself: the
 * files each fixture server's `Bun.build` reads (`record-bundle.ts`), the
 * specs Playwright lists for the suite, and the files those specs import.
 * The plan fails closed: a file in `EVERYTHING` or any error runs
 * everything, and a suite whose inputs cannot be computed runs. A deleted
 * file that a remaining file still imports makes its suite's inputs
 * uncomputable, so that suite runs; deleted CSS imports and stand-in paths
 * a server names stay in the input sets.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SURFACE_SUITES } from '../../e2e/suites'
import { FIXTURES, SURFACES_GROUP, type Fixture } from '../fixture-suites'
import { SHARDS, type Shard } from './shards'

const root = path.resolve(import.meta.dirname, '../..')

/** A change to any of these runs every job and every shard. */
export const EVERYTHING = [
  'package.json',
  'bun.lock',
  'bunfig.toml',
  'tsconfig.json',
  '.github/workflows/ci.yml',
  'scripts/ci/**',
]

/**
 * Files outside the Next app and its checks. The app jobs (build, page-load
 * budget, font fallbacks, production build checks, local auth) are skipped
 * only when every changed file is one of these.
 */
export const OUTSIDE_APP = [
  'docs/**',
  '**/*.md',
  'LICENSE',
  'contracts/**',
  'scripts/contracts/**',
  'scripts/integration/**',
  '.github/workflows/pr-hygiene.yml',
  '.github/CODEOWNERS',
  'scripts/pr-hygiene/**',
]

/** Inputs of the Rust job: the workspace and the reproducible build. */
export const CONTRACTS = ['contracts/**', 'scripts/contracts/**']

/** Inputs of the local-network job, besides the files its scripts import. */
export const CONTRACTS_INTEGRATION = [
  'contracts/**',
  'scripts/contracts/**',
  'scripts/integration/**',
]

/** Inputs of every fixture suite, besides its own. */
export const FIXTURE_COMMON = [
  'scripts/run-fixture-e2e.ts',
  'scripts/fixture-suites.ts',
  'e2e/suites/index.ts',
  'e2e/suites/types.ts',
  'playwright.config.ts',
  'postcss.config.mjs',
  'tailwind.config.ts',
]

export type Change = { path: string; deleted: boolean }

export type Decision = { run: boolean; reason: string }

export type Plan = {
  app: Decision
  contracts: Decision
  contractsIntegration: Decision
  shards: { shard: Shard; decision: Decision; suites: string[] }[]
}

/**
 * A glob as a regular expression: `*` is any run of characters but `/`,
 * `**` any run of path segments (`a/**` also matches `a`, `**\/x` also `x`).
 */
export function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (glob.startsWith('/**', i) && i + 3 === glob.length) {
      out += '(?:/.*)?'
      i += 2
    } else if (glob.startsWith('**/', i)) {
      out += '(?:.*/)?'
      i += 2
    } else if (glob.startsWith('**', i)) {
      out += '.*'
      i += 1
    } else if (c === '*') {
      out += '[^/]*'
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

/** True when `file` (relative to the root) matches one of the globs. */
export function matches(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(file))
}

/** An input set: exact files and glob patterns, relative to the root. */
export type Inputs = { files: ReadonlySet<string>; patterns: readonly string[] }

function hit(changes: readonly Change[], inputs: Inputs): Change | undefined {
  return changes.find(
    (c) => inputs.files.has(c.path) || matches(c.path, inputs.patterns)
  )
}

const run = (reason: string): Decision => ({ run: true, reason })
const skip = (reason: string): Decision => ({ run: false, reason })

/**
 * The plan for a list of changes, given each suite's inputs (`undefined`
 * when they could not be computed). Pure, for the tests.
 */
export function decide(
  changes: readonly Change[],
  suiteInputs: ReadonlyMap<string, Inputs | undefined>,
  integrationFiles: ReadonlySet<string> | undefined,
  shards: readonly Shard[] = SHARDS,
  allSuites: readonly Fixture[] = FIXTURES
): Plan {
  const forced = changes.find((c) => matches(c.path, EVERYTHING))
  const why = (c: Change) => (c.deleted ? `${c.path} (deleted)` : c.path)

  const appChange = changes.find((c) => !matches(c.path, OUTSIDE_APP))
  const app = forced
    ? run(why(forced))
    : appChange
      ? run(why(appChange))
      : skip(changes.length === 0 ? 'no changed files' : 'no app file changed')

  const contractsHit = hit(changes, { files: new Set(), patterns: CONTRACTS })
  const contracts = forced
    ? run(why(forced))
    : contractsHit
      ? run(why(contractsHit))
      : skip('no contract file changed')

  const integrationHit = integrationFiles
    ? hit(changes, { files: integrationFiles, patterns: CONTRACTS_INTEGRATION })
    : undefined
  const contractsIntegration = forced
    ? run(why(forced))
    : !integrationFiles
      ? run('inputs unknown')
      : integrationHit
        ? run(why(integrationHit))
        : skip('no input changed')

  const planned = shards.map((shard) => {
    const names = shardSuiteNames(shard, allSuites)
    if (names.length === 0) {
      return { shard, decision: skip('no suites'), suites: [] }
    }
    if (forced) return { shard, decision: run(why(forced)), suites: names }
    const reasons: string[] = []
    const chosen = names.filter((name) => {
      const inputs = suiteInputs.get(name)
      if (!inputs) {
        reasons.push(`${name}: inputs unknown`)
        return true
      }
      const change = hit(changes, inputs)
      if (change) reasons.push(`${name}: ${why(change)}`)
      return change !== undefined
    })
    return chosen.length > 0
      ? { shard, decision: run(reasons.join('; ')), suites: chosen }
      : { shard, decision: skip('no input changed'), suites: [] }
  })

  return { app, contracts, contractsIntegration, shards: planned }
}

/** The suites a shard runs; `@surfaces` names every suite from e2e/suites/. */
export function shardSuiteNames(
  shard: Shard,
  allSuites: readonly Fixture[] = FIXTURES,
  surfaces: readonly Fixture[] = SURFACE_SUITES
): string[] {
  return shard.suites
    .split(',')
    .map((name) => name.trim())
    .flatMap((name) =>
      name === SURFACES_GROUP ? surfaces.map((s) => s.name) : [name]
    )
    .filter((name) => allSuites.some((s) => s.name === name))
}

/** The plan with every job and every shard on. */
export function fullPlan(reason: string): Plan {
  return {
    app: run(reason),
    contracts: run(reason),
    contractsIntegration: run(reason),
    shards: SHARDS.map((shard) => {
      const suites = shardSuiteNames(shard)
      return {
        shard,
        decision: suites.length > 0 ? run(reason) : skip('no suites'),
        suites,
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Input sets from the code.

const rel = (file: string) => path.relative(root, path.resolve(root, file))
const inRepo = (file: string) =>
  !rel(file).startsWith('..') && !file.includes('node_modules')

function exec(
  command: string,
  args: string[],
  env: Record<string, string> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

/** Repository files that `entrypoints` import, transitively (packages excluded). */
async function importClosure(entrypoints: string[]): Promise<Set<string>> {
  const result = await Bun.build({
    entrypoints: entrypoints.map((e) => path.resolve(root, e)),
    target: 'bun',
    packages: 'external',
    metafile: true,
    throw: false,
    plugins: [
      {
        // Site URLs in CSS (`/landing/fonts/...`) are not files.
        name: 'site-urls',
        setup(build) {
          build.onResolve({ filter: /^\// }, (args) =>
            existsSync(args.path)
              ? undefined
              : { path: args.path, external: true }
          )
        },
      },
    ],
  })
  if (!result.success || !result.metafile) {
    throw new AggregateError(
      result.logs,
      `Cannot read the imports of ${entrypoints.join(', ')}`
    )
  }
  return new Set(Object.keys(result.metafile.inputs).filter(inRepo).map(rel))
}

/** CSS files that `entries` pull in with relative `@import`s. */
export function cssClosure(
  entries: readonly string[] = ['app/globals.css']
): Set<string> {
  const seen = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    // A missing file still counts: a change may have deleted it.
    seen.add(file)
    if (!existsSync(path.join(root, file))) return
    const css = readFileSync(path.join(root, file), 'utf8')
    for (const m of css.matchAll(/@import\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      visit(rel(path.join(path.dirname(file), m[1]!)))
    }
  }
  for (const entry of entries) visit(entry)
  return seen
}

/**
 * Paths a fixture server names as string literals (stand-in modules from
 * other fixtures, `public`, font folders it reads at request time). Folders
 * become patterns. Deleted paths still count, as a literal names them.
 */
export function serverLiterals(server: string, source: string): string[] {
  const dir = path.dirname(server)
  const out = new Set<string>()
  for (const m of source.matchAll(/['"`]([\w@.-]+(?:\/[\w@.-]+)*)\/?['"`]/g)) {
    const literal = m[1]!
    const isFile = /\.(m?[jt]sx?|css|json)$/.test(literal)
    const relative = literal.startsWith('./') || literal.startsWith('../')
    // `public` and `app/...` are read from the root; `./x` and `x.ts` from
    // the server's folder, except CSS, which postcss reads from the root.
    const css = literal.endsWith('.css')
    const bases =
      literal === 'public'
        ? ['.']
        : css
          ? [dir, '.']
          : !literal.includes('/') || relative
            ? [dir]
            : [dir, '.']
    if (!literal.includes('/') && !isFile && literal !== 'public') continue
    for (const base of bases) {
      const candidate = rel(path.join(root, base, literal))
      if (candidate === '' || candidate.startsWith('..')) continue
      if (candidate.startsWith('node_modules')) continue
      const full = path.join(root, candidate)
      if (existsSync(full)) {
        out.add(statSync(full).isDirectory() ? `${candidate}/**` : candidate)
      } else if (isFile && literal.includes('/') && literal.length > 4) {
        // A stand-in module that a change deleted still counts.
        out.add(candidate)
      }
    }
  }
  return [...out].sort()
}

type PlaywrightList = {
  config: { rootDir: string; configFile?: string; globalSetup?: string | null }
  suites: { file: string }[]
}

async function suiteInputs(fixture: Fixture, scratch: string): Promise<Inputs> {
  const out = path.join(scratch, `${fixture.name}.json`)
  const recorded = await exec(
    process.execPath,
    [
      '--preload',
      path.join(root, 'scripts/ci/record-bundle.ts'),
      fixture.server,
    ],
    { PLAN_BUNDLE_OUT: out }
  )
  if (recorded.code !== 0 || !existsSync(out)) {
    throw new Error(
      `${fixture.server} did not reach Bun.serve: ${recorded.stderr.slice(-400)}`
    )
  }
  const bundle = JSON.parse(readFileSync(out, 'utf8')) as {
    builds: number
    inputs: string[]
  }
  if (bundle.builds === 0)
    throw new Error(`${fixture.server} built nothing before serving`)

  const listArgs = fixture.config
    ? [
        'x',
        'playwright',
        'test',
        '--list',
        '--reporter=json',
        '--config',
        fixture.config,
      ]
    : ['x', 'playwright', 'test', '--list', '--reporter=json', fixture.spec]
  const listed = await exec(process.execPath, listArgs, {
    ...fixture.env,
    QUILLTIP_E2E_FIXTURES: '1',
  })
  if (listed.code !== 0) {
    throw new Error(
      `Playwright cannot list ${fixture.name}: ${listed.stderr.slice(-400)}`
    )
  }
  const list = JSON.parse(listed.stdout) as PlaywrightList
  const specs = list.suites.map((s) => path.join(list.config.rootDir, s.file))
  if (specs.length === 0) throw new Error(`${fixture.name} lists no specs`)
  const configFile =
    list.config.configFile ?? path.join(root, 'playwright.config.ts')
  const entries = [...specs, configFile]
  if (list.config.globalSetup) entries.push(list.config.globalSetup)

  const source = readFileSync(path.join(root, fixture.server), 'utf8')
  const literals = serverLiterals(rel(fixture.server), source)
  const bundled = bundle.inputs.filter(inRepo).map(rel)
  const files = new Set<string>([
    ...bundled,
    ...(await importClosure(entries)),
    rel(fixture.server),
    ...cssClosure([
      'app/globals.css',
      ...literals.filter((l) => l.endsWith('.css')),
      ...bundled.filter((f) => f.endsWith('.css')),
    ]),
  ])
  const patterns = [
    ...FIXTURE_COMMON,
    `${path.dirname(rel(fixture.server))}/**`,
    ...literals,
    // A rebuilt surface's suite is defined in its package's file.
    ...(SURFACE_SUITES.some((s) => s.name === fixture.name)
      ? ['e2e/suites/**']
      : []),
  ]
  return { files, patterns }
}

/** Every suite's inputs; a suite whose inputs fail is `undefined` (it runs). */
export async function allSuiteInputs(
  suites: readonly Fixture[] = FIXTURES,
  log: (line: string) => void = console.error
): Promise<Map<string, Inputs | undefined>> {
  const scratch = mkdtempSync(path.join(tmpdir(), 'ci-plan-'))
  try {
    const entries = await Promise.all(
      suites.map(async (fixture) => {
        try {
          return [fixture.name, await suiteInputs(fixture, scratch)] as const
        } catch (error) {
          log(
            `${fixture.name}: ${error instanceof Error ? error.message : error}`
          )
          return [fixture.name, undefined] as const
        }
      })
    )
    return new Map(entries)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** The local-network job's scripts and everything they import. */
export async function integrationInputs(): Promise<Set<string>> {
  const glob = new Bun.Glob('scripts/integration/*.{ts,mts}')
  const entries = [...glob.scanSync({ cwd: root })]
  entries.push('scripts/contracts/bindings.ts')
  return importClosure(entries)
}

/**
 * Files changed between two revisions, with renames as delete plus add.
 * Without `head`, the working tree against `base`, untracked files included.
 */
export function changedFiles(base: string, head?: string): Change[] {
  const git = (args: string[]) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    if (r.status !== 0)
      throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
    return r.stdout.split('\0').filter(Boolean)
  }
  const parts = git([
    'diff',
    '--name-status',
    '--no-renames',
    '-z',
    base,
    ...(head ? [head] : []),
  ])
  const changes: Change[] = []
  for (let i = 0; i < parts.length; i += 2) {
    changes.push({ path: parts[i + 1]!, deleted: parts[i]!.startsWith('D') })
  }
  if (!head) {
    for (const file of git([
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ])) {
      changes.push({ path: file, deleted: false })
    }
  }
  return changes
}

// ---------------------------------------------------------------------------
// Output.

export function table(plan: Plan): string {
  const rows: [string, Decision][] = [
    ['App jobs', plan.app],
    ['Contracts', plan.contracts],
    ['Contracts (local network)', plan.contractsIntegration],
    ...plan.shards.map(
      (s) =>
        [`Playwright (fixtures, ${s.shard.shard})`, s.decision] as [
          string,
          Decision,
        ]
    ),
  ]
  const cell = (s: string) => s.replace(/\|/g, '\\|')
  return [
    '| Job | Runs | Because |',
    '| --- | --- | --- |',
    ...rows.map(
      ([name, d]) => `| ${name} | ${d.run ? 'yes' : 'no'} | ${cell(d.reason)} |`
    ),
  ].join('\n')
}

export function outputs(plan: Plan): Record<string, string> {
  return {
    app: String(plan.app.run),
    contracts: String(plan.contracts.run),
    contracts_integration: String(plan.contractsIntegration.run),
    fixtures: JSON.stringify(
      plan.shards
        .filter((s) => s.decision.run)
        .map((s) => ({ ...s.shard, suites: s.suites.join(',') }))
    ),
  }
}

async function main(argv: string[]): Promise<void> {
  const value = (flag: string) => {
    const at = argv.indexOf(flag)
    return at === -1 ? undefined : argv[at + 1]
  }
  if (argv.includes('--inputs')) {
    const suites = await allSuiteInputs()
    const integration = await integrationInputs()
    const dump = Object.fromEntries(
      [...suites].map(([name, inputs]) => [
        name,
        inputs && {
          files: [...inputs.files].sort(),
          patterns: inputs.patterns,
        },
      ])
    )
    console.log(
      JSON.stringify(
        { ...dump, 'contracts-integration': [...integration].sort() },
        null,
        1
      )
    )
    return
  }
  const base = value('--base')
  const head = value('--head') ?? 'HEAD'
  let plan: Plan
  let changes: Change[] = []
  try {
    if (argv.includes('--full') || !base) {
      plan = fullPlan(argv.includes('--full') ? 'full run' : 'no base revision')
    } else {
      changes = changedFiles(base, head)
      const [suites, integration] = await Promise.all([
        allSuiteInputs(),
        integrationInputs().catch((error) => {
          console.error(
            `local network inputs: ${error instanceof Error ? error.message : error}`
          )
          return undefined
        }),
      ])
      plan = decide(changes, suites, integration)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    plan = fullPlan('planning failed, so everything runs')
  }

  const text = `${table(plan)}\n\n${changes.length} changed files.`
  console.log(text)
  if (argv.includes('--github')) {
    const out = process.env.GITHUB_OUTPUT
    const summary = process.env.GITHUB_STEP_SUMMARY
    if (!out) throw new Error('GITHUB_OUTPUT is not set')
    const lines = Object.entries(outputs(plan)).map(([k, v]) => `${k}=${v}`)
    appendFileSync(out, `${lines.join('\n')}\n`)
    if (summary)
      appendFileSync(summary, `### What this change runs\n\n${text}\n`)
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
