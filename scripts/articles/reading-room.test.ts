/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import { getArticleOpening } from '../../lib/articles/getArticleOpening'
import { buildArticlesBrowseHref } from '../../lib/articles/buildArticlesBrowseHref'
import { mapListArticlesToDisplay } from '../../lib/articles/mapListArticleToDisplay'

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
  await t.mutation(internal.readingRoomIndex.backfill, {})
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

test('Reading Room cards show the saved subtitle after publication and published edits', async () => {
  const t = convexTest(schema, modules)
  const authorId = await t.run((ctx) =>
    ctx.db.insert('users', {
      username: 'river-writer',
      email: 'subtitle@example.test',
      name: 'Marin River',
      stellarAddress: 'G' + 'A'.repeat(55),
      createdAt: 1,
      updatedAt: 1,
    })
  )
  const author = t.withIdentity({ subject: `${authorId}|session` })
  const article = { title: 'River Notes', content, tags: ['stories'] }
  const id = await author.mutation(api.articles.saveDraft, {
    ...article,
    excerpt: '  A field guide to quiet rivers. With notes from the bank.  ',
  })
  type BrowseFilters = Parameters<
    typeof t.query<typeof api.articles.listArticles>
  >[1]
  const cards = async (filters: BrowseFilters = {}) => {
    const result = await t.query(api.articles.listArticles, filters)
    return mapListArticlesToDisplay(result.articles, { compact: true })
  }
  expect(await cards()).toEqual([])

  // Suppress permanent storage in this isolated in-memory fixture.
  await t.run((ctx) => ctx.db.patch(id, { arweaveStatus: 'verified' }))
  await author.mutation(api.articles.publishArticle, { id })
  expect(await cards()).toMatchObject([
    {
      id,
      excerpt: 'A field guide to quiet rivers. With notes from the bank.',
      author: { username: 'river-writer', name: 'Marin River' },
    },
  ])

  const excerpt = 'An updated guide for the next trip downriver.'
  await author.mutation(api.articles.saveDraft, { ...article, id, excerpt })
  await t.mutation(internal.readingRoomIndex.backfill, {})
  const views: BrowseFilters[] = [
    { category: 'stories' },
    { search: 'river notes', searchByWriterOrTitle: true },
    { bookmarkIds: [id] },
  ]
  for (const filters of views) {
    expect(await cards(filters)).toMatchObject([{ id, excerpt }])
  }

  for (const blank of [' \t ', undefined]) {
    await author.mutation(api.articles.saveDraft, {
      ...article,
      id,
      excerpt: blank,
    })
    expect(await cards()).toMatchObject([{ id, excerpt: 'First sentence.' }])
  }
})

