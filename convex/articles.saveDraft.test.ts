/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import type { Id } from './_generated/dataModel'

const emptyDoc = { type: 'doc', content: [] }

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

async function seedAuthor(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const userId = await ctx.db.insert('users', {
      email: 'writer@x.test',
      username: 'writer',
      createdAt: now,
      updatedAt: now,
    })
    return { userId, now }
  })
}

describe('saveDraft writerNotes', () => {
  it('persists writerNotes and returns them to the author via getArticleById', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthor(t)
    const asAuthor = t.withIdentity({ subject: userId })

    const draftId = await asAuthor.mutation(api.articles.saveDraft, {
      title: 'Draft with notes',
      content: emptyDoc,
      writerNotes: 'ENG-177 private note',
    })

    const loaded = await asAuthor.query(api.articles.getArticleById, {
      id: draftId,
    })
    expect(loaded?.writerNotes).toBe('ENG-177 private note')
  })

  it('omits writerNotes from getArticleBySlug for published articles', async () => {
    const t = convexTest(schema, modules)
    const { userId, now } = await seedAuthor(t)
    const asAuthor = t.withIdentity({ subject: userId })

    const articleId = await t.run(async (ctx) => {
      return await ctx.db.insert('articles', {
        slug: 'published-with-notes',
        title: 'Published',
        content: emptyDoc,
        writerNotes: 'Secret planning',
        published: true,
        publishedAt: now,
        authorId: userId,
        authorUsername: 'writer',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
    })

    const bySlug = await t.query(api.articles.getArticleBySlug, {
      username: 'writer',
      slug: 'published-with-notes',
    })
    expect(bySlug).not.toBeNull()
    expect(bySlug).not.toHaveProperty('writerNotes')

    const byIdAsAuthor = await asAuthor.query(api.articles.getArticleById, {
      id: articleId as Id<'articles'>,
    })
    expect(byIdAsAuthor?.writerNotes).toBe('Secret planning')
  })

  it('rejects writerNotes longer than 5000 characters', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthor(t)
    const asAuthor = t.withIdentity({ subject: userId })

    await expect(
      asAuthor.mutation(api.articles.saveDraft, {
        title: 'Too long notes',
        content: emptyDoc,
        writerNotes: 'x'.repeat(5001),
      })
    ).rejects.toThrow('Writer notes must be 5000 characters or less')
  })
})
