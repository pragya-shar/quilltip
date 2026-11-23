/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import type { Doc } from '../../convex/_generated/dataModel'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'

const modules = import.meta.glob('../../convex/**/*.ts')

async function setup(overrides: Partial<Doc<'articles'>> = {}) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const author = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'writer',
      articleCount: 2,
      createdAt: 1,
      updatedAt: 1,
    })
    const other = await ctx.db.insert('users', {
      email: 'reader@example.test',
      username: 'reader',
      createdAt: 1,
      updatedAt: 1,
    })
    const article = await ctx.db.insert('articles', {
      title: 'Words to keep',
      slug: 'words-to-keep',
      content: {},
      authorId: author,
      authorUsername: 'writer',
      published: false,
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    })
    return { author, other, article }
  })
  const author = t.withIdentity({ subject: `${ids.author}|session` })
  const other = t.withIdentity({ subject: `${ids.other}|session` })
  const highlight = await author.mutation(api.highlights.createHighlight, {
    articleId: ids.article,
    text: 'Words to keep',
    startOffset: 0,
    endOffset: 13,
    startContainerPath: 'text.0',
    endContainerPath: 'text.13',
  })
  return { t, ids, author, other, highlight }
}

test.each([
  { published: true },
  { published: true, arweaveStatus: 'pending' },
  { published: true, arweaveStatus: 'failed' },
  { published: true, arweaveStatus: 'verified', arweaveTxId: 'fixture' },
  { published: false, publishedAt: 0 },
  { published: false, arweaveStatus: 'pending' },
  { published: false, arweaveTxId: 'fixture' },
])('publication history prevents deletion: %j', async (state) => {
  const { t, ids, author, highlight } = await setup(state)
  await author.mutation(api.highlights.setPassageAppreciation, {
    id: highlight,
    appreciated: true,
  })
  const before = await t.run(async (ctx) => ({
    article: await ctx.db.get(ids.article),
    highlight: await ctx.db.get(highlight),
    appreciations: await ctx.db.query('passageAppreciations').collect(),
    author: await ctx.db.get(ids.author),
  }))
  await expect(
    author.mutation(api.articles.deleteArticle, { id: ids.article })
  ).rejects.toThrow('Published articles cannot be deleted from QuillTip')
  expect(
    await t.run(async (ctx) => ({
      article: await ctx.db.get(ids.article),
      highlight: await ctx.db.get(highlight),
      appreciations: await ctx.db.query('passageAppreciations').collect(),
      author: await ctx.db.get(ids.author),
    }))
  ).toEqual(before)
})

test('an author can still delete a draft and its highlights without changing published counts', async () => {
  const { t, ids, author, highlight } = await setup()
  expect(
    await author.mutation(api.articles.deleteArticle, { id: ids.article })
  ).toEqual({ success: true })
  expect(await t.run((ctx) => ctx.db.get(ids.article))).toBeNull()
  expect(await t.run((ctx) => ctx.db.get(highlight))).toBeNull()
  expect(await t.run((ctx) => ctx.db.get(ids.author))).toMatchObject({
    articleCount: 2,
  })
})

test.each([false, true])(
  'deletion keeps authentication and ownership checks (published=%s)',
  async (published) => {
    const { t, ids, other } = await setup({ published })
    await expect(
      t.mutation(api.articles.deleteArticle, { id: ids.article })
    ).rejects.toThrow('Not authenticated')
    await expect(
      other.mutation(api.articles.deleteArticle, { id: ids.article })
    ).rejects.toThrow('Not authorized')
    expect(await t.run((ctx) => ctx.db.get(ids.article))).not.toBeNull()
  }
)

test('draft deletion still preserves linked financial records', async () => {
  const { t, ids, author, highlight } = await setup()
  const saved = await t.run((ctx) => ctx.db.get(highlight))
  const tip = await t.run((ctx) =>
    ctx.db.insert('highlightTips', {
      highlightId: saved!.highlightId,
      articleId: ids.article,
      tipperId: ids.other,
      authorId: ids.author,
      highlightText: 'Words to keep',
      articleTitle: 'Words to keep',
      articleSlug: 'words-to-keep',
      amountUsd: 1,
      amountCents: 100,
      stellarTxId: 'fixture-confirmed-receipt',
      stellarMemo: saved!.highlightId,
      startOffset: 0,
      endOffset: 13,
      stellarNetwork: 'TESTNET',
      status: 'CONFIRMED',
      createdAt: 1,
      processedAt: 1,
      updatedAt: 1,
    })
  )
  const receipt = await t.run((ctx) => ctx.db.get(tip))
  await expect(
    author.mutation(api.articles.deleteArticle, { id: ids.article })
  ).rejects.toThrow('article has tipped highlights with financial records')
  expect(await t.run((ctx) => ctx.db.get(ids.article))).not.toBeNull()
  expect(await t.run((ctx) => ctx.db.get(highlight))).toEqual(saved)
  expect(await t.run((ctx) => ctx.db.get(tip))).toEqual(receipt)
})

test.each(['CONFIRMED', 'PENDING'])(
  'draft deletion is refused when the article has a %s tip',
  async (status) => {
    const { t, ids, author, highlight } = await setup()
    const tip = await t.run((ctx) =>
      ctx.db.insert('tips', {
        articleId: ids.article,
        tipperId: ids.other,
        authorId: ids.author,
        articleTitle: 'Words to keep',
        articleSlug: 'words-to-keep',
        amountUsd: 1,
        amountCents: 100,
        stellarTxId: 'fixture-article-tip',
        stellarNetwork: 'TESTNET',
        status,
        createdAt: 1,
        updatedAt: 1,
      })
    )
    const before = await t.run(async (ctx) => ({
      article: await ctx.db.get(ids.article),
      highlight: await ctx.db.get(highlight),
      tip: await ctx.db.get(tip),
    }))
    await expect(
      author.mutation(api.articles.deleteArticle, { id: ids.article })
    ).rejects.toThrow('Cannot delete: article has tips with financial records')
    expect(
      await t.run(async (ctx) => ({
        article: await ctx.db.get(ids.article),
        highlight: await ctx.db.get(highlight),
        tip: await ctx.db.get(tip),
      }))
    ).toEqual(before)
  }
)
