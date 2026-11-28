/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

const modules = import.meta.glob('../../convex/**/*.ts')

const OWN = 'https://own-deployment-123.convex.cloud'
const ownCover = `${OWN}/api/storage/5c1e2f0a-cover`
const otherCover = 'https://someone-else-456.convex.cloud/api/storage/cover'

// Uploaded covers are on CONVEX_CLOUD_URL, as on a real deployment.
beforeEach(() => vi.stubEnv('CONVEX_CLOUD_URL', OWN))
afterEach(() => vi.unstubAllEnvs())

async function setup() {
  const t = convexTest(schema, modules)
  const authorId = await t.run((ctx) =>
    ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'cover-writer',
      name: 'Cover Writer',
      createdAt: 1,
      updatedAt: 1,
    })
  )
  const readerId = await t.run((ctx) =>
    ctx.db.insert('users', {
      email: 'reader@example.test',
      username: 'cover-reader',
      createdAt: 1,
      updatedAt: 1,
    })
  )
  const article = (slug: string, coverImage: string) =>
    t.run((ctx) =>
      ctx.db.insert('articles', {
        title: `Covers ${slug}`,
        slug,
        excerpt: 'A short piece about covers of words.',
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Words.' }] },
          ],
        },
        coverImage,
        tags: [],
        authorId,
        authorUsername: 'cover-writer',
        published: true,
        publishedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })
    )
  const own = await article('own', ownCover)
  const other = await article('other', otherCover)
  return {
    t,
    own,
    other,
    author: t.withIdentity({ subject: `${authorId}|session` }),
    reader: t.withIdentity({ subject: `${readerId}|session` }),
  }
}

const coverOf = (
  rows: { _id: Id<'articles'>; coverImage?: string }[],
  id: Id<'articles'>
) => rows.find((row) => row._id === id)?.coverImage

test('listArticles sends no cover from another host (#633)', async () => {
  const { t, own, other } = await setup()
  const result = await t.query(api.articles.listArticles, {})
  expect(coverOf(result.articles, own)).toBe(ownCover)
  expect(coverOf(result.articles, other)).toBeUndefined()
  expect(JSON.stringify(result)).not.toContain('someone-else-456')
})

test('the reading room page sends no cover from another host (#633)', async () => {
  const { t, own, other } = await setup()
  const rows = await t.query(api.articles.loadReadingRoomSearchPage, {
    ids: [own, other],
  })
  expect(coverOf(rows, own)).toBe(ownCover)
  expect(coverOf(rows, other)).toBeUndefined()
})

test('getArticleBySlug sends no cover from another host (#633)', async () => {
  const { t } = await setup()
  const own = await t.query(api.articles.getArticleBySlug, {
    username: 'cover-writer',
    slug: 'own',
  })
  const other = await t.query(api.articles.getArticleBySlug, {
    username: 'cover-writer',
    slug: 'other',
  })
  expect(own?.coverImage).toBe(ownCover)
  expect(other?.coverImage).toBeUndefined()
  expect(JSON.stringify(other)).not.toContain('someone-else-456')
})

test('getArticleById gives readers no outside cover, and its author the stored one (#633)', async () => {
  const { t, other, author, reader } = await setup()
  expect(
    (await reader.query(api.articles.getArticleById, { id: other }))?.coverImage
  ).toBeUndefined()
  expect(
    (await t.query(api.articles.getArticleById, { id: other }))?.coverImage
  ).toBeUndefined()
  // The author's editor reads the cover as stored, so an autosave keeps it.
  expect(
    (await author.query(api.articles.getArticleById, { id: other }))?.coverImage
  ).toBe(otherCover)
  // Nothing stored changes.
  expect((await t.run((ctx) => ctx.db.get(other)))?.coverImage).toBe(otherCover)
})
