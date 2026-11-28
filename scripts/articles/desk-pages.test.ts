/// <reference types="vite/client" />
/**
 * The desk's pages (`write.deskDrafts`, `write.deskPublished`) and the rows
 * they read (`convex/lib/write/deskRow.ts`): every draft and article pages
 * in, in order, whatever the count; each row stays equal to its article
 * through saves, publishing, unpublishing and deletion; another writer's
 * rows never appear; each published row carries its tips state; a page
 * reads only small rows; and the backfill run twice changes nothing.
 */
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { DESK_PAGE_MAX, DESK_PUBLISHED_PAGE_MAX } from '../../convex/write'
import { deskFieldsOf } from '../../convex/lib/write/deskRow'
import { CORE, seedAddress } from '../chain/fixtures'

vi.mock('../../lib/arweave/client', () => ({
  parseWalletKey: () => ({}),
  uploadArticle: async () => {
    throw new Error('the uploader must not run in these tests')
  },
  getTransactionStatus: async () => ({ confirmed: false, confirmations: 0 }),
}))

const modules = import.meta.glob('../../convex/**/*.ts')
const TESTNET = 'Test SDF Network ; September 2015'
const EPOCH = 'testnet-test'
const WALLET = seedAddress(41)

const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({
    type: 'paragraph',
    content: text ? [{ type: 'text', text }] : [],
  })),
})

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 28) })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

function chainOn() {
  for (const [k, val] of Object.entries({
    STELLAR_NETWORK: 'TESTNET',
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: EPOCH,
    CORE_CONTRACT_ID: CORE,
  }))
    vi.stubEnv(k, val)
}

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const user = (username: string) =>
      ctx.db.insert('users', {
        email: `${username}@example.test`,
        username,
        name: username,
        stellarAddress: WALLET,
        stellarAddressVerifiedAt: 1,
        stellarAddressVerifiedNetwork: TESTNET,
        createdAt: 1,
        updatedAt: 1,
      })
    return { writer: await user('ines'), other: await user('omar') }
  })
  return {
    t,
    ids,
    writer: t.withIdentity({ subject: `${ids.writer}|session` }),
    other: t.withIdentity({ subject: `${ids.other}|session` }),
  }
}
type World = Awaited<ReturnType<typeof setup>>
type Client = World['writer']

/** Drafts made through the Write save, each in its own millisecond. */
async function makeDrafts(client: Client, n: number, prefix = 'Draft') {
  const ids: Id<'articles'>[] = []
  for (let i = 0; i < n; i++) {
    vi.advanceTimersByTime(1)
    const { id } = await client.mutation(api.write.saveDraft, {
      title: `${prefix} ${i}`,
      content: doc(`Words of ${prefix.toLowerCase()} ${i}.`),
    })
    ids.push(id)
  }
  return ids
}

async function publish(client: Client, id: Id<'articles'>) {
  vi.advanceTimersByTime(1)
  const base = await getUpdatedAt(client, id)
  return client.mutation(api.write.publish, { id, baseUpdatedAt: base })
}

let tRef: World['t']
async function getUpdatedAt(_client: Client, id: Id<'articles'>) {
  return (await tRef.run((ctx) => ctx.db.get(id)))!.updatedAt
}

async function allPages<T>(
  read: (cursor: string | null) => Promise<{
    page: T[]
    isDone: boolean
    continueCursor: string
  }>
): Promise<{ items: T[]; pages: number }> {
  const items: T[] = []
  let cursor: string | null = null
  let pages = 0
  for (;;) {
    const result = await read(cursor)
    items.push(...result.page)
    pages++
    if (result.isDone) return { items, pages }
    cursor = result.continueCursor
  }
}

const draftPages = (client: Client, numItems = 20) =>
  allPages((cursor) =>
    client.query(api.write.deskDrafts, {
      paginationOpts: { numItems, cursor },
    })
  )
const publishedPages = (client: Client, numItems = 20) =>
  allPages((cursor) =>
    client.query(api.write.deskPublished, {
      paginationOpts: { numItems, cursor },
    })
  )

/** Every desk row equals the fields of its article, and no row is orphaned. */
async function expectRowsMatch(w: World) {
  const { articles, rows } = await w.t.run(async (ctx) => ({
    articles: await ctx.db.query('articles').collect(),
    rows: await ctx.db.query('deskRows').collect(),
  }))
  expect(rows).toHaveLength(articles.length)
  for (const article of articles) {
    const row = rows.find((r) => r.articleId === article._id)
    expect(row, article.title).toBeDefined()
    expect(row).toMatchObject(deskFieldsOf(article))
  }
}

