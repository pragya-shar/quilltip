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

test('a save that arrives after publishing is rejected and keeps the slug', async () => {
  const { t, ids, author } = await setup(false)
  await t.run((ctx) =>
    ctx.db.patch(ids.author, {
      stellarAddress:
        'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      // The writer proved control of this address on testnet.
      stellarAddressVerifiedAt: 1,
      stellarAddressVerifiedNetwork: 'Test SDF Network ; September 2015',
    })
  )
  await author.mutation(api.articles.publishArticle, { id: ids.article })
  const published = await t.run((ctx) => ctx.db.get(ids.article))
  expect(published?.published).toBe(true)

  await expectLocked(
    author.mutation(api.articles.saveDraft, {
      id: ids.article,
      title: 'A late title',
      content: body('Typed while publishing.'),
      writerNotes: 'late note',
    })
  )
  await expectLocked(
    author.mutation(api.articles.updateArticle, {
      id: ids.article,
      title: 'A late title',
    })
  )
  await expect(
    author.mutation(api.articles.publishArticle, { id: ids.article })
  ).rejects.toThrow('Already published')

  const after = await t.run((ctx) => ctx.db.get(ids.article))
  expect(after).toMatchObject({
    title: published?.title,
    slug: published?.slug,
    content: published?.content,
    updatedAt: published?.updatedAt,
  })
  expect(after?.writerNotes).toBeUndefined()
})

test('a locked article keeps its tag links and reading-room entry', async () => {
  const { t, ids, author } = await setup(false)
  await t.run((ctx) =>
    ctx.db.patch(ids.author, {
      stellarAddress:
        'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      // The writer proved control of this address on testnet.
      stellarAddressVerifiedAt: 1,
      stellarAddressVerifiedNetwork: 'Test SDF Network ; September 2015',
    })
  )
  await author.mutation(api.articles.publishArticle, { id: ids.article })
  const snapshot = () =>
    t.run(async (ctx) => ({
      links: await ctx.db.query('articleTagLinks').collect(),
      room: await ctx.db.query('readingRoomArticles').collect(),
    }))
  const before = await snapshot()
  expect(before.links.length).toBeGreaterThan(0)
  await expectLocked(
    author.mutation(api.articles.updateArticle, {
      id: ids.article,
      tags: ['Thoughts', 'Essays'],
    })
  )
  expect(await snapshot()).toEqual(before)
})

test.each([true, false])(
  'edits keep authentication and ownership checks (published=%s)',
  async (published) => {
    const { t, ids, reader } = await setup(published)
    await expect(
      reader.mutation(api.articles.updateArticle, {
        id: ids.article,
        title: 'Not mine',
      })
    ).rejects.toThrow('Not authorized')
    await expect(
      reader.mutation(api.articles.saveDraft, {
        id: ids.article,
        title: 'Not mine',
        content: body('Not mine.'),
      })
    ).rejects.toThrow('Not authorized')
    await expect(
      t.mutation(api.articles.saveDraft, {
        id: ids.article,
        title: 'Anonymous',
        content: body('Anonymous.'),
      })
    ).rejects.toThrow('Not authenticated')
    const article = await t.run((ctx) => ctx.db.get(ids.article))
    expect(article?.title).toBe('Words to keep')
  }
)
