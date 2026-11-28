import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleFormatError } from '@/lib/profile/handleRules'
import {
  APP_ROUTE_SEGMENTS,
  publicContentPath,
} from '@/lib/routing/publicContentPath'
import { SEGMENT_PACKAGES } from '@/lib/routing/segments'

const root = path.resolve(__dirname, '../..')

/** A directory that serves something: a page or a route handler below it. */
function serves(dir: string): boolean {
  return readdirSync(dir).some((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return serves(full)
    return /^(page|route)\.(tsx?|jsx?)$/.test(name)
  })
}

/** Top-level URL segments under a route tree: groups are walked through,
 * dynamic, private and parallel segments are not names. */
function topSegments(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (!statSync(full).isDirectory()) return []
    if (/^\(.*\)$/.test(name)) return topSegments(full)
    if (/^[[_@]/.test(name)) return []
    return serves(full) ? [name] : []
  })
}

describe('reserved first path segments (lib/routing/segments)', () => {
  const routes = [
    ...topSegments(path.join(root, 'app/(app)')),
    ...topSegments(path.join(root, 'app/(legacy)')),
  ]

  it('finds the routes it guards', () => {
    expect(routes).toEqual(
      expect.arrayContaining(['articles', 'pocket', 'shelf', 'system'])
    )
  })

  it('reserves every top-level route, so none is read as a handle', () => {
    expect(
      routes.filter((segment) => !APP_ROUTE_SEGMENTS.has(segment))
    ).toEqual([])
    for (const segment of routes) {
      expect(publicContentPath(`/${segment}`), segment).toBeNull()
      expect(publicContentPath(`/${segment}/reset`), segment).toBeNull()
    }
  })

  it('refuses every reserved segment as a handle: one rule for both', () => {
    for (const segment of APP_ROUTE_SEGMENTS)
      if (/^[a-z0-9][a-z0-9_]*$/.test(segment) && segment.length >= 3)
        expect(handleFormatError(segment), segment).toBe(
          'That handle is reserved.'
        )
  })

  it('reserves sign-in before its page ships', () => {
    expect(publicContentPath('/signin')).toBeNull()
    expect(publicContentPath('/signin/reset')).toBeNull()
  })

  it('has one file per package, each a list of plain segments', () => {
    expect(Object.keys(SEGMENT_PACKAGES).sort()).toEqual([
      'foundation',
      'legacy',
      'ops',
      'pocket',
      'read',
      'resources',
      'search',
      'shelf',
      'signin',
      'today',
      'write',
      'writer',
      'you',
    ])
    for (const segment of Object.values(SEGMENT_PACKAGES).flat())
      expect(segment).toMatch(/^[a-z0-9][a-z0-9-]*$/)
  })
})
