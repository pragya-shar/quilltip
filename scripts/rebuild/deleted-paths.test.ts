import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { deletedPaths, parseDeletedPaths } from './deleted-paths'

const root = path.resolve(__dirname, '../..')

describe('deleted paths stay deleted', () => {
  const listed = deletedPaths()

  it('lists only paths inside the repository, each once', () => {
    for (const { path: entry, listedIn } of listed) {
      expect(path.isAbsolute(entry), `${listedIn}: ${entry}`).toBe(false)
      expect(path.normalize(entry).startsWith('..'), entry).toBe(false)
    }
    const paths = listed.map((entry) => entry.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('finds none of them in the tree', () => {
    const back = listed.filter((entry) =>
      existsSync(path.join(root, entry.path))
    )
    expect(back, 'deleted by the rebuild, back after a merge').toEqual([])
  })
})

describe('a deleted legacy file is listed', () => {
  const snapshot = parseDeletedPaths(
    readFileSync(path.join(__dirname, 'legacy-files.txt'), 'utf8')
  )
  const listedPaths = deletedPaths().map((entry) => entry.path)
  /** Listed itself, or inside a listed directory. */
  const covered = (file: string) =>
    listedPaths.some(
      (entry) =>
        file === entry || file.startsWith(`${entry.replace(/\/$/, '')}/`)
    )

  it('lists every legacy file that is gone in a package file', () => {
    const gone = snapshot.filter((file) => !existsSync(path.join(root, file)))
    expect(
      gone.filter((file) => !covered(file)),
      'deleted, but not in scripts/rebuild/deleted/<package>.txt'
    ).toEqual([])
  })

  it('adds no file under app/(legacy)', () => {
    const now = execFileSync('git', ['ls-files', 'app/(legacy)'], { cwd: root })
      .toString()
      .split('\n')
      .filter(Boolean)
    expect(now.filter((file) => !snapshot.includes(file))).toEqual([])
  })
})

describe('the loader', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'deleted-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads every package file and skips comments and blank lines', () => {
    writeFileSync(path.join(dir, 'read.txt'), '# note\n\n app/x.tsx \n')
    writeFileSync(path.join(dir, 'pocket.txt'), 'components/tab\n')
    writeFileSync(path.join(dir, 'notes.md'), 'not read\n')
    expect(deletedPaths(dir)).toEqual([
      { path: 'components/tab', listedIn: 'pocket.txt' },
      { path: 'app/x.tsx', listedIn: 'read.txt' },
    ])
    expect(parseDeletedPaths('# a\nb\n')).toEqual(['b'])
  })
})
