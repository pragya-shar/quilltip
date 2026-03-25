/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../schema'
import {
  generateUniqueArticleSlugForAuthor,
  isPlaceholderArticleSlug,
  slugifyArticleTitle,
} from './articleSlug'

const modules = import.meta.glob(['../**/*.ts', '!../**/*.test.ts'])

const emptyDoc = { type: 'doc', content: [] }

describe('slugifyArticleTitle', () => {
  it('slugifies and truncates', () => {
    expect(slugifyArticleTitle('ENG 59')).toBe('eng-59')
    expect(slugifyArticleTitle('  Hello   World  ')).toBe('hello-world')
  })
})

describe('isPlaceholderArticleSlug', () => {
  it('detects placeholders', () => {
    expect(isPlaceholderArticleSlug('untitled')).toBe(true)
    expect(isPlaceholderArticleSlug('untitled-1774253989982')).toBe(true)
    expect(isPlaceholderArticleSlug('article-1774253989982')).toBe(true)
  })

  it('rejects non-placeholders', () => {
    expect(isPlaceholderArticleSlug('eng-59')).toBe(false)
    expect(isPlaceholderArticleSlug('article-42')).toBe(false)
    expect(isPlaceholderArticleSlug('untitled-story')).toBe(false)
  })
})

describe('generateUniqueArticleSlugForAuthor', () => {
  it('returns base slug when no other article uses it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      const userId = await ctx.db.insert('users', {
        email: 'a@x.test',
        username: 'writer1',
        createdAt: now,
        updatedAt: now,
      })
      const slug = await generateUniqueArticleSlugForAuthor(ctx, {
        title: 'ENG 59',
        authorId: userId,
      })
      expect(slug).toBe('eng-59')
    })
  })

  it('appends suffix when another article by same author has the slug', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      const userId = await ctx.db.insert('users', {
        email: 'b@x.test',
        username: 'writer2',
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('articles', {
        slug: 'same-title',
        title: 'Same Title',
        content: emptyDoc,
        published: false,
        authorId: userId,
        authorUsername: 'writer2',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
      const slug = await generateUniqueArticleSlugForAuthor(ctx, {
        title: 'Same Title',
        authorId: userId,
      })
      expect(slug.startsWith('same-title-')).toBe(true)
      expect(slug.length).toBeGreaterThan('same-title'.length)
    })
  })

  it('allows slug matching excluded article id (no false self-collision)', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const now = Date.now()
      const userId = await ctx.db.insert('users', {
        email: 'c@x.test',
        username: 'writer3',
        createdAt: now,
        updatedAt: now,
      })
      const articleId = await ctx.db.insert('articles', {
        slug: 'untitled',
        title: 'Untitled',
        content: emptyDoc,
        published: false,
        authorId: userId,
        authorUsername: 'writer3',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
      const slug = await generateUniqueArticleSlugForAuthor(ctx, {
        title: 'ENG 84',
        authorId: userId,
        excludeArticleId: articleId,
      })
      expect(slug).toBe('eng-84')
    })
  })
})
