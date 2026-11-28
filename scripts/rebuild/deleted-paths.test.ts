import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
