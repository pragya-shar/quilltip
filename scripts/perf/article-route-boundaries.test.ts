import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

/**
 * The article route's not-found boundaries. A not-found file in a segment
 * wraps every route below it, and its client code then loads with each of
 * them. `[username]` has no layout, so a not-found file there wrapped the
 * article route too, and every article page loaded the writer screen (with
 * its own copy of the header) as a second client entry. The writer page and
 * its not-found file therefore sit in the route group `(writer)`.
 */

const APP = fileURLToPath(new URL('../../app', import.meta.url))
const has = (...segments: string[]) => existsSync(join(APP, ...segments))

/** not-found files on the way from app/ down to a segment path. */
function notFoundFilesAbove(segments: string[]): string[] {
  const found: string[] = []
  for (let depth = 0; depth <= segments.length; depth++) {
    const dir = segments.slice(0, depth)
    for (const name of ['not-found.tsx', 'not-found.ts', 'not-found.jsx'])
      if (has(...dir, name)) found.push([...dir, name].join('/'))
  }
  return found
}

describe('the article route and the writer not-found screen', () => {
  it('keeps no not-found file directly in app/[username]/', () => {
    expect(has('[username]', 'not-found.tsx')).toBe(false)
  })

  it('keeps the writer page and its not-found file together in (writer)', () => {
    expect(has('[username]', '(writer)', 'page.tsx')).toBe(true)
    expect(has('[username]', '(writer)', 'not-found.tsx')).toBe(true)
    expect(has('[username]', 'page.tsx')).toBe(false)
  })

  it("puts only the root's and the article's own not-found on the article route", () => {
    expect(notFoundFilesAbove(['[username]', '[slug]'])).toEqual([
      'not-found.tsx',
      '[username]/[slug]/not-found.tsx',
    ])
  })

  it('keeps the article route outside every route group under app/[username]/', () => {
    const groups = readdirSync(join(APP, '[username]')).filter(
      (name) =>
        /^\(.*\)$/.test(name) &&
        statSync(join(APP, '[username]', name)).isDirectory()
    )
    for (const group of groups)
      // A group holds its own pages; it must not hold the article route.
      expect(has('[username]', group, '[slug]'), group).toBe(false)
  })
})
