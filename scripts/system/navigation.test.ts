import { describe, expect, it } from 'vitest'
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
    expect(POCKET).toEqual({ href: '/pocket', signIn: '/login' })
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
