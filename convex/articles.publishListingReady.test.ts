/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import type { Id } from './_generated/dataModel'

const docWithBody = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Hello body' }],
    },
  ],
}

const listingExcerpt = 'A readable preview.'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])
const authorWallet = 'GAUTHORRECEIVINGWALLET'

async function seedAuthor(
  t: ReturnType<typeof convexTest>,
  stellarAddress: string | null = authorWallet
) {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const userId = await ctx.db.insert('users', {
      email: 'pub@x.test',
      username: 'pubwriter',
      ...(stellarAddress ? { stellarAddress } : {}),
      createdAt: now,
      updatedAt: now,
    })
    return { userId, now }
  })
}

describe('publish listing readiness', () => {
  it('rejects publishArticle when title is Untitled', async () => {
    const t = convexTest(schema, modules)
    const { userId, now } = await seedAuthor(t)
    const asAuthor = t.withIdentity({ subject: userId })

    const articleId = await t.run(async (ctx) => {
      return await ctx.db.insert('articles', {
        slug: 'untitled-draft',
        title: 'Untitled',
        excerpt: listingExcerpt,
        content: docWithBody,
        published: false,
        authorId: userId,
        authorUsername: 'pubwriter',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
    })

    await expect(
      asAuthor.mutation(api.articles.publishArticle, {
        id: articleId as Id<'articles'>,
      })
    ).rejects.toThrow(/title/)
  })

  it.each(['', 'short'])(
    'publishes with an optional subtitle: %j',
    async (excerpt) => {
      const t = convexTest(schema, modules)
      const { userId, now } = await seedAuthor(t)
      const asAuthor = t.withIdentity({ subject: userId })

      const articleId = await t.run(async (ctx) => {
        return await ctx.db.insert('articles', {
          slug: 'short-excerpt',
          title: 'Real Title',
          excerpt,
          arweaveStatus: 'verified',
          content: docWithBody,
          published: false,
          authorId: userId,
          authorUsername: 'pubwriter',
          tags: [],
          viewCount: 0,
          highlightCount: 0,
          tipCount: 0,
          totalTipsUsd: 0,
          createdAt: now,
          updatedAt: now,
        })
      })

      await asAuthor.mutation(api.articles.publishArticle, {
        id: articleId as Id<'articles'>,
      })
      const listed = await t.query(api.articles.listArticles, {})
      expect(listed.articles.map((a) => a._id)).toContain(articleId)
      expect((await t.run(async (ctx) => ctx.db.get(articleId)))?.excerpt).toBe(
        excerpt
      )
    }
  )

  it('publishes when title and excerpt are listing-ready', async () => {
    const t = convexTest(schema, modules)
    const { userId, now } = await seedAuthor(t)
    const asAuthor = t.withIdentity({ subject: userId })

    const articleId = await t.run(async (ctx) => {
      return await ctx.db.insert('articles', {
        slug: 'ready-draft',
        title: 'Real Title',
        excerpt: listingExcerpt,
        content: docWithBody,
        published: false,
        authorId: userId,
        authorUsername: 'pubwriter',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
    })

    await asAuthor.mutation(api.articles.publishArticle, {
      id: articleId as Id<'articles'>,
    })
    await new Promise((r) => setTimeout(r, 0))
    await t.finishAllScheduledFunctions(() => {})

    const row = await t.run(async (ctx) =>
      ctx.db.get(articleId as Id<'articles'>)
    )
    expect(row?.published).toBe(true)
  })

  it('rejects publishArticle when the author has no receiving wallet', async () => {
    const t = convexTest(schema, modules)
    const { userId, now } = await seedAuthor(t, null)
    const asAuthor = t.withIdentity({ subject: userId })

    const articleId = await t.run(async (ctx) => {
      return await ctx.db.insert('articles', {
        slug: 'ready-walletless-draft',
        title: 'Real Title',
        excerpt: listingExcerpt,
        content: docWithBody,
        published: false,
        authorId: userId,
        authorUsername: 'pubwriter',
        tags: [],
        viewCount: 0,
        highlightCount: 0,
        tipCount: 0,
        totalTipsUsd: 0,
        createdAt: now,
        updatedAt: now,
      })
    })

    await expect(
      asAuthor.mutation(api.articles.publishArticle, {
        id: articleId as Id<'articles'>,
      })
    ).rejects.toThrow(/receiving wallet/)
  })

  it('rejects createArticle with published when not listing-ready', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthor(t)
    const asAuthor = t.withIdentity({ subject: userId })

    await expect(
      asAuthor.mutation(api.articles.createArticle, {
        title: 'Untitled',
        content: docWithBody,
        excerpt: listingExcerpt,
        published: true,
      })
    ).rejects.toThrow(/title/)

    const id = await asAuthor.mutation(api.articles.createArticle, {
      title: 'Good Title',
      content: docWithBody,
      published: true,
    })
    expect((await t.run(async (ctx) => ctx.db.get(id)))?.published).toBe(true)
  })

  it('allows createArticle published when listing-ready', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthor(t)
    const asAuthor = t.withIdentity({ subject: userId })

    const id = await asAuthor.mutation(api.articles.createArticle, {
      title: 'Good Title',
      content: docWithBody,
      excerpt: listingExcerpt,
      published: true,
    })
    await new Promise((r) => setTimeout(r, 0))
    await t.finishAllScheduledFunctions(() => {})

    const row = await t.run(async (ctx) => ctx.db.get(id as Id<'articles'>))
    expect(row?.published).toBe(true)
  })

  it('rejects createArticle published when the author has no receiving wallet', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthor(t, null)
    const asAuthor = t.withIdentity({ subject: userId })

    await expect(
      asAuthor.mutation(api.articles.createArticle, {
        title: 'Good Title',
        content: docWithBody,
        excerpt: listingExcerpt,
        published: true,
      })
    ).rejects.toThrow(/receiving wallet/)
  })
})
