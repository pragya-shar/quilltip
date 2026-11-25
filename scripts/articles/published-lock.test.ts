/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import { PUBLISHED_ARTICLE_LOCKED_MESSAGE } from '../../lib/articles/publishedLock'

const modules = import.meta.glob('../../convex/**/*.ts')

const body = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

async function setup(published: boolean) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const author = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'writer',
      createdAt: 1,
      updatedAt: 1,
    })
    const reader = await ctx.db.insert('users', {
      email: 'reader@example.test',
      username: 'reader',
      createdAt: 1,
      updatedAt: 1,
    })
    const article = await ctx.db.insert('articles', {
      title: 'Words to keep',
      slug: 'words-to-keep',
      excerpt: 'A short story about keeping words.',
      content: body('Words to keep, as they were written.'),
      tags: ['Stories'],
      authorId: author,
      authorUsername: 'writer',
      published,
      publishedAt: published ? 1 : undefined,
      createdAt: 1,
      updatedAt: 1,
    })
    return { author, reader, article }
  })
  return {
    t,
    ids,
    author: t.withIdentity({ subject: `${ids.author}|session` }),
    reader: t.withIdentity({ subject: `${ids.reader}|session` }),
  }
}

async function expectLocked(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  expect((error as ConvexError<string>).data).toBe(
    PUBLISHED_ARTICLE_LOCKED_MESSAGE
  )
}

test.each([
  { title: 'A new title' },
  { excerpt: 'A new subtitle for the story.' },
  { content: body('Changed words.') },
  { coverImage: 'https://example.test/cover.png' },
  { tags: ['Thoughts'] },
])('updateArticle rejects published content changes: %j', async (change) => {
  const { t, ids, author } = await setup(true)
  await expectLocked(
    author.mutation(api.articles.updateArticle, { id: ids.article, ...change })
  )
  const article = await t.run((ctx) => ctx.db.get(ids.article))
  expect(article).toMatchObject({
    title: 'Words to keep',
    excerpt: 'A short story about keeping words.',
    tags: ['Stories'],
  })
})

test('autosave cannot overwrite a published article', async () => {
  const { t, ids, author } = await setup(true)
  await expectLocked(
    author.mutation(api.articles.saveDraft, {
      id: ids.article,
      title: 'Words to keep',
      content: body('Autosaved change.'),
    })
  )
  const article = await t.run((ctx) => ctx.db.get(ids.article))
  expect(article?.content).toEqual(body('Words to keep, as they were written.'))
})

test('the cover image of a published article cannot be replaced', async () => {
  const { t, ids, author } = await setup(true)
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['x'], { type: 'image/png' }))
  )
  await expectLocked(
    author.mutation(api.uploads.updateArticleCoverImage, {
      articleId: ids.article,
      storageId,
      fileName: 'cover.png',
    })
  )
})

test('drafts can still be edited, saved and deleted', async () => {
  const { t, ids, author } = await setup(false)
  await author.mutation(api.articles.updateArticle, {
    id: ids.article,
    title: 'Words to change',
  })
  await author.mutation(api.articles.saveDraft, {
    id: ids.article,
    title: 'Words to change',
    content: body('Draft words.'),
  })
  const draft = await t.run((ctx) => ctx.db.get(ids.article))
  expect(draft).toMatchObject({
    title: 'Words to change',
    content: body('Draft words.'),
  })
  await author.mutation(api.articles.deleteArticle, { id: ids.article })
  expect(await t.run((ctx) => ctx.db.get(ids.article))).toBeNull()
})

test('readers can still highlight a published article', async () => {
  const { ids, reader } = await setup(true)
  const highlight = await reader.mutation(api.highlights.createHighlight, {
    articleId: ids.article,
    text: 'Words to keep',
    startOffset: 0,
    endOffset: 13,
    startContainerPath: 'text.0',
    endContainerPath: 'text.13',
  })
  expect(highlight).toBeTruthy()
})
