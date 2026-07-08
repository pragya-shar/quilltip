/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import type { Id } from './_generated/dataModel'
import { MIN_LISTING_EXCERPT_CHARS } from './lib/articleListingReady'

const docWithText = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Hello world' }],
    },
  ],
}

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])
const listingExcerpt = 'a'.repeat(MIN_LISTING_EXCERPT_CHARS)
const authorWallet = 'GTITLEAUTHORRECEIVINGWALLET'

async function drainScheduler(t: ReturnType<typeof convexTest>) {
  await new Promise((resolve) => setTimeout(resolve, 50))
  await t.finishAllScheduledFunctions(() => {})
  await new Promise((resolve) => setTimeout(resolve, 50))
  await t.finishAllScheduledFunctions(() => {})
}

async function seedAuthor(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const userId = await ctx.db.insert('users', {
      email: 'writer@x.test',
      username: 'writer',
      stellarAddress: authorWallet,
      createdAt: now,
      updatedAt: now,
    })
    return { userId, now }
  })
}

describe('publish title validation', () => {
  it('rejects publishArticle when draft title is Untitled', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthor(t)
    const asAuthor = t.withIdentity({ subject: userId })

    const draftId = await asAuthor.mutation(api.articles.saveDraft, {
      title: 'Untitled',
      content: docWithText,
    })

    await expect(
      asAuthor.mutation(api.articles.publishArticle, {
        id: draftId as Id<'articles'>,
      })
    ).rejects.toThrow('Cannot publish: add a title before publishing')
  })

  it('rejects publishArticle when title is shorter than 3 characters', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthor(t)
    const asAuthor = t.withIdentity({ subject: userId })

    const draftId = await asAuthor.mutation(api.articles.saveDraft, {
      title: 'Hi',
      content: docWithText,
    })

    await expect(
      asAuthor.mutation(api.articles.publishArticle, {
        id: draftId as Id<'articles'>,
      })
    ).rejects.toThrow('Cannot publish: add a title before publishing')
  })

  it('rejects createArticle with published true when title is Untitled', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthor(t)
    const asAuthor = t.withIdentity({ subject: userId })

    await expect(
      asAuthor.mutation(api.articles.createArticle, {
        title: 'Untitled',
        content: docWithText,
        published: true,
      })
    ).rejects.toThrow('Cannot publish: add a title before publishing')
  })

  it('publishes a draft with a real title and lists it publicly', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthor(t)
    const asAuthor = t.withIdentity({ subject: userId })

    const draftId = await asAuthor.mutation(api.articles.saveDraft, {
      title: 'My meaningful post',
      excerpt: listingExcerpt,
      content: docWithText,
    })

    await asAuthor.mutation(api.articles.publishArticle, {
      id: draftId as Id<'articles'>,
    })
    await drainScheduler(t)

    const listed = await t.query(api.articles.listArticles, {
      page: 1,
      limit: 10,
    })
    expect(listed.total).toBe(1)
    expect(listed.articles[0]?.title).toBe('My meaningful post')
  })

  it('unpublishes existing public articles with placeholder titles', async () => {
    const t = convexTest(schema, modules)
    const { userId, now } = await seedAuthor(t)

    const articleId = await t.run(async (ctx) => {
      return await ctx.db.insert('articles', {
        slug: 'untitled',
        title: 'Untitled',
        content: docWithText,
        published: true,
        publishedAt: now,
        authorId: userId,
        authorUsername: 'writer',
        tags: [],
        searchContent: 'Untitled',
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { articleCount: 1 })
    })

    const result = await t.mutation(
      internal.articles.unpublishArticlesWithPlaceholderTitles,
      {}
    )
    expect(result.updated).toBe(1)

    const article = await t.run(async (ctx) => ctx.db.get(articleId))
    expect(article?.published).toBe(false)
    expect(article?.publishedAt).toBeUndefined()

    const user = await t.run(async (ctx) => ctx.db.get(userId))
    expect(user?.articleCount).toBe(0)

    const listed = await t.query(api.articles.listArticles, {
      page: 1,
      limit: 10,
    })
    expect(listed.total).toBe(0)
  })
})
