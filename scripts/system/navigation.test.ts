import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { signInPathFromRoutes } from '@/lib/routing/signInPath'
import { signInHref } from '@/shell/signIn'
import { PLACES, POCKET, isActive, type Place } from '@/shell/navigation'
import { APP_ROUTE_SEGMENTS } from '@/lib/routing/publicContentPath'
import { handleFormatError } from '@/lib/profile/handleRules'

describe('the places', () => {
  it('are Today, Shelf and Write, in that order, at their URLs', () => {
    expect(PLACES.map((p) => [p.label, p.href])).toEqual([
      ['Today', '/'],
      ['Shelf', '/shelf'],
      ['Write', '/write'],
    ])
  })

  it('send the balance to the Pocket, or to sign in', () => {
    // No sign-in page in the shell yet: the legacy one.
    expect(POCKET).toEqual({ href: '/pocket', signIn: '/login' })
  })

  it('write the sign-in address in one place', () => {
    expect(signInHref()).toBe(POCKET.signIn)
    expect(signInHref('/shelf?tab=kept')).toBe(
      `${POCKET.signIn}?returnTo=%2Fshelf%3Ftab%3Dkept`
    )
    // Only a path on this site comes back.
    expect(signInHref('https://evil.example/x')).toBe(
      `${POCKET.signIn}?returnTo=%2F`
    )
    expect(signInHref('//evil.example')).toBe(`${POCKET.signIn}?returnTo=%2F`)
  })

  it('send sign-in to the shell page once it is in the route tree', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'routes-'))
    try {
      expect(signInPathFromRoutes(dir)).toBe('/login')
      mkdirSync(path.join(dir, '(public)', 'signin'), { recursive: true })
      writeFileSync(path.join(dir, '(public)', 'signin', 'page.tsx'), '')
      expect(signInPathFromRoutes(dir)).toBe('/signin')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(signInPathFromRoutes(path.join(tmpdir(), 'no-such-dir'))).toBe(
      '/login'
    )
    // This tree: the sign-in page has shipped.
    expect(signInPathFromRoutes()).toBe('/signin')
  })

  it('light at most one place for any path, and none on a pushed screen', () => {
    const paths: Record<string, string | null> = {
      '/': 'today',
      '/shelf': 'shelf',
      '/write': 'write',
      '/write/draft-1': null,
      '/pocket': null,
      '/pragya/a-story': null,
      '/search': null,
    }
    for (const [path, expected] of Object.entries(paths)) {
      const active = PLACES.filter((p) => isActive(p, path)).map((p) => p.id)
      expect(active, path).toEqual(expected ? [expected] : [])
    }
  })

  it('cannot be taken as handles', () => {
    for (const path of [
      'shelf',
      'pocket',
      'you',
      'search',
      'lines',
      'signin',
    ]) {
      expect(handleFormatError(path), path).toBe('That handle is reserved.')
    }
    expect(APP_ROUTE_SEGMENTS.has('shelf')).toBe(true)
    expect(APP_ROUTE_SEGMENTS.has('pocket')).toBe(true)
  })
})

describe('isActive', () => {
  const shelf: Place = {
    id: 'shelf',
    label: 'Shelf',
    href: '/shelf',
    icon: [],
    match: 'prefix',
  }
  it('matches a prefix on nested paths, not on lookalikes', () => {
    expect(isActive(shelf, '/shelf')).toBe(true)
    expect(isActive(shelf, '/shelf/')).toBe(true)
    expect(isActive(shelf, '/shelf/kept')).toBe(true)
    expect(isActive(shelf, '/shelves')).toBe(false)
  })
})
