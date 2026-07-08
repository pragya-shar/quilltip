/// <reference types="vite/client" />
import { readFileSync } from 'node:fs'
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const emptyDoc = { type: 'doc', content: [] }

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

function recentWorkSource() {
  const source = readFileSync(new URL('./articles.ts', import.meta.url), 'utf8')
  const start = source.indexOf('export const getCreatorRecentWork')
  const end = source.indexOf('// Create article', start)
  if (start === -1 || end === -1) {
    throw new Error('Could not locate getCreatorRecentWork source')
  }
  return source.slice(start, end)
}

function workspaceSummarySource() {
  const source = readFileSync(new URL('./articles.ts', import.meta.url), 'utf8')
  const start = source.indexOf('export const getCreatorWorkspaceSummary')
  const end = source.indexOf('// Create article', start)
  if (start === -1 || end === -1) {
    throw new Error('Could not locate getCreatorWorkspaceSummary source')
  }
  return source.slice(start, end)
}

describe('getCreatorRecentWork', () => {
  it('declares author indexes for bounded creator workspace reads', () => {
    const articlesTable = (
      schema as unknown as {
        tables: {
          articles: {
            indexes: { indexDescriptor: string; fields: string[] }[]
          }
        }
      }
    ).tables.articles

    expect(articlesTable.indexes).toContainEqual({
      indexDescriptor: 'by_author_updated_at',
      fields: ['authorId', 'updatedAt'],
    })
    expect(articlesTable.indexes).toContainEqual({
      indexDescriptor: 'by_author_published_updated_at',
      fields: ['authorId', 'published', 'updatedAt'],
    })
  })

  it('uses the author updatedAt index without collecting every author article', () => {
    const source = recentWorkSource()

    expect(source).toContain(".withIndex('by_author_updated_at'")
    expect(source).toContain('.take(limit)')
    expect(source).not.toContain('.collect()')
    expect(source).not.toContain('.sort(')
  })

  it('uses the published updatedAt index for the workspace draft summary', () => {
    const source = workspaceSummarySource()

    expect(source).toContain(".withIndex('by_author_published_updated_at'")
    expect(source).toContain(".eq('published', false)")
    expect(source).toContain('.first()')
    expect(source).not.toContain('.collect()')
  })

  it('returns the newest work for the signed-in creator only', async () => {
    const t = convexTest(schema, modules)
    const { authorId } = await t.run(async (ctx) => {
      const now = Date.now()
      const authorId = await ctx.db.insert('users', {
        email: 'writer@x.test',
        username: 'writer',
        createdAt: now,
        updatedAt: now,
      })
      const otherAuthorId = await ctx.db.insert('users', {
        email: 'other@x.test',
        username: 'other',
        createdAt: now,
        updatedAt: now,
      })

      await ctx.db.insert('articles', {
        slug: 'old-draft',
        title: 'Old Draft',
        content: emptyDoc,
        published: false,
        authorId,
        authorUsername: 'writer',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('articles', {
        slug: 'new-published',
        title: 'New Published',
        content: emptyDoc,
        published: true,
        publishedAt: now + 3_000,
        authorId,
        authorUsername: 'writer',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now + 3_000,
      })
      await ctx.db.insert('articles', {
        slug: 'middle-draft',
        title: 'Middle Draft',
        content: emptyDoc,
        published: false,
        authorId,
        authorUsername: 'writer',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now + 2_000,
      })
      await ctx.db.insert('articles', {
        slug: 'other-newest',
        title: 'Other Newest',
        content: emptyDoc,
        published: true,
        publishedAt: now + 4_000,
        authorId: otherAuthorId,
        authorUsername: 'other',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now + 4_000,
      })

      return { authorId }
    })

    const recent = await t
      .withIdentity({ subject: authorId })
      .query(api.articles.getCreatorRecentWork, { limit: 2 })

    expect(recent.map((article) => article.title)).toEqual([
      'New Published',
      'Middle Draft',
    ])
    expect(recent).toHaveLength(2)
    expect(recent.every((article) => article.authorUsername === 'writer')).toBe(
      true
    )
  })

  it('returns the newest draft summary without loading every draft', async () => {
    const t = convexTest(schema, modules)
    const { authorId, olderDraft, newestDraft } = await t.run(async (ctx) => {
      const now = Date.now()
      const authorId = await ctx.db.insert('users', {
        email: 'summary@x.test',
        username: 'summary',
        createdAt: now,
        updatedAt: now,
      })

      await ctx.db.insert('articles', {
        slug: 'published-newer',
        title: 'Published Newer',
        content: emptyDoc,
        published: true,
        publishedAt: now + 3_000,
        authorId,
        authorUsername: 'summary',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now + 3_000,
      })
      const olderDraft = await ctx.db.insert('articles', {
        slug: 'older-draft',
        title: 'Older Draft',
        content: emptyDoc,
        published: false,
        authorId,
        authorUsername: 'summary',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now + 1_000,
      })
      const newestDraft = await ctx.db.insert('articles', {
        slug: 'newest-draft',
        title: 'Newest Draft',
        content: emptyDoc,
        published: false,
        authorId,
        authorUsername: 'summary',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now + 2_000,
      })

      return { authorId, olderDraft, newestDraft }
    })

    const summary = await t
      .withIdentity({ subject: authorId })
      .query(api.articles.getCreatorWorkspaceSummary, {})

    expect(summary.hasDrafts).toBe(true)
    expect(summary.mostRecentDraft?._id).toBe(newestDraft)
    expect(summary.mostRecentDraft?._id).not.toBe(olderDraft)
    expect(summary.mostRecentDraft?.title).toBe('Newest Draft')
  })
})
