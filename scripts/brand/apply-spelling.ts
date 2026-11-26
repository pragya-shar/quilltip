/**
 * Rewrites the old product-name spellings to "Quilltip" across the
 * repository, except where `scripts/brand/allowlist.json` keeps them.
 *
 *   bun run brand:apply          rewrite, and print every change
 *   bun run brand:check          fail on any old spelling not in the allowlist
 *   bun scripts/brand/apply-spelling.ts --kept
 *                                also print every kept occurrence by class
 *
 * It reads the files Git tracks plus new files Git does not ignore, and skips
 * binary files. Running it twice changes nothing the second time.
 */

import { execFileSync } from 'child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import {
  applySpelling,
  isPathExcluded,
  looksBinary,
  pathMatches,
  validateAllowlist,
  type AllowEntry,
  type Occurrence,
} from './spelling'

export const DEFAULT_ALLOWLIST = 'scripts/brand/allowlist.json'

export const CHECK_FAILURE_HINT =
  'The product name is written "Quilltip". Run `bun run brand:apply` to fix ' +
  'these. If the text is stored or signed data, or belongs to code owned ' +
  `elsewhere, add an entry with a reason to ${DEFAULT_ALLOWLIST} instead.`

export type RunOptions = {
  root: string
  allowlistPath?: string
  check: boolean
  showKept?: boolean
  log?: (line: string) => void
}

export type RunResult = {
  changed: Occurrence[]
  kept: Occurrence[]
  files: string[]
  /** Entries with a match that kept nothing (not an error: branches differ). */
  unused: AllowEntry[]
  ok: boolean
}

export function listFiles(root: string): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  const seen = new Set<string>()
  for (const path of out.split('\0')) {
    if (!path || seen.has(path)) continue
    const full = join(root, path)
    if (!existsSync(full) || !statSync(full).isFile()) continue
    seen.add(path)
  }
  return [...seen].sort()
}

export function loadAllowlist(root: string, path = DEFAULT_ALLOWLIST) {
  return validateAllowlist(JSON.parse(readFileSync(join(root, path), 'utf8')))
}

function where(o: Occurrence) {
  return `${o.path}:${o.line}:${o.column}`
}

export function run(options: RunOptions): RunResult {
  const log = options.log ?? ((line: string) => console.log(line))
  const root = resolve(options.root)
  const allowlist = loadAllowlist(root, options.allowlistPath)
  const changed: Occurrence[] = []
  const kept: Occurrence[] = []
  const files: string[] = []

  const allowlistFile = options.allowlistPath ?? DEFAULT_ALLOWLIST
  for (const path of listFiles(root)) {
    // The allowlist names the old spellings on purpose; never rewrite it.
    if (path === allowlistFile) continue
    if (isPathExcluded(path, allowlist)) continue
    const full = join(root, path)
    const bytes = readFileSync(full)
    if (looksBinary(bytes)) continue
    const before = bytes.toString('utf8')
    const result = applySpelling(path, before, allowlist)
    kept.push(...result.kept)
    if (result.changed.length === 0) continue
    changed.push(...result.changed)
    files.push(path)
    if (!options.check) writeFileSync(full, result.text)
  }

  const usedMatches = new Set(kept.map((o) => o.keptBy))
  const unused = allowlist.filter(
    (e) => e.match !== undefined && !usedMatches.has(e)
  )

  if (options.check) {
    if (changed.length > 0) {
      log(`Old spelling of the product name (${changed.length}):`)
      for (const o of changed) log(`  ${where(o)}  ${o.from}  ${o.text.trim()}`)
      log('')
      log(CHECK_FAILURE_HINT)
    } else {
      log(`Brand spelling: no old spellings outside the allowlist.`)
    }
  } else {
    for (const o of changed) log(`${where(o)}  ${o.from} -> ${o.to}`)
    log(
      `Changed ${changed.length} occurrence(s) in ${files.length} file(s); ` +
        `${kept.length} kept by the allowlist.`
    )
  }

  if (options.showKept) {
    for (const cls of ['B', 'C', 'D', 'tool'] as const) {
      const ofClass = kept.filter((o) => o.keptBy?.class === cls)
      if (ofClass.length === 0) continue
      log(`Kept, class ${cls} (${ofClass.length}):`)
      for (const o of ofClass) log(`  ${where(o)}  ${o.text.trim()}`)
    }
    const excluded = listFiles(root).filter((p) => isPathExcluded(p, allowlist))
    for (const entry of allowlist.filter((e) => e.match === undefined)) {
      const paths = excluded.filter((p) => pathMatches(entry, p))
      log(
        `Excluded, class ${entry.class}: ${entry.path} (${paths.length} file(s))`
      )
    }
  }
  for (const entry of unused)
    log(`Note: allowlist entry "${entry.match}" kept nothing on this branch.`)

  return {
    changed,
    kept,
    files,
    unused,
    ok: !options.check || changed.length === 0,
  }
}

if (import.meta.main) {
  const args = new Set(process.argv.slice(2))
  const result = run({
    root: process.cwd(),
    check: args.has('--check'),
    showKept: args.has('--kept'),
  })
  if (!result.ok) process.exit(1)
}
