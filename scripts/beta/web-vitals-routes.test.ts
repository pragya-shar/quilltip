// @vitest-environment node
/**
 * Page kinds for every page in app/: a page with a fixed path is never
 * counted as an article, so a new two-segment page (like /settings/profile)
 * needs its first segment in the reserved list.
 */
import { readdirSync, statSync } from 'fs'
import path from 'path'
import { expect, test } from 'vitest'
import { webVitalRoute } from '../../lib/analytics/webVitals'

const APP = path.resolve(__dirname, '../../app')

/** URL segments of every page.tsx under app/, route groups removed. */
function pages(dir = APP, segments: string[] = []): string[][] {
  const found: string[][] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry.startsWith('_') || entry === 'api') continue
      const next = /^\(.*\)$/.test(entry) ? segments : [...segments, entry]
      found.push(...pages(full, next))
    } else if (entry === 'page.tsx') {
      found.push(segments)
    }
  }
  return found
}

test('the app has the pages this test expects', () => {
  const paths = pages().map((segments) => `/${segments.join('/')}`)
  expect(paths).toContain('/[username]/[slug]')
  expect(paths).toContain('/settings/profile')
})

test('every page with a fixed first segment is not an article', () => {
  const kinds: Record<string, string> = {}
  for (const segments of pages()) {
    if (segments.length === 0 || segments[0]!.startsWith('[')) continue
    const pathname = `/${segments
      .map((segment) => (segment.startsWith('[') ? 'sample' : segment))
      .join('/')}`
    kinds[pathname] = webVitalRoute(pathname)
  }
  const expected = Object.fromEntries(
    Object.keys(kinds).map((pathname) => [
      pathname,
      pathname === '/login'
        ? 'login'
        : pathname === '/articles'
          ? 'articles'
          : 'other',
    ])
  )
  expect(kinds).toEqual(expected)
})

test('the article route is an article, other writer paths are not', () => {
  expect(webVitalRoute('/sample-writer/sample-slug')).toBe('article')
  expect(webVitalRoute('/sample-writer')).toBe('other')
})
