/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])
const content = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Opening words.' }] },
  ],
}

async function fixture() {
  const t = convexTest(schema, modules)
  const records = await t.run(async (ctx) => {
    const authorId = await ctx.db.insert('users', {
      email: 'curation@example.test',
      username: 'writer',
      articleCount: 2,
      createdAt: 1,
      updatedAt: 1,
    })
    const ids = []
    for (const title of ['Test filler', 'Readable story']) {
      const id = await ctx.db.insert('articles', {
        title,
        slug: title.toLowerCase().replaceAll(' ', '-'),
        authorId,
        authorUsername: 'writer',
        content,
        excerpt: '',
        published: true,
        publishedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        tags: ['nature'],
        arweaveTxId: 'permanent-reference',
        arweaveStatus: 'verified',
      })
      await ctx.db.insert('articleTagLinks', {
        articleId: id,
        authorId,
        tag: 'nature',
        publishedAt: 1,
      })
      ids.push(id)
    }
    return { authorId, ids }
  })
  return {
    t,
    ...records,
    args: {
      articles: [
        {
          id: records.ids[0]!,
          expectedTitle: 'Test filler',
          expectedUpdatedAt: 1,
        },
      ],
    },
  }
}

describe('reviewed article cleanup', () => {
  it('rebuilds discovery metadata for selected stories without changing content', async () => {
    const { t, ids } = await fixture()
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('articleTagLinks').collect())
        await ctx.db.delete(row._id)
    })
    await t.mutation(internal.articles.refreshArticleDiscovery, {
      ids: [ids[1]!],
    })
    const result = await t.query(api.articles.listArticles, { tag: 'nature' })
    expect(result.articles.map((a) => a._id)).toEqual([ids[1]])
    const row = await t.run(async (ctx) => ctx.db.get(ids[1]!))
    expect(row?.searchContent).toContain('Opening words.')
    expect(row?.content).toEqual(content)
    expect(row?.excerpt).toBe('')
    expect(row?.updatedAt).toBe(1)
    expect(
      (await t.run(async (ctx) => ctx.db.get(ids[0]!)))?.searchContent
    ).toBeUndefined()
  })
  it('previews without changing data by default', async () => {
    const { t, args, ids } = await fixture()
    expect(
      (await t.mutation(internal.articles.hideReviewedArticles, args)).applied
    ).toBe(false)
    expect((await t.run(async (ctx) => ctx.db.get(ids[0]!)))?.published).toBe(
      true
    )
  })
  it('hides only reviewed IDs, retains bodies and Arweave references, and preserves readable discovery', async () => {
    const { t, args, ids, authorId } = await fixture()
    await t.mutation(internal.articles.hideReviewedArticles, {
      ...args,
      dryRun: false,
    })
    const state = await t.run(async (ctx) => ({
      hidden: await ctx.db.get(ids[0]!),
      kept: await ctx.db.get(ids[1]!),
      links: await ctx.db.query('articleTagLinks').collect(),
      author: await ctx.db.get(authorId),
      scheduled: await ctx.db.system.query('_scheduled_functions').collect(),
    }))
    expect(state.hidden?.published).toBe(false)
    expect(state.hidden?.content).toEqual(content)
    expect(state.hidden?.arweaveTxId).toBe('permanent-reference')
    expect(state.kept?.updatedAt).toBe(1)
    expect(state.kept?.excerpt).toBe('')
    expect(state.author?.articleCount).toBe(1)
    expect(state.links.map((a) => a.articleId)).toEqual([ids[1]!])
    expect(state.scheduled).toEqual([])
    expect(
      (await t.query(api.articles.listArticles, {})).articles.map(
        (a) => a.title
      )
    ).toEqual(['Readable story'])
    expect(
      await t.query(api.articles.getArticleById, { id: ids[0]! })
    ).toBeNull()
  })
  it('rejects stale review data before changing any records', async () => {
    const { t, args, ids } = await fixture()
    args.articles.push({
      id: ids[1]!,
      expectedTitle: 'Readable story',
      expectedUpdatedAt: 1,
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(ids[1]!, { updatedAt: 2 })
    })
    await expect(
      t.mutation(internal.articles.hideReviewedArticles, {
        ...args,
        dryRun: false,
      })
    ).rejects.toThrow('changed since review')
    expect((await t.run(async (ctx) => ctx.db.get(ids[0]!)))?.published).toBe(
      true
    )
  })
})
