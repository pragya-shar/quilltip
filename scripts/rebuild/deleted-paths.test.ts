import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../..')
const listFile = path.join(__dirname, 'deleted-paths.txt')

/** The listed paths, without comments and blank lines. */
export function deletedPaths(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

describe('deleted paths stay deleted', () => {
  const listed = deletedPaths(readFileSync(listFile, 'utf8'))

  it('lists only paths inside the repository', () => {
    for (const entry of listed) {
      expect(path.isAbsolute(entry), entry).toBe(false)
      expect(path.normalize(entry).startsWith('..'), entry).toBe(false)
    }
  })

  it('finds none of them in the tree', () => {
    const back = listed.filter((entry) => existsSync(path.join(root, entry)))
    expect(back, 'deleted by the rebuild, back after a merge').toEqual([])
  })

  it('reads comments and blank lines as nothing', () => {
    expect(deletedPaths('# note\n\n app/x.tsx \n')).toEqual(['app/x.tsx'])
  })
})
