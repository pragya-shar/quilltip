/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import { getArticleOpening } from '../../lib/articles/getArticleOpening'
import { buildArticlesBrowseHref } from '../../lib/articles/buildArticlesBrowseHref'

const modules = import.meta.glob('../../convex/**/*.ts')
const content = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'First sentence. Second sentence.' }],
    },
  ],
}

test('browse applies categories, writer/title search and bookmark IDs before sorting and pagination', async () => {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const authorId = await ctx.db.insert('users', {
      username: 'river-writer',
      email: 'writer@example.test',
      name: 'Marin River',
      createdAt: 1,
      updatedAt: 1,
    })
    const insert = (
      title: string,
      publishedAt: number,
      tags: string[],
      published = true
    ) =>
      ctx.db.insert('articles', {
        slug: title.toLowerCase(),
        title,
        excerpt: 'A keyword found only in the excerpt',
        content,
        published,
        publishedAt,
        tags,
        authorId,
        authorName: 'Old Name',
        authorUsername: 'old-username',
        createdAt: 1,
        updatedAt: 1,
        writerNotes: 'Private',
      })
    return {
      z: await insert('Zebra', 4, [' Stories ', 'other']),
      a: await insert('apple', 2, ['stories', 'Thoughts']),
      other: await insert('Birch', 3, ['unclassified']),
      draft: await insert('Draft', 5, ['Stories'], false),
    }
  })
  const storyFilters = {
    category: 'stories',
    searchByWriterOrTitle: true,
    search: 'marin river',
    sort: 'title',
    limit: 1,
  } as const
  const first = await t.query(api.articles.listArticles, storyFilters)
  expect(first.total).toBe(2)
  expect(first.totalPages).toBe(2)
  expect(first.articles.map((article) => article._id)).toEqual([ids.a])
  expect(first.articles[0]).not.toHaveProperty('writerNotes')
  const second = await t.query(api.articles.listArticles, {
    ...storyFilters,
    page: 2,
  })
  expect(second.articles.map((article) => article._id)).toEqual([ids.z])
  const bookmarked = await t.query(api.articles.listArticles, {
    bookmarkIds: [ids.z, ids.z, ids.draft, ids.other, 'stale-id'],
    sort: 'title',
    search: 'river-writer',
    searchByWriterOrTitle: true,
  })
  expect(bookmarked.articles.map((article) => article._id)).toEqual([
    ids.other,
    ids.z,
  ])
  const empty = await t.query(api.articles.listArticles, {
    searchByWriterOrTitle: true,
    search: 'keyword',
  })
  expect(empty.total).toBe(0)
  expect(
    (await t.query(api.articles.listArticles, { bookmarkIds: [] })).total
  ).toBe(0)
  expect(
    (
      await t.query(api.articles.listArticles, {
        searchByWriterOrTitle: true,
        search: 'zebra',
      })
    ).total
  ).toBe(1)
})

test('compact previews use the opening and browse links preserve active filters across pages', () => {
  expect(getArticleOpening({ content, excerpt: 'Subtitle' })).toBe(
    'First sentence.'
  )
  expect(getArticleOpening({ excerpt: 'Subtitle. More.' })).toBe('Subtitle.')
  expect(getArticleOpening({ excerpt: 'long '.repeat(40) })).toMatch(/long…$/)
  const href = buildArticlesBrowseHref({
    sourceParams: new URLSearchParams(
      'bookmarked=1&sort=title&search=marin&count=6'
    ),
    page: 2,
  })
  expect(href).toBe('/articles?bookmarked=1&search=marin&sort=title&page=2')
})
