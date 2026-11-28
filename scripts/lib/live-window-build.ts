/**
 * The code a window run pushes, built from the approved commit itself
 * (docs/operations/payments-v2-cutover.md, "Live window approval").
 *
 * The operator's checkout is not pushed. For each run the tool:
 *
 * 1. Exports the approved commit into a new private folder by object id
 *    (`git cat-file --batch`, raw objects: no filters, no attributes, no
 *    replace refs). It hashes the commit, every tree and every file itself and
 *    refuses any object whose bytes do not match its id, so a tampered or
 *    substituted object, an index flag, a working-tree file or a git binary
 *    that lies cannot change what is exported.
 * 2. Hashes the exported folder again from disk and refuses it unless it is
 *    exactly the commit's tree.
 * 3. Installs the dependencies there with `bun install --frozen-lockfile
 *    --ignore-scripts`, with the Bun version the commit pins, in a clean
 *    environment: no lifecycle script runs, and no `.npmrc`, `bunfig.toml`,
 *    `BUN_*` or `npm_config_*` setting of the operator applies.
 * 4. Runs the Convex CLI from that folder with system Node, by absolute path,
 *    in an environment that holds only `CONVEX_DEPLOY_KEY` and what the CLI
 *    needs to start. Nothing of the operator's environment (`NODE_OPTIONS`,
 *    `ESBUILD_BINARY_PATH`, proxies, certificates, `CONVEX_*`) reaches it.
 *
 * git and node are taken from fixed system folders, never from PATH: under
 * `bun run`, PATH starts with the checkout's `node_modules/.bin`.
 */
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { NetworkGuardError } from '../../convex/lib/networkGuard'

/** Folders searched for git and node, in order. Never the caller's PATH. */
export const SYSTEM_BIN_DIRS: readonly string[] = [
  '/usr/bin',
  '/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
]

/** Oldest Node major the Convex CLI supports (`convex` package engines). */
export const MIN_NODE_MAJOR = 20

/** Where window builds and their package cache live. */
export function liveWindowBuildRoot(home = os.homedir()): string {
  return path.join(home, '.quilltip', 'live-window', 'builds')
}

function buildError(message: string): NetworkGuardError {
  return new NetworkGuardError('live window build', [
    { code: 'LIVE_WINDOW_BUILD', message },
  ])
}

