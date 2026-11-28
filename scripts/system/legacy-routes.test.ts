import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SHELL_SEGMENTS,
  linkPrefetch,
  prefetchFor,
  servedByLegacy,
  type LegacyRouteTree,
} from '@/lib/routing/legacyRoutes'
import { legacyRouteTree } from '@/lib/routing/legacyRouteTree'

const root = path.resolve(__dirname, '../..')

/** Top-level URL segments with pages under a route tree: groups walked
 * through; dynamic, private and parallel segments are not names. */
function topSegments(dir: string): string[] {
  const serves = (at: string): boolean =>
    readdirSync(at).some((name) => {
      const full = path.join(at, name)
      return statSync(full).isDirectory()
        ? serves(full)
        : /^(page|route)\.(tsx?|jsx?)$/.test(name)
    })
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (!statSync(full).isDirectory()) return []
    if (/^\(.*\)$/.test(name)) return topSegments(full)
    if (/^[[_@]/.test(name)) return []
    return serves(full) ? [name] : []
  })
}

describe('links from the shell to legacy pages never prefetch', () => {
  // The rule, against a tree built here: it holds whichever surfaces have
  // replaced which legacy routes.
  const built: LegacyRouteTree = {
    home: true,
    segments: ['articles', 'guide', 'login'],
    writer: true,
  }

  it('turns prefetch off for legacy paths, and only for them', () => {
    for (const href of [
      '/',
      '/articles',
      '/login?returnTo=%2F',
      '/guide#start',
      '/tomas',
      '/tomas/ledger',
      // A handle that starts like a reserved word is still a writer.
      '/apiary',
    ])
      expect(prefetchFor(href, built), href).toBe(false)
    for (const href of [
      '/shelf',
      '/pocket',
      '/system/reading#fn-1',
      '/signin',
      'https://example.org',
      '//x.org',
      '/robots.txt',
    ])
      expect(prefetchFor(href, built), href).toBeUndefined()
  })

  it('lets the shell prefetch what it took over', () => {
    const taken: LegacyRouteTree = { home: false, segments: [], writer: false }
    expect(prefetchFor('/', taken)).toBeUndefined()
    expect(prefetchFor('/articles', taken)).toBeUndefined()
    expect(servedByLegacy('/tomas', taken)).toBe(false)
  })

  it('reads the real tree: every legacy route in it, no shell route', () => {
    const tree = legacyRouteTree(path.join(root, 'app/(legacy)'))
    expect([...tree.segments].sort()).toEqual(
      topSegments(path.join(root, 'app/(legacy)')).sort()
    )
    for (const segment of topSegments(path.join(root, 'app/(app)')))
      expect(tree.segments, segment).not.toContain(segment)
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

  it('sends every link of the shell and its surfaces through AppLink', () => {
    // The same places as the lint rule in eslint.config.mjs.
    const surfaces = [
      'read',
      'pocket',
      'today',
      'shelf',
      'write',
      'writer',
      'search',
      'you',
      'signin',
      'resources',
      'ops',
    ].map((name) => `components/${name}`)
    const files = execFileSync(
      'git',
      ['ls-files', 'system', 'shell', 'app/(app)', ...surfaces],
      {
        cwd: root,
      }
    )
      .toString()
      .split('\n')
      .filter((file) => /\.tsx?$/.test(file))
    const direct = files.filter(
      (file) =>
        file !== 'system/components/AppLink.tsx' &&
        /import\s+Link\b[^;]*from\s+'next\/link'/.test(
          readFileSync(path.join(root, file), 'utf8')
        )
    )
    expect(direct).toEqual([])
  })
})

describe('links to pages behind the route check', () => {
  const shellWriter: LegacyRouteTree = {
    home: false,
    segments: ['articles'],
    writer: false,
  }

  it('prefetch on intent only; the shell places as usual; legacy never', () => {
    for (const href of [
      '/tomas',
      '/tomas/ledger',
      '/Tomas',
      '/apiary',
      '/API/x',
    ])
      expect(linkPrefetch(href, shellWriter), href).toBe('intent')
    for (const href of ['/', '/shelf', '/pocket', '/write', '/system/reading'])
      expect(linkPrefetch(href, { ...shellWriter, segments: [] }), href).toBe(
        'default'
      )
    expect(linkPrefetch('/articles', shellWriter)).toBe('never')
    expect(
      linkPrefetch('/tomas', { home: true, segments: [], writer: true })
    ).toBe('never')
  })
})
