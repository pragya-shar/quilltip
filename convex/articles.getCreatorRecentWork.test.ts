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

describe('getCreatorRecentWork', () => {
  it('declares an author updatedAt index for bounded recent-work reads', () => {
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
  })

  it('uses the author updatedAt index without collecting every author article', () => {
    const source = recentWorkSource()

    expect(source).toContain(".withIndex('by_author_updated_at'")
    expect(source).toContain('.take(limit)')
    expect(source).not.toContain('.collect()')
    expect(source).not.toContain('.sort(')
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
})