describe('drafts page fully and in order', () => {
  test.each([8, 21, 200])('%i drafts', async (n) => {
    const w = await setup()
    tRef = w.t
    const ids = await makeDrafts(w.writer, n)
    const { items, pages } = await draftPages(w.writer)
    expect(items.map((d) => d._id)).toEqual([...ids].reverse())
    // Pages of 20; Convex may end with one empty, finished page.
    expect(pages).toBeGreaterThanOrEqual(Math.ceil(n / 20))
    expect(pages).toBeLessThanOrEqual(Math.ceil(n / 20) + 1)
    expect(items[0]).toEqual({
      _id: ids[n - 1],
      title: `Draft ${n - 1}`,
      firstLine: `Words of draft ${n - 1}.`,
      words: 4,
      updatedAt: expect.any(Number),
    })
    await expectRowsMatch(w)
  })

  test.each([20, 40])(
    'a list of exactly %i ends on its last full page: no empty page after it',
    async (n) => {
      const w = await setup()
      tRef = w.t
      await makeDrafts(w.writer, n)
      const { items, pages } = await draftPages(w.writer)
      expect(items).toHaveLength(n)
      expect(pages).toBe(n / 20)
    }
  )

  test('published: exactly 20 ends on its one page', async () => {
    const w = await setup()
    tRef = w.t
    const ids = await makeDrafts(w.writer, 20, 'Exact')
    for (const id of ids) await publish(w.writer, id)
    const first = await w.writer.query(api.write.deskPublished, {
      paginationOpts: { numItems: 20, cursor: null },
    })
    expect(first.page).toHaveLength(20)
    expect(first.isDone).toBe(true)
  })

  test('equal update times across a page end: nothing lost, done at the end', async () => {
    const w = await setup()
    tRef = w.t
    // 25 drafts in one millisecond, written as an old deployment would.
    await w.t.run(async (ctx) => {
      for (let i = 0; i < 25; i++)
        await ctx.db.insert('articles', {
          title: `Same ${i}`,
          slug: `same-${i}`,
          content: doc(`Same time ${i}.`),
          authorId: w.ids.writer,
          authorUsername: 'ines',
          published: false,
          createdAt: 1,
          updatedAt: 500,
        })
    })
    await w.t.mutation(internal.write.backfillDeskRows, {})
    await w.t.finishAllScheduledFunctions(vi.runAllTimers)
    const { items } = await draftPages(w.writer)
    expect(new Set(items.map((d) => d._id)).size).toBe(25)
    const { items: tens, pages } = await draftPages(w.writer, 5)
    expect(tens).toHaveLength(25)
    expect(pages).toBe(5)
  })

  test('a page is clamped to its maximum and never empty while rows remain', async () => {
    const w = await setup()
    tRef = w.t
    await makeDrafts(w.writer, DESK_PAGE_MAX + 5)
    const first = await w.writer.query(api.write.deskDrafts, {
      paginationOpts: { numItems: 10_000, cursor: null },
    })
    expect(first.page).toHaveLength(DESK_PAGE_MAX)
    const zero = await w.writer.query(api.write.deskDrafts, {
      paginationOpts: { numItems: 0, cursor: null },
    })
    expect(zero.page).toHaveLength(1)
  })
})

describe('published articles page fully and in order, with tips', () => {
  test.each([8, 21])('%i published', async (n) => {
    const w = await setup()
    tRef = w.t
    const ids = await makeDrafts(w.writer, n, 'Article')
    for (const id of ids) await publish(w.writer, id)
    const { items } = await publishedPages(w.writer)
    expect(items.map((a) => a._id)).toEqual([...ids].reverse())
    expect(items[0]).toEqual({
      _id: ids[n - 1],
      title: `Article ${n - 1}`,
      slug: expect.any(String),
      authorUsername: 'ines',
      publishedAt: expect.any(Number),
      tips: { state: 'unavailable' },
    })
    expect((await draftPages(w.writer)).items).toEqual([])
    await expectRowsMatch(w)
  })

  test(`a page holds at most ${DESK_PUBLISHED_PAGE_MAX} rows`, async () => {
    const w = await setup()
    tRef = w.t
    const ids = await makeDrafts(w.writer, DESK_PUBLISHED_PAGE_MAX + 3)
    for (const id of ids) await publish(w.writer, id)
    const first = await w.writer.query(api.write.deskPublished, {
      paginationOpts: { numItems: 100, cursor: null },
    })
    expect(first.page).toHaveLength(DESK_PUBLISHED_PAGE_MAX)
    expect(first.isDone).toBe(false)
  })
})

