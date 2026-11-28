import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SHELL_SEGMENTS,
  prefetchFor,
  servedByLegacy,
  type LegacyRouteTree,
} from '@/lib/routing/legacyRoutes'
import { legacyRouteTree } from '@/lib/routing/legacyRouteTree'

const root = path.resolve(__dirname, '../..')
const tree = legacyRouteTree(path.join(root, 'app/(legacy)'))

describe('links from the shell to legacy pages never prefetch', () => {
  it('reads which paths the legacy pages serve', () => {
    expect(tree.home).toBe(true)
    expect(tree.writer).toBe(true)
    expect(tree.segments).toEqual(
      expect.arrayContaining(['articles', 'login', 'write'])
    )
    expect(tree.segments).not.toContain('shelf')
  })

  it('turns prefetch off for them, and only for them', () => {
    for (const href of [
      '/',
      '/articles',
      '/write',
      '/login?returnTo=%2F',
      '/tomas',
      '/tomas/ledger',
    ])
      expect(prefetchFor(href, tree), href).toBe(false)
    for (const href of [
      '/shelf',
      '/pocket',
      '/system/reading#fn-1',
      '/signin',
      'https://example.org',
      '//x.org',
      '/robots.txt',
    ])
      expect(prefetchFor(href, tree), href).toBeUndefined()
    const none: LegacyRouteTree = { home: false, segments: [], writer: false }
    expect(servedByLegacy('/', none)).toBe(false)
    expect(servedByLegacy('/tomas', none)).toBe(false)
  })

  it("knows every top-level route of the shell as the shell's", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name)
        if (!statSync(full).isDirectory()) return []
        if (/^\(.*\)$/.test(name)) return walk(full)
        return /^[[_@]/.test(name) ? [] : [name]
      })
    const shell = walk(path.join(root, 'app/(app)'))
    expect(shell.filter((segment) => !SHELL_SEGMENTS.has(segment))).toEqual([])
  })

  it('has every next/link in system/ and shell/ decide its prefetch', () => {
    const files = execFileSync('git', ['ls-files', 'system', 'shell'], {
      cwd: root,
    })
      .toString()
      .split('\n')
      .filter((file) => /\.tsx$/.test(file))
    const missing: string[] = []
    for (const file of files) {
      const text = readFileSync(path.join(root, file), 'utf8')
      if (!text.includes("from 'next/link'")) continue
      const links = text.match(/<Link\b/g)?.length ?? 0
      const decided = text.match(/\bprefetch=\{/g)?.length ?? 0
      if (decided < links)
        missing.push(`${file}: ${links - decided} of ${links}`)
    }
    expect(missing).toEqual([])
  })
})
