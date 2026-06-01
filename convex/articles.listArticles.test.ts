/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import {
  buildSearchContent,
  replaceTagLinksForArticle,
} from './lib/articleListing'

const emptyDoc = { type: 'doc', content: [] }

/** Meets MIN_LISTING_EXCERPT_CHARS for public discovery lists */
const listingExcerpt = 'A valid excerpt for public listing.'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

describe('listArticles', () => {
  it('filters by tag using articleTagLinks', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      const u = await ctx.db.insert('users', {
        email: 'tag@x.test',
        username: 'tagwriter',
        createdAt: now,
        updatedAt: now,
      })
      const a1 = await ctx.db.insert('articles', {
        slug: 'one',
        title: 'One',
        excerpt: listingExcerpt,
        content: emptyDoc,
        published: true,
        publishedAt: now,
        authorId: u,
        authorUsername: 'tagwriter',
        tags: ['rust'],
        searchContent: 'One',
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
      const a2 = await ctx.db.insert('articles', {
        slug: 'two',
        title: 'Two',
        content: emptyDoc,
        published: true,
        publishedAt: now + 1,
        authorId: u,
        authorUsername: 'tagwriter',
        tags: ['go'],
        searchContent: 'Two',
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
      const doc1 = await ctx.db.get(a1)
      const doc2 = await ctx.db.get(a2)
      if (doc1) await replaceTagLinksForArticle(ctx, doc1)
      if (doc2) await replaceTagLinksForArticle(ctx, doc2)

      const res = await ctx.runQuery(api.articles.listArticles, {
        tag: 'rust',
        page: 1,
        limit: 10,
      })
      expect(res.total).toBe(1)
      expect(res.articles).toHaveLength(1)
      expect(res.articles[0]!._id).toBe(a1)
    })
  })

  it('paginates tag filter', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      const u = await ctx.db.insert('users', {
        email: 'page@x.test',
        username: 'pagewriter',
        createdAt: now,
        updatedAt: now,
      })
      for (let i = 0; i < 3; i++) {
        const id = await ctx.db.insert('articles', {
          slug: `p-${i}`,
          title: `P${i}`,
          excerpt: listingExcerpt,
          content: emptyDoc,
          published: true,
          publishedAt: now + i * 1000,
          authorId: u,
          authorUsername: 'pagewriter',
          tags: ['x'],
          searchContent: `P${i}`,
          viewCount: 0,
          highlightCount: 0,
          tipCount: 0,
          totalTipsUsd: 0,
          createdAt: now,
          updatedAt: now,
        })
        const d = await ctx.db.get(id)
        if (d) await replaceTagLinksForArticle(ctx, d)
      }

      const p1 = await ctx.runQuery(api.articles.listArticles, {
        tag: 'x',
        page: 1,
        limit: 2,
      })
      const p2 = await ctx.runQuery(api.articles.listArticles, {
        tag: 'x',
        page: 2,
        limit: 2,
      })
      expect(p1.total).toBe(3)
      expect(p1.articles).toHaveLength(2)
      expect(p2.articles).toHaveLength(1)
      const ids1 = p1.articles.map((a) => a._id)
      const ids2 = p2.articles.map((a) => a._id)
      expect(new Set([...ids1, ...ids2]).size).toBe(3)
    })
  })

  it('filters by search via search_listing and sorts by publishedAt desc', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      const u = await ctx.db.insert('users', {
        email: 's@x.test',
        username: 'swriter',
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('articles', {
        slug: 'old',
        title: 'Banana guide',
        excerpt: listingExcerpt,
        content: emptyDoc,
        published: true,
        publishedAt: now,
        authorId: u,
        authorUsername: 'swriter',
        tags: [],
        searchContent: 'Banana guide',
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('articles', {
        slug: 'new',
        title: 'Fresh banana',
        excerpt: listingExcerpt,
        content: emptyDoc,
        published: true,
        publishedAt: now + 99999,
        authorId: u,
        authorUsername: 'swriter',
        tags: [],
        searchContent: 'Fresh banana',
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })

      const res = await ctx.runQuery(api.articles.listArticles, {
        search: 'banana',
        page: 1,
        limit: 10,
      })
      expect(res.total).toBe(2)
      expect(res.articles[0]!.title).toBe('Fresh banana')
      expect(res.articles[1]!.title).toBe('Banana guide')
    })
  })

  it('matches search against tag text included in searchContent', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      const u = await ctx.db.insert('users', {
        email: 'tagsearch@x.test',
        username: 'tagsearcher',
        createdAt: now,
        updatedAt: now,
      })
      const indexed = buildSearchContent('Only Title', undefined, {
        tags: ['uniqueTagToken'],
      })
      await ctx.db.insert('articles', {
        slug: 'tagged',
        title: 'Only Title',
        excerpt: listingExcerpt,
        content: emptyDoc,
        published: true,
        publishedAt: now,
        authorId: u,
        authorUsername: 'tagsearcher',
        tags: ['uniqueTagToken'],
        searchContent: indexed,
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })

      const res = await ctx.runQuery(api.articles.listArticles, {
        search: 'uniqueTagToken',
        page: 1,
        limit: 10,
      })
      expect(res.total).toBe(1)
      expect(res.articles[0]!.title).toBe('Only Title')
    })
  })

  it('filters by author and tag together', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      const u1 = await ctx.db.insert('users', {
        email: 'a1@x.test',
        username: 'alice',
        createdAt: now,
        updatedAt: now,
      })
      const u2 = await ctx.db.insert('users', {
        email: 'a2@x.test',
        username: 'bob',
        createdAt: now,
        updatedAt: now,
      })
      const id = await ctx.db.insert('articles', {
        slug: 'at',
        title: 'T',
        excerpt: listingExcerpt,
        content: emptyDoc,
        published: true,
        publishedAt: now,
        authorId: u1,
        authorUsername: 'alice',
        tags: ['shared'],
        searchContent: 'T',
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
      const idB = await ctx.db.insert('articles', {
        slug: 'bt',
        title: 'T2',
        excerpt: listingExcerpt,
        content: emptyDoc,
        published: true,
        publishedAt: now,
        authorId: u2,
        authorUsername: 'bob',
        tags: ['shared'],
        searchContent: 'T2',
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
      const d1 = await ctx.db.get(id)
      const d2 = await ctx.db.get(idB)
      if (d1) await replaceTagLinksForArticle(ctx, d1)
      if (d2) await replaceTagLinksForArticle(ctx, d2)

      const res = await ctx.runQuery(api.articles.listArticles, {
        author: 'alice',
        tag: 'shared',
        page: 1,
        limit: 10,
      })
      expect(res.total).toBe(1)
      expect(res.articles[0]!.authorUsername).toBe('alice')
    })
  })

  it('excludes incomplete published articles from default listing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      const u = await ctx.db.insert('users', {
        email: 'ready@x.test',
        username: 'readywriter',
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('articles', {
        slug: 'untitled',
        title: 'Untitled',
        content: emptyDoc,
        published: true,
        publishedAt: now,
        authorId: u,
        authorUsername: 'readywriter',
        tags: [],
        searchContent: 'Untitled',
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
      const readyId = await ctx.db.insert('articles', {
        slug: 'complete',
        title: 'Complete Article',
        excerpt: listingExcerpt,
        content: emptyDoc,
        published: true,
        publishedAt: now + 1,
        authorId: u,
        authorUsername: 'readywriter',
        tags: [],
        searchContent: 'Complete Article',
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })

      const res = await ctx.runQuery(api.articles.listArticles, {
        page: 1,
        limit: 10,
      })
      expect(res.total).toBe(1)
      expect(res.articles).toHaveLength(1)
      expect(res.articles[0]!._id).toBe(readyId)
      expect(res.articles[0]!.title).toBe('Complete Article')
    })
  })

  it('finds articles by tag via search when searchContent is stale', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      const u = await ctx.db.insert('users', {
        email: 'stale@x.test',
        username: 'stalewriter',
        createdAt: now,
        updatedAt: now,
      })
      const id = await ctx.db.insert('articles', {
        slug: 'stale-tag',
        title: 'Stale Tag Article',
        excerpt: listingExcerpt,
        content: emptyDoc,
        published: true,
        publishedAt: now,
        authorId: u,
        authorUsername: 'stalewriter',
        tags: ['visibleTag'],
        searchContent: 'Stale Tag Article',
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
      const doc = await ctx.db.get(id)
      if (doc) await replaceTagLinksForArticle(ctx, doc)

      const res = await ctx.runQuery(api.articles.listArticles, {
        search: 'visibleTag',
        page: 1,
        limit: 10,
      })
      expect(res.total).toBe(1)
      expect(res.articles[0]!._id).toBe(id)
    })
  })

  it('finds articles by full title when searchContent matches title only', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      const u = await ctx.db.insert('users', {
        email: 'title@x.test',
        username: 'titlewriter',
        createdAt: now,
        updatedAt: now,
      })
      const fullTitle = 'My Complete Guide Title'
      await ctx.db.insert('articles', {
        slug: 'full-title',
        title: fullTitle,
        excerpt: listingExcerpt,
        content: emptyDoc,
        published: true,
        publishedAt: now,
        authorId: u,
        authorUsername: 'titlewriter',
        tags: [],
        searchContent: fullTitle,
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })

      const res = await ctx.runQuery(api.articles.listArticles, {
        search: fullTitle,
        page: 1,
        limit: 10,
      })
      expect(res.total).toBe(1)
      expect(res.articles[0]!.title).toBe(fullTitle)
    })
  })

  it('falls back to computed search content when FTS misses', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      const u = await ctx.db.insert('users', {
        email: 'fallback@x.test',
        username: 'fallbackwriter',
        createdAt: now,
        updatedAt: now,
      })
      const uniqueToken = 'fallbackUniqueBodyToken'
      const title = 'Fallback Search Article'
      await ctx.db.insert('articles', {
        slug: 'fallback',
        title,
        excerpt: listingExcerpt,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: uniqueToken }],
            },
          ],
        },
        published: true,
        publishedAt: now,
        authorId: u,
        authorUsername: 'fallbackwriter',
        tags: [],
        searchContent: undefined,
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })

      const res = await ctx.runQuery(api.articles.listArticles, {
        search: uniqueToken,
        page: 1,
        limit: 10,
      })
      expect(res.total).toBe(1)
      expect(res.articles[0]!.title).toBe(title)
    })
  })
})
