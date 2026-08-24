/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import { getArticleHighlights } from './highlights'
import schema from './schema'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])
const emptyDoc = { type: 'doc', content: [] }

async function seedHighlights(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const ownerId = await ctx.db.insert('users', {
      email: 'owner@example.test',
      username: 'owner',
      createdAt: now,
      updatedAt: now,
    })
    const otherUserId = await ctx.db.insert('users', {
      email: 'other@example.test',
      username: 'other',
      createdAt: now,
      updatedAt: now,
    })
    const articleId = await ctx.db.insert('articles', {
      slug: 'privacy-test',
      title: 'Privacy test',
      content: emptyDoc,
      published: true,
      publishedAt: now,
      authorId: otherUserId,
      authorUsername: 'other',
      tags: [],
      viewCount: 0,
      highlightCount: 2,
      tipCount: 0,
      totalTipsUsd: 0,
      createdAt: now,
      updatedAt: now,
    })

    const base = {
      articleId,
      userId: ownerId,
      articleTitle: 'Privacy test',
      articleSlug: 'privacy-test',
      articleAuthor: 'other',
      userName: 'Owner',
      text: 'Selected passage',
      startOffset: 0,
      endOffset: 16,
      startContainerPath: '0',
      endContainerPath: '0',
      color: 'yellow',
      createdAt: now,
      updatedAt: now,
    }

    await ctx.db.insert('highlights', {
      ...base,
      highlightId: 'public-highlight',
      note: 'Public note',
      isPublic: true,
    })
    await ctx.db.insert('highlights', {
      ...base,
      highlightId: 'private-highlight',
      note: 'Private note',
      isPublic: false,
    })

    return { articleId, ownerId, otherUserId }
  })
}

describe('highlight query privacy', () => {
  it('uses an article-scoped index for the signed-in readers private highlights', async () => {
    const indexUses: Array<{
      index: string
      clauses: Array<[field: string, value: unknown]>
    }> = []
    const articleId = 'articles:article-1'
    const ownerId = 'users:owner-1'
    const db = {
      query: () => ({
        withIndex: (
          index: string,
          buildRange: (range: {
            eq: (field: string, value: unknown) => unknown
          }) => unknown
        ) => {
          const clauses: Array<[string, unknown]> = []
          const range = {
            eq(field: string, value: unknown) {
              clauses.push([field, value])
              return range
            },
          }
          buildRange(range)
          indexUses.push({ index, clauses })
          return { collect: async () => [] }
        },
      }),
    }
    const handler = (
      getArticleHighlights as unknown as {
        _handler: (
          ctx: unknown,
          args: { articleId: string }
        ) => Promise<unknown>
      }
    )._handler

    await handler(
      {
        auth: {
          getUserIdentity: async () => ({ subject: ownerId }),
        },
        db,
      },
      { articleId }
    )

    expect(indexUses).toEqual([
      {
        index: 'by_article_public',
        clauses: [
          ['articleId', articleId],
          ['isPublic', true],
        ],
      },
      {
        index: 'by_article_user_public',
        clauses: [
          ['articleId', articleId],
          ['userId', ownerId],
          ['isPublic', false],
        ],
      },
    ])
  })

  it('returns only public article highlights to signed-out and unrelated readers', async () => {
    const t = convexTest(schema, modules)
    const { articleId, otherUserId } = await seedHighlights(t)

    const signedOut = await t.query(api.highlights.getArticleHighlights, {
      articleId,
    })
    const unrelated = await t
      .withIdentity({ subject: otherUserId })
      .query(api.highlights.getArticleHighlights, { articleId })
    const explicitPrivateRequest = await t
      .withIdentity({ subject: otherUserId })
      .query(api.highlights.getArticleHighlights, {
        articleId,
        isPublic: false,
      })

    expect(signedOut.map((highlight) => highlight.highlightId)).toEqual([
      'public-highlight',
    ])
    expect(unrelated.map((highlight) => highlight.highlightId)).toEqual([
      'public-highlight',
    ])
    expect(explicitPrivateRequest).toEqual([])
    expect(JSON.stringify(signedOut)).not.toContain('Private note')
    expect(JSON.stringify(unrelated)).not.toContain('Private note')
  })

  it("includes the signed-in owner's private highlights on the article", async () => {
    const t = convexTest(schema, modules)
    const { articleId, ownerId } = await seedHighlights(t)

    const highlights = await t
      .withIdentity({ subject: ownerId })
      .query(api.highlights.getArticleHighlights, { articleId })

    expect(highlights.map((highlight) => highlight.highlightId).sort()).toEqual(
      ['private-highlight', 'public-highlight']
    )
    expect(JSON.stringify(highlights)).toContain('Private note')
  })

  it('returns private user history only when the requested user is the caller', async () => {
    const t = convexTest(schema, modules)
    const { ownerId, otherUserId } = await seedHighlights(t)

    const publicHistory = await t
      .withIdentity({ subject: otherUserId })
      .query(api.highlights.getUserHighlights, { userId: ownerId })
    const ownerHistory = await t
      .withIdentity({ subject: ownerId })
      .query(api.highlights.getUserHighlights, { userId: ownerId })
    const publicHistoryWithTips = await t
      .withIdentity({ subject: otherUserId })
      .query(api.highlights.getUserHighlightsWithTips, { userId: ownerId })

    expect(publicHistory.map((highlight) => highlight.highlightId)).toEqual([
      'public-highlight',
    ])
    expect(
      ownerHistory.map((highlight) => highlight.highlightId).sort()
    ).toEqual(['private-highlight', 'public-highlight'])
    expect(
      publicHistoryWithTips.map((highlight) => highlight.highlightId)
    ).toEqual(['public-highlight'])
  })
})
