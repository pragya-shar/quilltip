// @vitest-environment node
/**
 * Today never prefetches a page the old layout still serves, or a writer or
 * an article behind the route check, on render: its links go through the
 * shell's AppLink (lib/routing/legacyRoutes.ts decides). Here Today is
 * rendered against the real route tree and every link it draws is checked;
 * scripts/system/legacy-routes.test.ts holds every surface to AppLink.
 */
import path from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, expect, test, vi } from 'vitest'
import { legacyRouteTree } from '@/lib/routing/legacyRouteTree'

// next/link as a plain link that writes down the prefetch it was given.
vi.mock('next/link', () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: {
    href: string
    prefetch?: boolean
    children: ReactNode
  }) =>
    createElement(
      'a',
      { ...rest, href, 'data-prefetch': String(prefetch) },
      children
    ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: () => {} }),
}))

const root = path.resolve(__dirname, '../..')
const tree = legacyRouteTree(path.join(root, 'app/(legacy)'))

let markup = ''
beforeAll(async () => {
  // The shell reads the route tree from the build's environment.
  vi.stubEnv('NEXT_PUBLIC_LEGACY_ROUTES', JSON.stringify(tree))
  vi.resetModules()
  const { TodayOpening } = await import('@/components/today/TodayOpening')
  const { MoreToday } = await import('@/components/today/MoreToday')
  const author = { name: 'Tomás Reyes', username: 'tomas' }
  markup = renderToStaticMarkup(
    createElement('div', null, [
      createElement(TodayOpening, {
        key: 'opening',
        article: {
          articleId: 'k57d0z3h2q8n4m6r9t1v5w7x2y3z4a6b',
          title: 'What the ledger kept',
          href: '/tomas/what-the-ledger-kept',
          readMoreHref: '/tomas/what-the-ledger-kept#s-7-0',
          author,
          publishedAt: Date.UTC(2026, 10, 26),
          readMinutes: 6,
          paragraphs: ['One.', 'Two.'],
          continues: true,
          peek: 'Three.',
          minutesLeft: 4,
        } as never,
      }),
      createElement(MoreToday, {
        key: 'more',
        items: [
          {
            articleId: 'k97x8w7v6t5s4r3q2p1n0m9j8h7g6f5e',
            title: 'Noon',
            href: '/ama/noon',
            first: 'A city that sleeps at noon.',
            author: { name: 'Ama', username: 'ama' },
            readMinutes: 3,
          },
        ] as never,
      }),
    ])
  )
})

test('the old layout still serves writers and the desk, so the rule applies', () => {
  expect(tree.writer).toBe(true)
  expect(tree.segments).toContain('write')
})

test('a rendered Today prefetches no page the old layout serves', () => {
  const links = [...markup.matchAll(/<a\b[^>]*>/g)].map((m) => m[0])
  const pages = links
    .map((tag) => ({
      href: /href="([^"]*)"/.exec(tag)?.[1] ?? '',
      prefetch: /data-prefetch="([^"]*)"/.exec(tag)?.[1] ?? 'none',
    }))
    .filter((link) => link.href.startsWith('/'))
  // The writer, Read more, and the article in More to read.
  expect(pages.map((p) => p.href)).toEqual(
    expect.arrayContaining([
      '/tomas',
      '/tomas/what-the-ledger-kept#s-7-0',
      '/ama/noon',
    ])
  )
  for (const link of pages) expect(link.prefetch, link.href).toBe('false')
})