describe('the tips state per row', () => {
  type RowStatus = Doc<'chainArticles'>['status']
  async function withRow(
    w: World,
    articleId: Id<'articles'>,
    status: RowStatus,
    opts: { author?: string; review?: boolean } = {}
  ) {
    await w.t.run(async (ctx) => {
      const lastSubmissionId =
        opts.review === undefined
          ? undefined
          : await ctx.db.insert('chainSubmissions', {
              network: 'TESTNET',
              chainEpoch: EPOCH,
              kind: 'register',
              userId: w.ids.writer,
              contractId: CORE,
              requestId: `r-${articleId}`,
              clientRefs: [],
              txHash: 'ab'.repeat(32),
              maxTime: 1,
              status: 'SUBMITTED',
              attempts: 1,
              needsReview: opts.review,
              related: [],
              createdAt: 1,
              updatedAt: 1,
            } as never)
      await ctx.db.insert('chainArticles', {
        network: 'TESTNET',
        chainEpoch: EPOCH,
        articleId,
        articleKey: 'ab'.repeat(32),
        authorAddress: opts.author ?? WALLET,
        contentHash: 'cd'.repeat(32),
        contentVersion: 1,
        splits: [],
        totals: {},
        status,
        txHash: 'ef'.repeat(32),
        ...(lastSubmissionId ? { lastSubmissionId } : {}),
        updatedAt: 1,
      })
    })
  }

  test('each state, with no address or hash in the answer', async () => {
    chainOn()
    const w = await setup()
    tRef = w.t
    const ids = await makeDrafts(w.writer, 6, 'Tips')
    for (const id of ids) await publish(w.writer, id)
    // ids[0]: nothing registered.
    await withRow(w, ids[1]!, 'PREPARED')
    await withRow(w, ids[2]!, 'SUBMITTED', { review: true })
    await withRow(w, ids[3]!, 'REGISTERED')
    await withRow(w, ids[4]!, 'REGISTERED', { author: seedAddress(42) })
    await withRow(w, ids[5]!, 'FAILED')
    const { items } = await publishedPages(w.writer)
    const tips = new Map(items.map((a) => [a._id, a.tips]))
    expect(tips.get(ids[0]!)).toEqual({ state: 'not_registered' })
    expect(tips.get(ids[1]!)).toEqual({ state: 'pending' })
    expect(tips.get(ids[2]!)).toEqual({ state: 'held_for_review' })
    expect(tips.get(ids[3]!)).toEqual({
      state: 'registered',
      payoutOutdated: false,
    })
    expect(tips.get(ids[4]!)).toEqual({
      state: 'registered',
      payoutOutdated: true,
    })
    expect(tips.get(ids[5]!)).toEqual({ state: 'not_registered' })
    const text = JSON.stringify(items)
    for (const secret of [WALLET, seedAddress(42), 'ab'.repeat(32), 'ef'])
      expect(text).not.toContain(secret)
  })

  test('the same answer as publishing.registrationState', async () => {
    chainOn()
    const w = await setup()
    tRef = w.t
    const [id] = await makeDrafts(w.writer, 1, 'Same')
    await publish(w.writer, id!)
    await withRow(w, id!, 'REGISTERED')
    const single = await w.writer.query(api.publishing.registrationState, {
      articleId: id!,
    })
    const { items } = await publishedPages(w.writer)
    expect(single).toMatchObject(items[0]!.tips)
  })

  test('a deployment without tips: unavailable on every row', async () => {
    const w = await setup()
    tRef = w.t
    const ids = await makeDrafts(w.writer, 2, 'Off')
    for (const id of ids) await publish(w.writer, id)
    const { items } = await publishedPages(w.writer)
    expect(items.map((a) => a.tips)).toEqual([
      { state: 'unavailable' },
      { state: 'unavailable' },
    ])
  })
})

describe('the rows stay equal to their articles', () => {
  test('a save, a title change, a publish, an unpublish and a delete', async () => {
    const w = await setup()
    tRef = w.t
    const [a, b] = await makeDrafts(w.writer, 2)
    vi.advanceTimersByTime(1)
    await w.writer.mutation(api.write.saveDraft, {
      id: a!,
      baseUpdatedAt: await getUpdatedAt(w.writer, a!),
      title: 'A new title',
      content: doc('', 'A new first line, after an empty one.'),
    })
    await expectRowsMatch(w)
    const drafts = (await draftPages(w.writer)).items
    expect(drafts[0]).toMatchObject({
      _id: a,
      title: 'A new title',
      firstLine: 'A new first line, after an empty one.',
      words: 8,
    })
    await publish(w.writer, a!)
    await expectRowsMatch(w)
    // The legacy editor's update and the operator's unpublish path.
    await w.writer.mutation(api.articles.updateArticle, {
      id: b!,
      title: 'Changed in the old editor',
    })
    await expectRowsMatch(w)
    await w.t.mutation(internal.articles.setAllArticlesToDraft, {})
    await expectRowsMatch(w)
    expect((await publishedPages(w.writer)).items).toEqual([])
    await w.writer.mutation(api.articles.deleteArticle, { id: b! })
    await expectRowsMatch(w)
    expect((await draftPages(w.writer)).items.map((d) => d._id)).toEqual([a])
  })

  test("another writer's rows never appear, and signed out is an empty page", async () => {
    const w = await setup()
    tRef = w.t
    await makeDrafts(w.writer, 3)
    const theirs = await makeDrafts(w.other, 2, 'Theirs')
    await publish(w.other, theirs[0]!)
    expect((await draftPages(w.writer)).items).toHaveLength(3)
    expect((await publishedPages(w.writer)).items).toEqual([])
    expect((await draftPages(w.other)).items.map((d) => d._id)).toEqual([
      theirs[1],
    ])
    const signedOut = await w.t.query(api.write.deskDrafts, {
      paginationOpts: { numItems: 20, cursor: null },
    })
    expect(signedOut).toEqual({ page: [], isDone: true, continueCursor: '' })
    expect(
      await w.t.query(api.write.deskPublished, {
        paginationOpts: { numItems: 20, cursor: null },
      })
    ).toEqual({ page: [], isDone: true, continueCursor: '' })
  })
})

