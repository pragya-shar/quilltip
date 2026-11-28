import { existsSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import {
  appRoutes,
  findUnflaggedLinks,
  HREF_PROP_FILES,
  KNOWN_UNFLAGGED,
  scan,
} from './link-prefetch-guard'

/**
 * #630: every Link to a public article or writer page turns prefetch off
 * (lib/articles/linkPrefetch.ts). This keeps it true when a new card or link
 * is added: the scan names the file and line of any unflagged one.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const routes = appRoutes(join(ROOT, 'app'))
const check = (source: string, file = 'components/x/Example.tsx') =>
  findUnflaggedLinks(file, source, routes).map(
    ({ line, href }) => `${line}: ${href}`
  )

describe('the link prefetch guard', () => {
  it('finds no unflagged article or writer link in app/ and components/', () => {
    const findings = scan(ROOT).map((f) => `${f.file}:${f.line} ${f.href}`)
    expect(findings, findings.join('\n')).toEqual([])
  })

  it('names files that still exist', () => {
    for (const file of [
      ...Object.keys(HREF_PROP_FILES),
      ...Object.keys(KNOWN_UNFLAGGED),
    ])
      expect(existsSync(join(ROOT, file)), file).toBe(true)
  })

  it('reads the app routes, route groups included', () => {
    for (const route of ['articles', 'settings', 'login', 'write'])
      expect(routes.has(route), route).toBe(true)
    expect(routes.has('[username]')).toBe(false)
  })

  it('finds an unflagged writer or article link, with its line', () => {
    const source = [
      "import Link from 'next/link'",
      'export function Card({ a }) {',
      '  return (',
      '    <Link href={`/${a.username}/${a.slug}`}>Read more</Link>',
      '  )',
      '}',
    ].join('\n')
    expect(check(source)).toEqual(['4: `/${a.username}/${a.slug}`'])
  })

  it.each([
    ['a literal writer path', '<Link href="/someone">x</Link>'],
    ['a member path', '<Link href={item.articleHref}>x</Link>'],
    ['a helper call', '<Link href={articleHref(b)}>x</Link>'],
    [
      'a template after a helper',
      '<Link href={`${articleHref(b)}?highlight=${id}`}>x</Link>',
    ],
    [
      'a const defined as a template',
      'const href = `/${a.username}`\n<Link href={href}>x</Link>',
    ],
    [
      'a function that returns a template',
      'function getWorkHref(i) {\n  return `/${i.authorUsername}/${i.slug}`\n}\n<Link href={getWorkHref(item)}>x</Link>',
    ],
  ])('treats %s as a public page', (_, source) => {
    expect(check(source)).toHaveLength(1)
  })

  it.each([
    ['an app route', '<Link href="/settings">x</Link>'],
    ['the articles list', '<Link href="/articles">x</Link>'],
    ['an editor link', '<Link href={`/write?id=${d._id}`}>x</Link>'],
    ['a hash link', '<Link href="#top">x</Link>'],
  ])('leaves %s alone', (_, source) => {
    expect(check(source)).toEqual([])
  })

  it('accepts the flag, also after an arrow function in the tag', () => {
    expect(
      check(
        '<Link href={`/${u}`} onClick={() => n > 0 && go()} prefetch={ARTICLE_LINK_PREFETCH}>x</Link>'
      )
    ).toEqual([])
    expect(
      check(
        '<Link href={`/${u}`} prefetch={draft ? null : ARTICLE_LINK_PREFETCH}>x</Link>'
      )
    ).toEqual([])
    expect(check('<Link href={`/${u}`} prefetch={false}>x</Link>')).toEqual([])
  })

  it('requires the flag on every non-literal href in a prop-fed file', () => {
    const file = Object.keys(HREF_PROP_FILES)[0]!
    expect(check('<Link href={href}>x</Link>', file)).toEqual(['1: href'])
    expect(check('<Link href="/settings">x</Link>', file)).toEqual([])
  })
})