/** The first executable regular file `name` in `dirs`, resolved; or null. */
export function systemBinary(
  name: string,
  dirs: readonly string[] = SYSTEM_BIN_DIRS
): string | null {
  for (const dir of dirs) {
    const candidate = path.join(dir, name)
    try {
      const real = fs.realpathSync(candidate)
      const stat = fs.statSync(real)
      if (stat.isFile() && (stat.mode & 0o111) !== 0) return real
    } catch {
      // Not there.
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Git objects, read raw and checked by their ids
// ---------------------------------------------------------------------------

/** The id git gives an object: SHA-1 of "<type> <size>\0" and the body. */
export function gitObjectId(
  type: 'blob' | 'tree' | 'commit',
  body: Buffer
): string {
  return createHash('sha1')
    .update(`${type} ${body.length}\0`)
    .update(body)
    .digest('hex')
}

export type GitObject = { type: string; body: Buffer }

/** Reads raw objects by id. Results are untrusted until hashed. */
export type ObjectReader = (ids: readonly string[]) => Map<string, GitObject>

/** Environment for git: no variable of the caller, no global config. */
function gitEnv(home: string): Record<string, string> {
  return {
    PATH: SYSTEM_BIN_DIRS.join(':'),
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    // A partial clone must not fetch missing objects during a window run.
    GIT_NO_LAZY_FETCH: '1',
  }
}

/**
 * `git cat-file --batch` on `repoRoot`, with system git, without replace
 * objects, and without the caller's environment.
 */
export function gitObjectReader(
  repoRoot: string,
  options: { git?: string | null; home?: string } = {}
): ObjectReader {
  const git = options.git === undefined ? systemBinary('git') : options.git
  if (!git) {
    throw buildError(
      `git is not in ${SYSTEM_BIN_DIRS.join(', ')}. Install it there; the window does not use PATH.`
    )
  }
  const home = options.home ?? os.tmpdir()
  return (ids) => {
    const result = spawnSync(
      git,
      [
        '--no-replace-objects',
        '-c',
        'core.fsmonitor=false',
        '-C',
        repoRoot,
        'cat-file',
        '--batch',
      ],
      {
        input: `${ids.join('\n')}\n`,
        env: gitEnv(home) as NodeJS.ProcessEnv,
        maxBuffer: 1024 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'ignore'],
      }
    )
    if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
      throw buildError('git cannot read the approved commit from the checkout.')
    }
    return parseBatch(result.stdout)
  }
}

/** Parses `git cat-file --batch` output. Missing objects are left out. */
export function parseBatch(out: Buffer): Map<string, GitObject> {
  const objects = new Map<string, GitObject>()
  let at = 0
  while (at < out.length) {
    const newline = out.indexOf(0x0a, at)
    if (newline < 0) throw buildError('git returned a malformed object list.')
    const header = out.subarray(at, newline).toString('utf8')
    at = newline + 1
    const parts = header.split(' ')
    if (parts[1] === 'missing') continue
    const [id, type, sizeText] = parts
    const size = Number(sizeText)
    if (!id || !type || !Number.isSafeInteger(size) || size < 0) {
      throw buildError('git returned a malformed object header.')
    }
    if (at + size + 1 > out.length) {
      throw buildError('git returned a truncated object.')
    }
    objects.set(id, { type, body: Buffer.from(out.subarray(at, at + size)) })
    at += size + 1
  }
  return objects
}

/** Reads one object and checks its type and its id against its bytes. */
function verified(
  objects: Map<string, GitObject>,
  id: string,
  type: 'blob' | 'tree' | 'commit'
): Buffer {
  const object = objects.get(id)
  if (!object) throw buildError(`The ${type} ${id} is not in the checkout.`)
  if (object.type !== type || gitObjectId(type, object.body) !== id) {
    throw buildError(
      `The ${type} ${id} in the checkout does not match its id. The repository's objects were changed; use a fresh clone.`
    )
  }
  return object.body
}

export type TreeEntry = { mode: string; name: string; id: string }

/** Parses a raw tree body: "<mode> <name>\0<20-byte id>" repeated. */
export function parseTree(body: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = []
  let at = 0
  while (at < body.length) {
    const space = body.indexOf(0x20, at)
    const nul = body.indexOf(0x00, space + 1)
    if (space < 0 || nul < 0 || nul + 21 > body.length) {
      throw buildError('A tree object is malformed.')
    }
    entries.push({
      mode: body.subarray(at, space).toString('ascii'),
      name: body.subarray(space + 1, nul).toString('utf8'),
      id: body.subarray(nul + 1, nul + 21).toString('hex'),
    })
    at = nul + 21
  }
  return entries
}

// Code points file systems ignore in names (HFS+ and APFS lookups).
const IGNORABLE = /[​-‏‪-‮⁠-⁤⁪-⁯﻿]/g

/** The name a case-insensitive, normalising file system compares. */
function foldName(name: string): string {
  return name.normalize('NFC').replace(IGNORABLE, '').toLowerCase()
}

function nameRefusal(name: string): string | null {
  if (name === '' || name === '.' || name === '..' || name.includes('/')) {
    return 'an invalid name'
  }
  if (name.includes('\0') || name.includes('\\')) return 'an invalid name'
  if (foldName(name) === '.git') return 'a .git entry'
  return null
}

export type ExportResult = {
  commit: string
  tree: string
  files: number
  bytes: number
}

/**
 * Writes the approved commit's tree into `dest` (which must be empty), from
 * objects whose ids are checked against their bytes. Only regular files and
 * folders: a symbolic link, a submodule or an unknown mode is refused, as is
 * a tree whose names collide on a case-insensitive or normalising file system.
 */
export function exportCommit(
  read: ObjectReader,
  commit: string,
  dest: string
): ExportResult {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw buildError('The approved commit is not a full SHA-1.')
  }
  const commitBody = verified(read([commit]), commit, 'commit')
  const treeLine = /^tree ([0-9a-f]{40})\n/.exec(commitBody.toString('utf8'))
  if (!treeLine) throw buildError('The approved commit has no tree.')
  const rootTree = treeLine[1] as string

  type Dir = { id: string; rel: string }
  const files: { rel: string; id: string; mode: string }[] = []
  let level: Dir[] = [{ id: rootTree, rel: '' }]
  while (level.length > 0) {
    const objects = read([...new Set(level.map((d) => d.id))])
    const next: Dir[] = []
    for (const dir of level) {
      const entries = parseTree(verified(objects, dir.id, 'tree'))
      const seen = new Set<string>()
      for (const entry of entries) {
        const rel = dir.rel ? `${dir.rel}/${entry.name}` : entry.name
        const bad = nameRefusal(entry.name)
        if (bad) throw buildError(`The commit holds ${bad}: ${rel}.`)
        const folded = foldName(entry.name)
        if (seen.has(folded)) {
          throw buildError(
            `The commit holds names that collide on this file system: ${rel}.`
          )
        }
        seen.add(folded)
        if (entry.mode === '40000') next.push({ id: entry.id, rel })
        else if (entry.mode === '100644' || entry.mode === '100755') {
          files.push({ rel, id: entry.id, mode: entry.mode })
        } else {
          throw buildError(
            `The commit holds ${entry.mode === '120000' ? 'a symbolic link' : entry.mode === '160000' ? 'a submodule' : `mode ${entry.mode}`} at ${rel}; the window exports regular files only.`
          )
        }
      }
    }
    level = next
  }

  for (const name of ['.env', '.env.local']) {
    if (files.some((f) => f.rel === name)) {
      throw buildError(
        `The commit holds ${name}, which the Convex CLI would load. Remove it from the release.`
      )
    }
  }

  const blobs = read([...new Set(files.map((f) => f.id))])
  let bytes = 0
  for (const file of files) {
    const body = verified(blobs, file.id, 'blob')
    const target = path.join(dest, ...file.rel.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
    fs.writeFileSync(target, body, {
      flag: 'wx',
      mode: file.mode === '100755' ? 0o755 : 0o644,
    })
    bytes += body.length
  }

  // Hash the folder from disk: it must be exactly the commit's tree.
  const onDisk = folderTreeId(dest)
  if (onDisk !== rootTree) {
    throw buildError(
      `The exported folder does not match the approved commit's tree (${onDisk ?? 'unreadable'}, expected ${rootTree}).`
    )
  }
  return { commit, tree: rootTree, files: files.length, bytes }
}

/**
 * The git tree id of a folder, from the bytes on disk: regular files and
 * folders only (a link or any other entry returns null). Names in `skip` are
 * left out at the top level. Empty folders are left out, as in git.
 */
export function folderTreeId(
  dir: string,
  skip: readonly string[] = []
): string | null {
  const entries: { name: string; mode: string; id: string }[] = []
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  for (const name of names) {
    if (skip.includes(name)) continue
    const full = path.join(dir, name)
    const stat = fs.lstatSync(full)
    if (stat.isDirectory()) {
      const id = folderTreeId(full)
      if (id === null) return null
      if (id === EMPTY_TREE) continue
      entries.push({ name, mode: '40000', id })
    } else if (stat.isFile()) {
      entries.push({
        name,
        mode: (stat.mode & 0o100) !== 0 ? '100755' : '100644',
        id: gitObjectId('blob', fs.readFileSync(full)),
      })
    } else {
      return null
    }
  }
  // Git orders entries by name, with a folder compared as "name/".
  const key = (e: { name: string; mode: string }) =>
    Buffer.from(e.mode === '40000' ? `${e.name}/` : e.name, 'utf8')
  entries.sort((a, b) => Buffer.compare(key(a), key(b)))
  const body = Buffer.concat(
    entries.flatMap((e) => [
      Buffer.from(`${e.mode} ${e.name}\0`, 'utf8'),
      Buffer.from(e.id, 'hex'),
    ])
  )
  return gitObjectId('tree', body)
}

const EMPTY_TREE = gitObjectId('tree', Buffer.alloc(0))

// ---------------------------------------------------------------------------
// Runtimes and environments
// ---------------------------------------------------------------------------

/** The Bun version the commit pins (`packageManager: bun@x.y.z`). */
export function pinnedBunVersion(packageJson: string): string | null {
  try {
    const value = (JSON.parse(packageJson) as { packageManager?: unknown })
      .packageManager
    const match =
      typeof value === 'string' ? /^bun@(\d+\.\d+\.\d+)$/.exec(value) : null
    return match ? (match[1] as string) : null
  } catch {
    return null
  }
}

/** The environment for `bun install` in the build folder. */
export function installEnv(
  bun: string,
  paths: { home: string; tmp: string; cache: string }
): Record<string, string> {
  return {
    PATH: [path.dirname(bun), '/usr/bin', '/bin'].join(':'),
    HOME: paths.home,
    TMPDIR: paths.tmp,
    BUN_INSTALL_CACHE_DIR: paths.cache,
    NO_COLOR: '1',
  }
}

/**
 * The environment for the Convex CLI: the deploy key and what Node needs.
 * HOME is the build's own folder, so no stored Convex login applies.
 */
export function cliEnv(
  node: string,
  deployKey: string,
  paths: { home: string; tmp: string },
  term?: string
): Record<string, string> {
  return {
    PATH: [path.dirname(node), '/usr/bin', '/bin'].join(':'),
    HOME: paths.home,
    TMPDIR: paths.tmp,
    CONVEX_DEPLOY_KEY: deployKey,
    ...(term && /^[A-Za-z0-9_.+-]{1,64}$/.test(term) ? { TERM: term } : {}),
  }
}

function nodeMajor(node: string, env: Record<string, string>): number | null {
  const result = spawnSync(node, ['--version'], {
    env: env as NodeJS.ProcessEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const match = /^v(\d+)\./.exec(result.stdout ?? '')
  return result.status === 0 && match ? Number(match[1]) : null
}

// ---------------------------------------------------------------------------
// One window build
// ---------------------------------------------------------------------------

export type WindowBuild = {
  /** The exported commit, with node_modules installed. */
  dir: string
  tree: string
  node: string
  bun: string
  bunVersion: string
  /** The Convex CLI command for `convexArgs`, run from `dir`. */
  command: (convexArgs: readonly string[]) => {
    file: string
    args: string[]
    cwd: string
    env: Record<string, string>
  }
  cleanup: () => void
}

export type BuildOptions = {
  commit: string
  /** Repository that holds the approved commit's objects. */
  repoRoot: string
  deployKey: string
  /** The running Bun: `process.execPath` and `process.versions.bun`. */
  bun: string
  bunVersion: string | undefined
  term?: string
  root?: string
  read?: ObjectReader
  node?: string | null
  /** Runs the install; returns its exit status. */
  install?: (
    bun: string,
    dir: string,
    env: Record<string, string>
  ) => number | null
  log?: (line: string) => void
}

/** `bun install` arguments: the lockfile as committed, no lifecycle script. */
export const INSTALL_ARGS: readonly string[] = [
  'install',
  '--frozen-lockfile',
  '--ignore-scripts',
]

function defaultInstall(
  bun: string,
  dir: string,
  env: Record<string, string>
): number | null {
  return spawnSync(bun, [...INSTALL_ARGS], {
    cwd: dir,
    env: env as NodeJS.ProcessEnv,
    stdio: ['ignore', 'inherit', 'inherit'],
  }).status
}

/**
 * Exports the approved commit into a new private folder, checks it, installs
 * its dependencies and returns how to run the Convex CLI there. Throws
 * NetworkGuardError (`LIVE_WINDOW_BUILD`) when any step fails; nothing is
 * left behind then.
 */
export function prepareWindowBuild(options: BuildOptions): WindowBuild {
  const log = options.log ?? ((line: string) => console.log(line))
  if (!options.bunVersion) {
    throw buildError('Run the window tool with Bun.')
  }
  const root = options.root ?? liveWindowBuildRoot()
  const repoRoot = fs.realpathSync(options.repoRoot)
  const bunPath = fs.realpathSync(options.bun)
  if (!path.relative(repoRoot, bunPath).startsWith('..')) {
    throw buildError(
      'Bun runs from inside the checkout. Run the tool with your installed Bun: bun scripts/live-window.ts.'
    )
  }
  const node = options.node === undefined ? systemBinary('node') : options.node
  if (!node) {
    throw buildError(
      `Node is not in ${SYSTEM_BIN_DIRS.join(', ')}. Install Node ${MIN_NODE_MAJOR} or later there; the window does not use PATH.`
    )
  }

  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const rootStat = fs.lstatSync(root)
  if (
    !rootStat.isDirectory() ||
    (typeof process.getuid === 'function' && rootStat.uid !== process.getuid())
  ) {
    throw buildError(`${root} must be a folder you own, not a link.`)
  }
  if (!path.relative(repoRoot, fs.realpathSync(root)).startsWith('..')) {
    throw buildError(`${root} is inside the checkout. Use a folder outside it.`)
  }
  fs.chmodSync(root, 0o700)
  const cache = path.join(root, `cache-${options.commit}`)
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 })
  const work = fs.mkdtempSync(path.join(root, 'run-'))
  const cleanup = () => fs.rmSync(work, { recursive: true, force: true })
  try {
    const dir = path.join(work, 'src')
    const home = path.join(work, 'home')
    const tmp = path.join(work, 'tmp')
    for (const d of [dir, home, tmp]) fs.mkdirSync(d, { mode: 0o700 })

    log(`Exporting ${options.commit} into a private folder…`)
    const read = options.read ?? gitObjectReader(repoRoot, { home })
    const exported = exportCommit(read, options.commit, dir)
    log(
      `Exported ${exported.files} files (tree ${exported.tree}), checked against their object ids.`
    )

    const pinned = pinnedBunVersion(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    )
    if (!pinned || pinned !== options.bunVersion) {
      throw buildError(
        `The release pins Bun ${pinned ?? '(none)'}; this is Bun ${options.bunVersion}. Run the tool with that version, for example npx bun@${pinned ?? '<version>'} scripts/live-window.ts.`
      )
    }

    log('Installing dependencies from the lockfile (frozen, no scripts)…')
    const install = options.install ?? defaultInstall
    const status = install(
      bunPath,
      dir,
      installEnv(bunPath, { home, tmp, cache })
    )
    if (status !== 0) {
      throw buildError(`bun install --frozen-lockfile failed (exit ${status}).`)
    }
    // The install writes node_modules only; the rest is still the commit.
    if (folderTreeId(dir, ['node_modules']) !== exported.tree) {
      throw buildError('The install changed files of the release commit.')
    }
    const cli = path.join(dir, 'node_modules', 'convex', 'bin', 'main.js')
    if (!fs.existsSync(cli)) {
      throw buildError('The Convex CLI is not in the installed dependencies.')
    }

    const env = cliEnv(node, options.deployKey, { home, tmp }, options.term)
    const major = nodeMajor(node, env)
    if (major === null || major < MIN_NODE_MAJOR) {
      throw buildError(
        `${node} is not Node ${MIN_NODE_MAJOR} or later (found ${major ?? 'none'}).`
      )
    }
    return {
      dir,
      tree: exported.tree,
      node,
      bun: bunPath,
      bunVersion: options.bunVersion,
      command: (convexArgs) => ({
        file: node,
        args: [cli, ...convexArgs],
        cwd: dir,
        env,
      }),
      cleanup,
    }
  } catch (error) {
    cleanup()
    if (error instanceof NetworkGuardError) throw error
    throw buildError(
      `The window build failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
