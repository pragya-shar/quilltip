/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import type { FunctionArgs, PaginationResult } from 'convex/server'
import { expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import {
  paginateReadingRoomMatches,
  rankReadingRoomWriters,
} from '../../convex/lib/articleBrowseSort'
import {
  READING_ROOM_HYDRATION_SIZE,
  READING_ROOM_SCAN_SIZE,
} from '../../lib/articles/readingRoomSearchBatch'
import {
  syncReadingRoomArticle,
  type ReadingRoomRank,
} from '../../convex/lib/readingRoomIndex'

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

async function scanReadingRoom(
  t: ReturnType<typeof convexTest<typeof schema.tables>>,
  filters: Omit<
    FunctionArgs<typeof api.articles.scanReadingRoomSearch>,
    'paginationOpts'
  >,
  numItems = READING_ROOM_SCAN_SIZE
) {
  const scan = async (
    cursor: string | null,
    endCursor?: string
  ): Promise<PaginationResult<ReadingRoomRank>> => {
    const batch = await t.query(api.articles.scanReadingRoomSearch, {
      ...filters,
      paginationOpts: { cursor, endCursor, numItems },
    })
    if (batch.pageStatus !== 'SplitRequired') return batch
    expect(batch.splitCursor).toBeTruthy()
    const left = await scan(cursor, batch.splitCursor!)
    const right = await scan(batch.splitCursor!, batch.continueCursor)
    return { ...batch, page: [...left.page, ...right.page] }
  }
  const rows: ReadingRoomRank[] = []
  let cursor: string | null = null
  for (;;) {
    const batch = await scan(cursor)
    rows.push(...batch.page)
    if (batch.isDone) break
    expect(batch.continueCursor).not.toBe(cursor)
    cursor = batch.continueCursor
  }
  return rows
}

// Drive the same bounded probe, cursor scan, ranking and hydration as the room.
async function browseReadingRoom(
  t: ReturnType<typeof convexTest<typeof schema.tables>>,
  args: FunctionArgs<typeof api.articles.listArticles>
) {
  const probe = await t.query(api.articles.listArticles, {
    ...args,
    allowSearchScan: true,
  })
  if (!('scanRequired' in probe) || !probe.scanRequired) return probe

  const { search, author, tag, category, bookmarkIds } = args
  const filters = { search: search!, author, tag, category, bookmarkIds }
  const rows = await scanReadingRoom(t, filters)
  const { page, limit } = probe
  const { slice, total, totalPages, browseMeta } = paginateReadingRoomMatches(
    rows,
    { ...args, page, limit }
  )
  const articles = []
  for (let i = 0; i < slice.length; i += READING_ROOM_HYDRATION_SIZE) {
    articles.push(
      ...(await t.query(api.articles.loadReadingRoomSearchPage, {
        ids: slice
          .slice(i, i + READING_ROOM_HYDRATION_SIZE)
          .map(({ articleId }) => articleId),
      }))
    )
  }
  return { articles, total, totalPages, browseMeta, page, limit }
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
  const first = await browseReadingRoom(t, storyFilters)
  expect(first.total).toBe(2)
  expect(first.totalPages).toBe(2)
  expect(first.articles.map((article) => article._id)).toEqual([ids.a])
  expect(first.articles[0]).not.toHaveProperty('writerNotes')
  const second = await browseReadingRoom(t, {
    ...storyFilters,
    page: 2,
  })
  expect(second.articles.map((article) => article._id)).toEqual([ids.z])
  const bookmarked = await browseReadingRoom(t, {
    bookmarkIds: [ids.z, ids.z, ids.draft, ids.other, 'stale-id'],
    sort: 'title',
    search: 'river-writer',
    searchByWriterOrTitle: true,
  })
  expect(bookmarked.articles.map((article) => article._id)).toEqual([
    ids.other,
    ids.z,
  ])
  const empty = await browseReadingRoom(t, {
    searchByWriterOrTitle: true,
    search: 'keyword',
  })
  expect(empty.total).toBe(0)
  expect((await browseReadingRoom(t, { bookmarkIds: [] })).total).toBe(0)
  expect(
    (
      await browseReadingRoom(t, {
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
    const result = await browseReadingRoom(t, filters)
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
  ) => browseReadingRoom(t, { ...args, searchByWriterOrTitle: true })
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
  expect(
    await t.query(api.articles.listArticles, {
      search: 'field',
      searchByWriterOrTitle: true,
      sort: 'oldest',
      page: 3,
      limit: 2,
    })
  ).toEqual(broad)
  expect(
    await t.query(api.articles.listArticles, { bookmarkIds: [] })
  ).toMatchObject({ supportsSearchScan: true, articles: [], total: 0 })

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

test('broad titles and prolific writers stay within a transaction budget', async () => {
  const t = convexTest({
    schema,
    modules,
    transactionLimits: { documentsRead: 250 },
  })
  const authorId = await t.run((ctx) =>
    ctx.db.insert('users', {
      username: 'fixture-writer',
      email: 'writer@example.test',

      name: 'Prolific Writer',
      createdAt: 1,
      updatedAt: 1,
    })
  )
  const ids = []
  for (let start = 0; start < 600; start += 40) {
    const batch = await t.run(async (ctx) => {
      const ids = []
      for (let i = start; i < start + 40; i++) {
        const id = await ctx.db.insert('articles', {
          slug: `field-${i}`,
          title:
            i === 0
              ? 'Field Quartz'
              : i <= 70
                ? `Column Field ${i}`
                : `Field ${i}`,
          authorId,
          authorUsername: 'fixture-writer',
          content,
          published: true,
          publishedAt: i + 1,
          tags: [i % 2 === 0 ? 'stories' : 'thoughts'],
          createdAt: 1,
          updatedAt: 1,
        })
        await syncReadingRoomArticle(ctx, id, await ctx.db.get(id))
        if (i % 3 === 0) {
          await ctx.db.insert('articleTagLinks', {
            articleId: id,
            authorId,
            publishedAt: i + 1,
            tag: i % 2 === 0 ? 'Exact' : 'exact',
          })
        }
        ids.push(id)
      }
      return ids
    })
    ids.push(...batch)
  }
  await t.run((ctx) =>
    ctx.db.insert('readingRoomIndexState', {
      version: 1,
      cursor: null,
      complete: true,
    })
  )
  for (const search of ['field', 'prolific']) {
    const result = await browseReadingRoom(t, {
      search,
      searchByWriterOrTitle: true,
      category: 'stories',
      sort: 'oldest',
      limit: 2,
      page: 2,
    })
    expect(result.total).toBe(300)
    expect(result.totalPages).toBe(150)
    expect(result.articles.map(({ _id }) => _id)).toEqual([ids[4], ids[6]])
  }

  const selective = await t.query(api.articles.listArticles, {
    search: 'column',
    searchByWriterOrTitle: true,
    allowSearchScan: true,
    limit: 2,
  })
  expect(selective).not.toHaveProperty('scanRequired')
  expect(selective.total).toBe(70)

  const tagResult = await browseReadingRoom(t, {
    author: 'fixture-writer',
    tag: 'Exact',
    search: 'prolific',
    searchByWriterOrTitle: true,
    limit: 2,
  })
  expect(tagResult.total).toBe(100)
  expect(tagResult.articles.map(({ _id }) => _id)).toEqual([ids[594], ids[588]])

  const saved = await browseReadingRoom(t, {
    bookmarkIds: ['missing-id', ...ids, ids[0]!],
    category: 'stories',
    search: 'field',
    searchByWriterOrTitle: true,
    limit: 2,
  })
  expect(saved.total).toBe(300)
  expect(saved.articles.map(({ _id }) => _id)).toEqual([ids[598], ids[596]])
})

test('writer options count old articles across ranges and preserve legacy ordering', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    for (const [index, dates] of [
      [1, 2, 3],
      [4, 5],
      [6, 7],
    ].entries()) {
      const username = `writer-${index}`
      const authorId = await ctx.db.insert('users', {
        username,
        email: `${username}@example.test`,
        createdAt: 1,
        updatedAt: 1,
      })
      for (const publishedAt of dates) {
        await ctx.db.insert('articles', {
          slug: `fixture-${publishedAt}`,
          title: `Article ${publishedAt}`,
          content,
          authorId,
          authorUsername: username,
          published: true,
          publishedAt,
          createdAt: 1,
          updatedAt: 1,
        })
      }
    }
  })
  const legacy = await t.query(api.articles.listBrowseAuthors, { limit: 3 })
  const writerNames = legacy.map(({ username }) => username)
  expect(writerNames).toEqual(['writer-0', 'writer-2', 'writer-1'])

  const readOptions = async () => {
    const rows = await scanReadingRoom(t, {}, 2)
    const ids = rankReadingRoomWriters(rows, 3)
    const writers = await t.query(api.articles.loadReadingRoomWriterOptions, {
      ids,
    })
    return writers.map(({ username }) => username)
  }
  expect(await readOptions()).toEqual(writerNames)
  expect(
    (await t.mutation(internal.readingRoomIndex.backfill, {})).complete
  ).toBe(true)
  expect(await readOptions()).toEqual(writerNames)
})