describe('the read bound', () => {
  test('a full page of the largest drafts reads only small rows', async () => {
    const w = await setup()
    tRef = w.t
    const big = doc('x'.repeat(1_040_000))
    await w.t.run(async (ctx) => {
      for (let i = 0; i < 12; i++)
        await ctx.db.insert('articles', {
          title: `Big ${i}`,
          slug: `big-${i}`,
          content: big,
          authorId: w.ids.writer,
          authorUsername: 'ines',
          published: false,
          createdAt: 1,
          updatedAt: 10 + i,
        })
    })
    await w.t.mutation(internal.write.backfillDeskRows, {})
    await w.t.finishAllScheduledFunctions(vi.runAllTimers)
    const page = await w.writer.query(api.write.deskDrafts, {
      paginationOpts: { numItems: DESK_PAGE_MAX, cursor: null },
    })
    expect(page.page).toHaveLength(12)
    const rows = await w.t.run((ctx) => ctx.db.query('deskRows').collect())
    const bytes = rows.reduce(
      (sum, r) => sum + new TextEncoder().encode(JSON.stringify(r)).length,
      0
    )
    // What one page reads: under 1 KB a row, so a full page stays far
    // inside the 16 MiB a query may read.
    expect(bytes / rows.length).toBeLessThan(1024)
    expect(DESK_PAGE_MAX * 1024).toBeLessThan(16 * 1024 * 1024)
  })
})

describe('the backfill', () => {
  test('rows for articles written before the rows existed; twice changes nothing', async () => {
    const w = await setup()
    tRef = w.t
    await w.t.run(async (ctx) => {
      for (let i = 0; i < 19; i++)
        await ctx.db.insert('articles', {
          title: `Old ${i}`,
          slug: `old-${i}`,
          content: doc(`An older piece, number ${i}.`),
          authorId: i % 3 === 0 ? w.ids.other : w.ids.writer,
          authorUsername: i % 3 === 0 ? 'omar' : 'ines',
          published: i % 2 === 0,
          publishedAt: i % 2 === 0 ? 100 + i : undefined,
          createdAt: 1,
          updatedAt: 200 + i,
        })
      // A row whose article is gone: the second phase removes it.
      const gone = await ctx.db.insert('articles', {
        title: 'Gone',
        slug: 'gone',
        content: doc('Gone.'),
        authorId: w.ids.writer,
        authorUsername: 'ines',
        published: false,
        createdAt: 1,
        updatedAt: 1,
      })
      await ctx.db.insert('deskRows', {
        articleId: gone,
        authorId: w.ids.writer,
        published: false,
        title: 'Gone',
        firstLine: 'Gone.',
        words: 1,
        updatedAt: 1,
        publishedAt: null,
        slug: 'gone',
      })
      await ctx.db.delete(gone)
    })
    const first = await w.t.mutation(internal.write.backfillDeskRows, {})
    expect(first.done).toBe(false)
    await w.t.finishAllScheduledFunctions(vi.runAllTimers)
    await expectRowsMatch(w)
    const state = await w.t.run((ctx) =>
      ctx.db.query('deskRowBackfills').unique()
    )
    expect(state).toMatchObject({ changed: 20, finishedAt: expect.any(Number) })
    const before = await w.t.run((ctx) => ctx.db.query('deskRows').collect())
    await w.t.mutation(internal.write.backfillDeskRows, { restart: true })
    await w.t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await w.t.run((ctx) => ctx.db.query('deskRows').collect())).toEqual(
      before
    )
    expect(
      await w.t.run((ctx) => ctx.db.query('deskRowBackfills').unique())
    ).toMatchObject({ changed: 0 })
    const drafts = (await draftPages(w.writer)).items
    expect(drafts.map((d) => d.title)).toEqual(
      [17, 13, 11, 7, 5, 1].map((i) => `Old ${i}`)
    )
  })
})