test('body openings stay compact and browse links preserve active filters across pages', () => {
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

test('compact previews load when Intl.Segmenter is unavailable', async () => {
  vi.resetModules()
  const intl = Object.create(Intl, { Segmenter: { value: undefined } })
  vi.stubGlobal('Intl', intl)
  try {
    const { getArticleOpening } =
      await import('../../lib/articles/getArticleOpening')
    expect(getArticleOpening({ content })).toBe('First sentence.')
    expect(getArticleOpening({ excerpt: '最初の文。次の文。' })).toBe(
      '最初の文。'
    )
  } finally {
    vi.unstubAllGlobals()
    vi.resetModules()
  }
})

test('search backfills a large catalog and follows public writes without changing filter or sort behavior', async () => {
  const t = convexTest(schema, modules)
  const authorId = await t.run((ctx) =>
    ctx.db.insert('users', {
      username: 'lumen-writer',
      email: 'lumen@example.test',
      name: 'Lumen Arch',
      stellarAddress: 'G' + 'A'.repeat(55),
      createdAt: 1,
      updatedAt: 1,
    })
  )
  const author = t.withIdentity({ subject: `${authorId}|session` })
  const ids = await t.run(async (ctx) => {
    const ids = []
    for (let i = 0; i < 540; i++) {
      ids.push(
        await ctx.db.insert('articles', {
          slug: `field-${i}`,
          title: i === 13 ? 'Field: Quartz—Window' : `Field ${i}`,
          content,
          excerpt: 'Notes from the field.',
          authorId,
          authorName: 'Previous Pen Name',
          authorUsername: 'lumen-writer',
          published: true,
          publishedAt: i + 1,
          tags: ['stories', i % 2 === 0 ? 'Exact' : 'exact'],
          createdAt: 1,
          updatedAt: 1,
        })
      )
      if (i === 13) {
        await ctx.db.insert('articleTagLinks', {
          articleId: ids[13]!,
          authorId,
          publishedAt: i + 1,
          tag: 'exact',
        })
      }
    }
    return ids
  })
  const browse = (
    args: Parameters<typeof t.query<typeof api.articles.listArticles>>[1]
  ) =>
    t.query(api.articles.listArticles, { ...args, searchByWriterOrTitle: true })
  const narrow = {
    author: 'lumen-writer',
    category: 'stories',
    tag: 'exact',
    search: 'artz—win arch',
  } as const
  const before = await browse(narrow)
  expect(before.articles.map((article) => article._id)).toEqual([ids[13]])
  // Invoke each checkpoint directly, as the deployment scheduler would.
  for (let i = 0; i < 80; i++) {
    const result = await t.mutation(internal.readingRoomIndex.backfill, {})
    if (result.complete) break
    expect(i).toBeLessThan(79)
  }
  expect(await browse(narrow)).toEqual(before)
  expect((await browse({ ...narrow, tag: 'Exact' })).total).toBe(0)
  const broad = await browse({
    search: 'field',
    sort: 'oldest',
    page: 3,
    limit: 2,
  })
  expect(
    (await browse({ search: 'field 539' })).articles.map(
      (article) => article._id
    )
  ).toEqual(ids.slice(-1))
  expect(broad.total).toBe(540)
  expect(broad.totalPages).toBe(270)
  expect(broad.articles.map((article) => article._id)).toEqual(ids.slice(4, 6))

  await author.mutation(api.users.updateProfile, { name: 'Nereid Arc' })
  expect((await browse({ ...narrow, search: 'artz—win nereid' })).total).toBe(1)
  expect((await browse(narrow)).total).toBe(0)
  await author.mutation(api.users.updateProfile, {
    name: `${'a'.repeat(1100)} Umbrella`,
  })
  expect((await browse({ search: 'umbrella quartz' })).total).toBe(1)

  await author.mutation(api.articles.updateArticle, {
    id: ids[13]!,
    title: 'Blue Lantern',
  })
  expect(
    (await browse({ search: 'lue lan', bookmarkIds: [ids[13]!, ids[0]!] }))
      .total
  ).toBe(1)
  expect((await browse({ search: 'quartz' })).total).toBe(0)

  const id = await author.mutation(api.articles.createArticle, {
    title: 'Narrow Mangrove',
    content,
    published: true,
  })
  expect((await browse({ search: 'mangrove' })).articles[0]?._id).toBe(id)
  await t.mutation(internal.articles.setAllArticlesToDraft, {})
  expect((await browse({ search: 'mangrove' })).total).toBe(0)
  expect(
    await t.query(api.articles.getContinueReadingArticle, { ids: [id] })
  ).toBeNull()
})

test('continue reading resolves the first available ID to its current public title and route', async () => {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const authorId = await ctx.db.insert('users', {
      username: 'current-writer',
      email: 'resume@example.test',
      createdAt: 1,
      updatedAt: 1,
    })
    const insert = (published: boolean) =>
      ctx.db.insert('articles', {
        authorId,
        authorUsername: 'old-writer',
        title: 'Current Title',
        slug: 'current-slug',
        published,
        content,
        createdAt: 1,
        updatedAt: 1,
      })
    return [await insert(false), await insert(true)]
  })
  expect(
    await t.query(api.articles.getContinueReadingArticle, {
      ids: ['removed', ...ids],
    })
  ).toEqual({
    id: ids[1],
    username: 'current-writer',
    slug: 'current-slug',
    title: 'Current Title',
  })
})
