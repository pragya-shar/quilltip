/**
 * The window build (#588): the code a window run pushes is exported from the
 * approved commit's objects, checked against their ids, and run in a clean
 * environment. These tests use real git repositories in temporary folders and
 * never reach any network.
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import { NetworkGuardError } from '../../convex/lib/networkGuard'
import {
  INSTALL_ARGS,
  SYSTEM_BIN_DIRS,
  cliEnv,
  exportCommit,
  folderTreeId,
  gitObjectId,
  gitObjectReader,
  installEnv,
  pinnedBunVersion,
  prepareWindowBuild,
  systemBinary,
  type GitObject,
  type ObjectReader,
} from '../lib/live-window-build'
import { checkoutChanges } from '../lib/live-window'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(prefix = 'live-window-build-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim()
}

const FILES: Record<string, string> = {
  'package.json': '{"name":"t","packageManager":"bun@1.4.4"}\n',
  'bun.lock': '{}\n',
  'convex/a.ts': 'export const a = 1\n',
  'convex/nested/b.ts': 'export const b = 2\n',
  'convex/_generated/api.js': 'export const api = {}\n',
  '.gitattributes': 'convex/a.ts export-subst filter=evil\n',
}

/** A repository with one commit of FILES (and an executable script). */
function repository() {
  const root = tempDir('live-window-repo-')
  git(root, 'init', '-q')
  for (const [file, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.writeFileSync(path.join(root, 'scripts', 'run.sh'), '#!/bin/sh\n', {
    mode: 0o755,
  })
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'release')
  return { root, commit: git(root, 'rev-parse', 'HEAD') }
}

function exportTo(root: string, commit: string, read?: ObjectReader) {
  const dest = tempDir('live-window-export-')
  return {
    dest,
    result: exportCommit(read ?? gitObjectReader(root), commit, dest),
  }
}

function buildCode(fn: () => unknown): string[] {
  try {
    fn()
  } catch (error) {
    if (error instanceof NetworkGuardError) return error.codes
    throw error
  }
  return []
}

describe('export of the approved commit', () => {
  it('writes exactly the commit tree, checked from the bytes on disk', () => {
    const { root, commit } = repository()
    const { dest, result } = exportTo(root, commit)
    expect(result.tree).toBe(git(root, 'rev-parse', 'HEAD^{tree}'))
    expect(folderTreeId(dest)).toBe(result.tree)
    expect(fs.readFileSync(path.join(dest, 'convex/a.ts'), 'utf8')).toBe(
      FILES['convex/a.ts']
    )
    expect(fs.statSync(path.join(dest, 'scripts/run.sh')).mode & 0o100).toBe(
      0o100
    )
    expect(fs.existsSync(path.join(dest, '.git'))).toBe(false)
  })

  it('ignores the working tree, the index, exclude files and index flags', () => {
    const { root, commit } = repository()
    fs.writeFileSync(path.join(root, 'convex/a.ts'), 'export const a = 666\n')
    git(root, 'update-index', '--skip-worktree', 'convex/a.ts')
    fs.writeFileSync(
      path.join(root, 'convex/staged.ts'),
      'export const s = 1\n'
    )
    git(root, 'add', 'convex/staged.ts')
    fs.writeFileSync(
      path.join(root, 'convex/hidden.ts'),
      'export const h = 1\n'
    )
    fs.appendFileSync(
      path.join(root, '.git/info/exclude'),
      'convex/hidden.ts\n'
    )
    fs.mkdirSync(path.join(root, 'convex/x.tsbuildinfo'))
    fs.writeFileSync(path.join(root, 'convex/x.tsbuildinfo/e.ts'), 'x\n')
    const { dest } = exportTo(root, commit)
    expect(fs.readFileSync(path.join(dest, 'convex/a.ts'), 'utf8')).toBe(
      FILES['convex/a.ts']
    )
    for (const extra of ['staged.ts', 'hidden.ts', 'x.tsbuildinfo']) {
      expect(fs.existsSync(path.join(dest, 'convex', extra))).toBe(false)
    }
  })

  it('applies no attribute, filter or export-subst, and runs no filter command', () => {
    const { root } = repository()
    const marker = path.join(tempDir(), 'filter-ran')
    fs.writeFileSync(
      path.join(root, 'convex/a.ts'),
      'export const a = "$Format:%H$"\n'
    )
    git(root, 'add', 'convex/a.ts')
    git(root, 'commit', '-q', '-m', 'subst')
    // A smudge filter configured after the commit: git checkout or archive
    // would run it on convex/a.ts.
    git(root, 'config', 'filter.evil.smudge', `touch ${marker}; cat`)
    git(root, 'config', 'filter.evil.required', 'true')
    expect(git(root, 'archive', 'HEAD', 'convex/a.ts').length).toBeGreaterThan(
      0
    )
    expect(fs.existsSync(marker)).toBe(true)
    fs.rmSync(marker)
    const head = git(root, 'rev-parse', 'HEAD')
    const { dest } = exportTo(root, head)
    expect(fs.readFileSync(path.join(dest, 'convex/a.ts'), 'utf8')).toBe(
      'export const a = "$Format:%H$"\n'
    )
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('ignores replace refs', () => {
    const { root, commit } = repository()
    const blob = git(root, 'rev-parse', 'HEAD:convex/a.ts')
    const evil = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: root,
      input: 'export const a = 666\n',
      encoding: 'utf8',
    }).trim()
    git(root, 'replace', blob, evil)
    // git itself now shows the replacement.
    expect(git(root, 'show', 'HEAD:convex/a.ts')).toContain('666')
    const { dest } = exportTo(root, commit)
    expect(fs.readFileSync(path.join(dest, 'convex/a.ts'), 'utf8')).toBe(
      FILES['convex/a.ts']
    )
  })

  it('refuses a tampered object whose bytes do not match its id', () => {
    const { root, commit } = repository()
    const blob = git(root, 'rev-parse', 'HEAD:convex/a.ts')
    const evil = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: root,
      input: 'export const a = 666\n',
      encoding: 'utf8',
    }).trim()
    const objects = path.join(root, '.git', 'objects')
    const target = path.join(objects, blob.slice(0, 2), blob.slice(2))
    fs.chmodSync(target, 0o644)
    fs.copyFileSync(path.join(objects, evil.slice(0, 2), evil.slice(2)), target)
    // git reads the tampered object without complaint.
    expect(git(root, 'show', 'HEAD:convex/a.ts')).toContain('666')
    expect(buildCode(() => exportTo(root, commit))).toEqual([
      'LIVE_WINDOW_BUILD',
    ])
  })

  it('refuses a tampered commit object that points at another tree', () => {
    const { root, commit } = repository()
    // A second, genuine commit with other code.
    fs.writeFileSync(path.join(root, 'convex/a.ts'), 'export const a = 666\n')
    git(root, 'commit', '-q', '-am', 'other')
    const other = git(root, 'rev-parse', 'HEAD')
    const objects = path.join(root, '.git', 'objects')
    const target = path.join(objects, commit.slice(0, 2), commit.slice(2))
    fs.chmodSync(target, 0o644)
    fs.copyFileSync(
      path.join(objects, other.slice(0, 2), other.slice(2)),
      target
    )
    // git now shows the other code for the approved commit.
    expect(git(root, 'show', `${commit}:convex/a.ts`)).toContain('666')
    expect(buildCode(() => exportTo(root, commit))).toEqual([
      'LIVE_WINDOW_BUILD',
    ])
  })

  it('refuses a commit that is not in the repository, or a short id', () => {
    const { root } = repository()
    expect(buildCode(() => exportTo(root, 'a'.repeat(40)))).toEqual([
      'LIVE_WINDOW_BUILD',
    ])
    expect(buildCode(() => exportTo(root, 'abc123'))).toEqual([
      'LIVE_WINDOW_BUILD',
    ])
  })

  it('refuses symbolic links and submodules in the commit', () => {
    const { root } = repository()
    fs.symlinkSync('/etc', path.join(root, 'convex/link'))
    git(root, 'add', 'convex/link')
    git(root, 'commit', '-q', '-m', 'link')
    expect(
      buildCode(() => exportTo(root, git(root, 'rev-parse', 'HEAD')))
    ).toEqual(['LIVE_WINDOW_BUILD'])

    const second = repository()
    git(
      second.root,
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${second.commit},convex/sub`
    )
    git(second.root, 'commit', '-q', '-m', 'submodule')
    expect(
      buildCode(() =>
        exportTo(second.root, git(second.root, 'rev-parse', 'HEAD'))
      )
    ).toEqual(['LIVE_WINDOW_BUILD'])
  })

  it('refuses a committed .env or .env.local, which the Convex CLI would load', () => {
    const { root } = repository()
    fs.writeFileSync(path.join(root, '.env.local'), 'CONVEX_DEPLOYMENT=dev:x\n')
    git(root, 'add', '-f', '.env.local')
    git(root, 'commit', '-q', '-m', 'env')
    expect(
      buildCode(() => exportTo(root, git(root, 'rev-parse', 'HEAD')))
    ).toEqual(['LIVE_WINDOW_BUILD'])
  })
})

describe('export from objects git would not check out', () => {
  /** An in-memory repository: objects by id, as a reader returns them. */
  function store() {
    const objects = new Map<string, GitObject>()
    const put = (type: 'blob' | 'tree' | 'commit', body: Buffer) => {
      const id = gitObjectId(type, body)
      objects.set(id, { type, body })
      return id
    }
    const tree = (entries: { mode: string; name: string; id: string }[]) =>
      put(
        'tree',
        Buffer.concat(
          entries.flatMap((e) => [
            Buffer.from(`${e.mode} ${e.name}\0`, 'utf8'),
            Buffer.from(e.id, 'hex'),
          ])
        )
      )
    const commit = (treeId: string) =>
      put(
        'commit',
        Buffer.from(
          `tree ${treeId}\nauthor T <t@t> 0 +0000\ncommitter T <t@t> 0 +0000\n\nm\n`
        )
      )
    const read: ObjectReader = (ids) =>
      new Map(
        ids.flatMap((id) => {
          const o = objects.get(id)
          return o ? [[id, o] as const] : []
        })
      )
    return { put, tree, commit, read, objects }
  }

  it('refuses a .git entry, in any case or with ignorable characters', () => {
    for (const name of ['.git', '.GIT', '.G‍it']) {
      const s = store()
      const blob = s.put('blob', Buffer.from('x'))
      const commit = s.commit(s.tree([{ mode: '100644', name, id: blob }]))
      expect(
        buildCode(() =>
          exportCommit(s.read, commit, tempDir('live-window-export-'))
        )
      ).toEqual(['LIVE_WINDOW_BUILD'])
    }
  })

  it('refuses names that collide on a case-insensitive or normalising file system', () => {
    for (const [a, b] of [
      ['A.ts', 'a.ts'],
      ['café.ts', 'café.ts'],
    ] as const) {
      const s = store()
      const one = s.put('blob', Buffer.from('1'))
      const two = s.put('blob', Buffer.from('2'))
      const entries = [
        { mode: '100644', name: a, id: one },
        { mode: '100644', name: b, id: two },
      ].sort((x, y) => Buffer.compare(Buffer.from(x.name), Buffer.from(y.name)))
      const commit = s.commit(s.tree(entries))
      expect(
        buildCode(() =>
          exportCommit(s.read, commit, tempDir('live-window-export-'))
        )
      ).toEqual(['LIVE_WINDOW_BUILD'])
    }
  })

  it('refuses a reader that returns other bytes for an id', () => {
    const s = store()
    const blob = s.put('blob', Buffer.from('export const a = 1\n'))
    const commit = s.commit(
      s.tree([{ mode: '100644', name: 'a.ts', id: blob }])
    )
    const lying: ObjectReader = (ids) => {
      const out = s.read(ids)
      if (out.has(blob)) {
        out.set(blob, {
          type: 'blob',
          body: Buffer.from('export const a = 666\n'),
        })
      }
      return out
    }
    expect(
      buildCode(() =>
        exportCommit(lying, commit, tempDir('live-window-export-'))
      )
    ).toEqual(['LIVE_WINDOW_BUILD'])
  })

  it('refuses a name this file system cannot store as committed', () => {
    const s = store()
    const blob = s.put('blob', Buffer.from('x'))
    // A name that is not valid UTF-8: written under another name.
    const tree = s.put(
      'tree',
      Buffer.concat([
        Buffer.from('100644 a'),
        Buffer.from([0xff]),
        Buffer.from('.ts\0'),
        Buffer.from(blob, 'hex'),
      ])
    )
    const commit = s.commit(tree)
    expect(
      buildCode(() =>
        exportCommit(s.read, commit, tempDir('live-window-export-'))
      )
    ).toEqual(['LIVE_WINDOW_BUILD'])
  })

  it('refuses unknown modes', () => {
    const s = store()
    const blob = s.put('blob', Buffer.from('x'))
    const commit = s.commit(
      s.tree([{ mode: '100664', name: 'a.ts', id: blob }])
    )
    expect(
      buildCode(() =>
        exportCommit(s.read, commit, tempDir('live-window-export-'))
      )
    ).toEqual(['LIVE_WINDOW_BUILD'])
  })
})

describe('git and node from system folders only', () => {
  it('never takes git or node from PATH', () => {
    const shadow = tempDir()
    for (const name of ['git', 'node']) {
      fs.writeFileSync(path.join(shadow, name), '#!/bin/sh\nexit 0\n', {
        mode: 0o755,
      })
    }
    const before = process.env.PATH
    process.env.PATH = `${shadow}:${before}`
    try {
      for (const name of ['git', 'node']) {
        const found = systemBinary(name)
        if (found) expect(found.startsWith(shadow)).toBe(false)
      }
    } finally {
      process.env.PATH = before
    }
    expect(systemBinary('git', [shadow])).toBe(path.join(shadow, 'git'))
    expect(systemBinary('missing-tool', [shadow])).toBeNull()
  })

  it('the checkout check never runs a git that PATH shadows', () => {
    const { root } = repository()
    const shadow = tempDir()
    const marker = path.join(shadow, 'ran')
    fs.writeFileSync(
      path.join(shadow, 'git'),
      `#!/bin/sh\ntouch ${marker}\nexit 0\n`,
      { mode: 0o755 }
    )
    const before = process.env.PATH
    process.env.PATH = `${shadow}:${before}`
    try {
      expect(checkoutChanges(root)).toEqual([])
    } finally {
      process.env.PATH = before
    }
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('gives git none of the caller environment', () => {
    const { root, commit } = repository()
    const bin = tempDir()
    const seen = path.join(bin, 'env.txt')
    const fake = path.join(bin, 'git')
    fs.writeFileSync(
      fake,
      `#!/bin/sh\nenv > ${seen}\nexec ${systemBinary('git') ?? '/usr/bin/git'} "$@"\n`,
      { mode: 0o755 }
    )
    process.env.CONVEX_DEPLOY_KEY = 'dev:x|key-material'
    try {
      exportCommit(gitObjectReader(root, { git: fake }), commit, tempDir())
    } finally {
      delete process.env.CONVEX_DEPLOY_KEY
    }
    const env = fs.readFileSync(seen, 'utf8')
    expect(env).not.toContain('key-material')
    expect(env).toContain(`PATH=${SYSTEM_BIN_DIRS.join(':')}`)
    expect(env).toContain('GIT_CONFIG_GLOBAL=/dev/null')
  })
})

describe('folder tree id', () => {
  it('matches git write-tree, ignores empty folders and skips node_modules', () => {
    const { root } = repository()
    const expected = git(root, 'write-tree')
    fs.rmSync(path.join(root, '.git'), { recursive: true, force: true })
    fs.mkdirSync(path.join(root, 'empty'))
    fs.mkdirSync(path.join(root, 'node_modules/convex'), { recursive: true })
    fs.writeFileSync(path.join(root, 'node_modules/convex/x.js'), 'x\n')
    expect(folderTreeId(root, ['node_modules'])).toBe(expected)
    expect(folderTreeId(root)).not.toBe(expected)
    fs.symlinkSync('/etc', path.join(root, 'convex/link'))
    expect(folderTreeId(root, ['node_modules'])).toBeNull()
  })
})

describe('window build', () => {
  const BUN = '1.4.4'

  function fakeNode(version = 'v24.0.0') {
    const bin = tempDir()
    const node = path.join(bin, 'node')
    fs.writeFileSync(node, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 })
    return node
  }

  function fakeBun() {
    const bin = tempDir()
    const bun = path.join(bin, 'bun')
    fs.writeFileSync(bun, '#!/bin/sh\n', { mode: 0o755 })
    return bun
  }

  /** An install that writes the Convex CLI entry, as a real install would. */
  const install =
    (seen: Record<string, string>[] = [], extra?: (dir: string) => void) =>
    (_bun: string, dir: string, env: Record<string, string>) => {
      seen.push(env)
      const cli = path.join(dir, 'node_modules/convex/bin/main.js')
      fs.mkdirSync(path.dirname(cli), { recursive: true })
      fs.writeFileSync(cli, '// cli\n')
      extra?.(dir)
      return 0
    }

  function build(
    overrides: Partial<Parameters<typeof prepareWindowBuild>[0]> = {}
  ) {
    const { root, commit } = repository()
    const buildRoot = tempDir('live-window-builds-')
    return {
      root,
      commit,
      buildRoot,
      run: () =>
        prepareWindowBuild({
          commit,
          repoRoot: root,
          deployKey: 'dev:upbeat-mockingbird-579|key-material',
          bun: fakeBun(),
          bunVersion: BUN,
          root: buildRoot,
          node: fakeNode(),
          install: install(),
          log: () => {},
          ...overrides,
        }),
    }
  }

  it('runs the Convex CLI from the export with system Node and a clean environment', () => {
    const seen: Record<string, string>[] = []
    const node = fakeNode()
    process.env.NODE_OPTIONS = '--require /tmp/x.js'
    process.env.ESBUILD_BINARY_PATH = '/tmp/esbuild'
    process.env.npm_config_registry = 'https://example.test'
    try {
      const b = build({ node, install: install(seen), term: 'xterm-256color' })
      const result = b.run()
      const command = result.command(['deploy', '--dry-run'])
      expect(command.file).toBe(node)
      expect(command.args).toEqual([
        path.join(result.dir, 'node_modules/convex/bin/main.js'),
        'deploy',
        '--dry-run',
      ])
      expect(command.cwd).toBe(result.dir)
      expect(Object.keys(command.env).sort()).toEqual([
        'CONVEX_DEPLOY_KEY',
        'HOME',
        'PATH',
        'TERM',
        'TMPDIR',
      ])
      expect(command.env.HOME?.startsWith(b.buildRoot)).toBe(true)
      expect(Object.keys(seen[0] ?? {}).sort()).toEqual([
        'BUN_INSTALL_CACHE_DIR',
        'HOME',
        'NO_COLOR',
        'PATH',
        'TMPDIR',
      ])
      expect(JSON.stringify(seen)).not.toContain('key-material')
      expect(folderTreeId(result.dir, ['node_modules'])).toBe(result.tree)
      result.cleanup()
      expect(fs.existsSync(result.dir)).toBe(false)
    } finally {
      delete process.env.NODE_OPTIONS
      delete process.env.ESBUILD_BINARY_PATH
      delete process.env.npm_config_registry
    }
  })

  it('refuses another Bun version than the commit pins', () => {
    expect(buildCode(() => build({ bunVersion: '1.3.14' }).run())).toEqual([
      'LIVE_WINDOW_BUILD',
    ])
    expect(buildCode(() => build({ bunVersion: undefined }).run())).toEqual([
      'LIVE_WINDOW_BUILD',
    ])
  })

  it('refuses a Bun inside the checkout (node_modules/.bin under bun run)', () => {
    const b = build()
    const inside = path.join(b.root, 'node_modules/.bin/bun')
    fs.mkdirSync(path.dirname(inside), { recursive: true })
    fs.writeFileSync(inside, '#!/bin/sh\n', { mode: 0o755 })
    expect(
      buildCode(() =>
        prepareWindowBuild({
          commit: b.commit,
          repoRoot: b.root,
          deployKey: 'k',
          bun: inside,
          bunVersion: BUN,
          root: b.buildRoot,
          node: fakeNode(),
          install: install(),
          log: () => {},
        })
      )
    ).toEqual(['LIVE_WINDOW_BUILD'])
  })

  it('refuses a failed install, an install that changes release files, no Node and an old Node, and leaves nothing behind', () => {
    const cases: Partial<Parameters<typeof prepareWindowBuild>[0]>[] = [
      { install: () => 1 },
      {
        install: install([], (dir) =>
          fs.appendFileSync(path.join(dir, 'convex/a.ts'), '// changed\n')
        ),
      },
      {
        install: install([], (dir) =>
          fs.writeFileSync(path.join(dir, 'convex/extra.ts'), 'x\n')
        ),
      },
      { node: null },
      { node: fakeNode('v18.19.0') },
    ]
    for (const overrides of cases) {
      const b = build(overrides)
      expect(buildCode(() => b.run())).toEqual(['LIVE_WINDOW_BUILD'])
      expect(
        fs.readdirSync(b.buildRoot).filter((n) => n.startsWith('run-'))
      ).toEqual([])
    }
  })

  it('refuses a build folder that is a link or inside the checkout', () => {
    const b = build()
    const target = tempDir()
    const link = path.join(tempDir(), 'builds')
    fs.symlinkSync(target, link)
    const inside = path.join(b.root, '.builds')
    for (const root of [link, inside]) {
      expect(
        buildCode(() =>
          prepareWindowBuild({
            commit: b.commit,
            repoRoot: b.root,
            deployKey: 'k',
            bun: fakeBun(),
            bunVersion: BUN,
            root,
            node: fakeNode(),
            install: install(),
            log: () => {},
          })
        )
      ).toEqual(['LIVE_WINDOW_BUILD'])
    }
    expect(fs.readdirSync(target)).toEqual([])
  })

  it('installs from the lockfile as committed, with no lifecycle script', () => {
    expect(INSTALL_ARGS).toEqual([
      'install',
      '--frozen-lockfile',
      '--ignore-scripts',
    ])
  })

  it('reads the pinned Bun version strictly', () => {
    expect(pinnedBunVersion('{"packageManager":"bun@1.4.4"}')).toBe('1.4.4')
    for (const text of [
      '{"packageManager":"npm@10.0.0"}',
      '{"packageManager":"bun@1.4"}',
      '{}',
      'not json',
    ]) {
      expect(pinnedBunVersion(text)).toBeNull()
    }
  })

  it('builds the install and CLI environments from named values only', () => {
    expect(
      installEnv('/opt/bun/bin/bun', { home: '/h', tmp: '/t', cache: '/c' })
    ).toEqual({
      PATH: '/opt/bun/bin:/usr/bin:/bin',
      HOME: '/h',
      TMPDIR: '/t',
      BUN_INSTALL_CACHE_DIR: '/c',
      NO_COLOR: '1',
    })
    expect(
      cliEnv('/usr/local/bin/node', 'key', { home: '/h', tmp: '/t' }, 'a b')
    ).toEqual({
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/h',
      TMPDIR: '/t',
      CONVEX_DEPLOY_KEY: 'key',
    })
  })
})
