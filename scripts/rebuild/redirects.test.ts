import { describe, expect, it } from 'vitest'
import {
  REDIRECTS,
  REDIRECT_PACKAGES,
  makeRedirector,
  type Redirect,
} from '@/lib/routing/redirects'

describe('the redirect table', () => {
  it('has one file per package, each a list', () => {
    expect(Object.keys(REDIRECT_PACKAGES).sort()).toEqual([
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
    for (const list of Object.values(REDIRECT_PACKAGES))
      expect(Array.isArray(list)).toBe(true)
  })

  it('redirects each path once, from an exact path', () => {
    const froms = REDIRECTS.map((r) => r.from)
    expect(new Set(froms).size).toBe(froms.length)
    for (const from of froms)
      expect(from).toMatch(/^\/(?:[^/?#]+(?:\/[^/?#]+)*)?$/)
  })

  it('sends fixed redirects to a path on this site, never to another redirect', () => {
    const froms = new Set(REDIRECTS.map((r) => r.from))
    for (const r of REDIRECTS) {
      if (typeof r.to !== 'string') continue
      expect(r.to, r.from).toMatch(/^\/(?!\/)/)
      expect(froms.has(new URL(r.to, 'https://q.test').pathname), r.from).toBe(
        false
      )
    }
  })
})

describe('the lookup', () => {
  const table: Redirect[] = [
    { from: '/library', to: '/shelf' },
    { from: '/login', to: '/signin', keepQuery: true },
    {
      from: '/write',
      to: (url) => {
        const id = url.searchParams.get('id')
        return id ? `/write/${encodeURIComponent(id)}` : null
      },
    },
    { from: '/away', to: 'https://elsewhere.test/' },
  ]
  const lookup = makeRedirector(table)
  const at = (path: string) =>
    lookup(new URL(path, 'https://q.test'))?.toString() ?? null

  it('answers an exact path, with or without a trailing slash', () => {
    expect(at('/library')).toBe('https://q.test/shelf')
    expect(at('/library/')).toBe('https://q.test/shelf')
    expect(at('/library/kept')).toBeNull()
  })

  it('keeps the query only when asked', () => {
    expect(at('/login?next=%2Fshelf')).toBe(
      'https://q.test/signin?next=%2Fshelf'
    )
    expect(at('/library?x=1')).toBe('https://q.test/shelf')
  })

  it('lets a function decide per request', () => {
    expect(at('/write?id=abc')).toBe('https://q.test/write/abc')
    expect(at('/write')).toBeNull()
  })

  it('never sends a reader to another site', () => {
    expect(at('/away')).toBeNull()
  })
})
