/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import {
  STATIC_SITEMAP_PATHS,
  buildSitemap,
} from '../../lib/seo/sitemapEntries'

const modules = import.meta.glob('../../convex/**/*.ts')

test('sitemap data lists published articles only, under current usernames', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const writer = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'new-handle',
      createdAt: 1,
      updatedAt: 1,
    })
    const base = {
      content: {},
      authorId: writer,
      authorUsername: 'old-handle',
      createdAt: 1,
    }
    await ctx.db.insert('articles', {
      ...base,
      title: 'Out in the world',
      slug: 'out-in-the-world',
      published: true,
      publishedAt: 10,
      updatedAt: 20,
    })
    await ctx.db.insert('articles', {
      ...base,
      title: 'Still a draft',
      slug: 'still-a-draft',
      published: false,
      updatedAt: 30,
    })
  })

  expect(await t.query(api.articles.listSitemapEntries, {})).toEqual({
    articles: [
      { username: 'new-handle', slug: 'out-in-the-world', lastModified: 20 },
    ],
    writers: [{ username: 'new-handle', lastModified: 20 }],
  })
})

test('sitemap falls back to static public pages without data', () => {
  const urls = buildSitemap(null).map((entry) => entry.url)
  expect(urls).toHaveLength(STATIC_SITEMAP_PATHS.length)
  expect(urls).toContain('https://www.quilltip.me')
  expect(urls).toContain('https://www.quilltip.me/articles')
})

test('sitemap URLs are absolute and encoded', () => {
  const urls = buildSitemap({
    articles: [{ username: 'a b', slug: 'c/d', lastModified: 1 }],
    writers: [{ username: 'a b', lastModified: 1 }],
  }).map((entry) => entry.url)
  expect(urls).toContain('https://www.quilltip.me/a%20b')
  expect(urls).toContain('https://www.quilltip.me/a%20b/c%2Fd')
})
