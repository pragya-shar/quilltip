/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArticleStorageSection } from '../../components/articles/ArticleStorageSection'

// No network: an upload would only be recorded, and none is expected to run.
const uploads = vi.hoisted(() => [] as unknown[])
vi.mock('../../lib/arweave/client', () => ({
  parseWalletKey: () => ({}),
  uploadArticle: async (upload: unknown) => {
    uploads.push(upload)
    return { success: false, error: 'uploads are not allowed in this test' }
  },
  getTransactionStatus: async () => ({ confirmed: false, confirmations: 0 }),
}))

const modules = import.meta.glob('../../convex/**/*.ts')

const content = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Words.' }] }],
}

function storageOn() {
  vi.stubEnv('ARWEAVE_ENABLED', 'true')
  vi.stubEnv('ARWEAVE_WALLET_KEY', '{"kty":"placeholder"}')
}

function storageOff() {
  vi.stubEnv('ARWEAVE_ENABLED', 'false')
  vi.stubEnv('ARWEAVE_WALLET_KEY', '')
}

async function setup() {
  const t = convexTest(schema, modules)
  const authorId = await t.run((ctx) =>
    ctx.db.insert('users', {
      email: 'storage@example.test',
      username: 'storage-writer',
      name: 'Storage Writer',
      stellarAddress: 'G' + 'A'.repeat(55),
      stellarAddressVerifiedAt: 1,
      stellarAddressVerifiedNetwork: 'Test SDF Network ; September 2015',
      createdAt: 1,
      updatedAt: 1,
    })
  )
  const author = t.withIdentity({ subject: `${authorId}|session` })
  const id = await author.mutation(api.articles.saveDraft, {
    title: 'Stored words',
    content,
  })
  await t.run((ctx) =>
    ctx.db.patch(id, { excerpt: 'A short piece about stored words.' })
  )
  const scheduledUploads = () =>
    t.run(async (ctx) =>
      (await ctx.db.system.query('_scheduled_functions').collect()).filter(
        (job) => job.name.includes('uploadArticleToArweave')
      )
    )
  // A signed-out reader, and the writer reading their own article (#679).
  const read = (slug: string) =>
    t.query(api.articles.getArticleBySlug, {
      username: 'storage-writer',
      slug,
    })
  const readOwn = (slug: string) =>
    author.query(api.articles.getArticleBySlug, {
      username: 'storage-writer',
      slug,
    })
  return { t, author, id, scheduledUploads, read, readOwn }
}

// Fake timers keep a scheduled upload from starting on its own.
beforeEach(() => {
  uploads.length = 0
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

test('with storage off, publishing marks nothing pending and schedules no upload', async () => {
  storageOff()
  const { t, author, id, scheduledUploads, read } = await setup()
  const { slug } = await author.mutation(api.articles.publishArticle, { id })

  const row = await t.run((ctx) => ctx.db.get(id))
  expect(row?.published).toBe(true)
  expect(row?.arweaveStatus).toBeUndefined()
  expect(await scheduledUploads()).toHaveLength(0)
  expect((await read(slug))?.arweaveStatus).toBeUndefined()
  expect(uploads).toHaveLength(0)
})

test('storage switched on without the upload wallet counts as off', async () => {
  vi.stubEnv('ARWEAVE_ENABLED', 'true')
  vi.stubEnv('ARWEAVE_WALLET_KEY', '')
  const { t, author, id, scheduledUploads } = await setup()
  await author.mutation(api.articles.publishArticle, { id })

  expect((await t.run((ctx) => ctx.db.get(id)))?.arweaveStatus).toBeUndefined()
  expect(await scheduledUploads()).toHaveLength(0)
})

test('with storage on, publishing marks the article pending and schedules one upload', async () => {
  storageOn()
  const { t, author, id, scheduledUploads, read, readOwn } = await setup()
  const { slug } = await author.mutation(api.articles.publishArticle, { id })

  expect((await t.run((ctx) => ctx.db.get(id)))?.arweaveStatus).toBe('pending')
  const jobs = await scheduledUploads()
  expect(jobs).toHaveLength(1)
  expect(jobs[0]?.args).toEqual([{ articleId: id }])
  // The writer sees the upload in progress; a reader sees nothing yet.
  expect((await readOwn(slug))?.arweaveStatus).toBe('pending')
  expect((await read(slug))?.arweaveStatus).toBeUndefined()
  // The scheduled upload never ran.
  expect(uploads).toHaveLength(0)
})

test('with storage on, a failed upload is scheduled again on publish', async () => {
  storageOn()
  const { t, author, id, scheduledUploads } = await setup()
  await t.run((ctx) => ctx.db.patch(id, { arweaveStatus: 'failed' }))
  await author.mutation(api.articles.publishArticle, { id })

  expect((await t.run((ctx) => ctx.db.get(id)))?.arweaveStatus).toBe('pending')
  expect(await scheduledUploads()).toHaveLength(1)
})

test('with storage off, a failed upload stays failed and is not retried', async () => {
  storageOff()
  const { t, author, id, scheduledUploads } = await setup()
  await t.run((ctx) => ctx.db.patch(id, { arweaveStatus: 'failed' }))
  await author.mutation(api.articles.publishArticle, { id })

  expect((await t.run((ctx) => ctx.db.get(id)))?.arweaveStatus).toBe('failed')
  expect(await scheduledUploads()).toHaveLength(0)
})

test('a stored pending status reads as no status while storage is off, and the row is unchanged', async () => {
  storageOn()
  const { t, author, id, read, readOwn } = await setup()
  const { slug } = await author.mutation(api.articles.publishArticle, { id })
  // An article published while storage was on, read after it is turned off.
  storageOff()

  expect((await readOwn(slug))?.arweaveStatus).toBeUndefined()
  expect((await read(slug))?.arweaveStatus).toBeUndefined()
  expect((await t.run((ctx) => ctx.db.get(id)))?.arweaveStatus).toBe('pending')

  storageOn()
  expect((await readOwn(slug))?.arweaveStatus).toBe('pending')
  expect((await read(slug))?.arweaveStatus).toBeUndefined()
})

// Every stored status, for a reader and for the writer, with storage on and
// off (#679): a reader gets a finished upload or nothing.
const EXPECTED: Record<
  string,
  {
    reader: string | undefined
    on: string | undefined
    off: string | undefined
  }
> = {
  pending: { reader: undefined, on: 'pending', off: undefined },
  uploaded: { reader: undefined, on: 'uploaded', off: 'uploaded' },
  verified: { reader: 'verified', on: 'verified', off: 'verified' },
  failed: { reader: undefined, on: 'failed', off: 'failed' },
}

test.each(Object.keys(EXPECTED))(
  'a stored %s status reaches each viewer as the rule says',
  async (status) => {
    storageOff()
    const { t, author, id, read, readOwn } = await setup()
    const { slug } = await author.mutation(api.articles.publishArticle, { id })
    await t.run((ctx) =>
      ctx.db.patch(id, {
        arweaveStatus: status,
        arweaveTxId: 'tx-679',
        arweaveUrl: 'https://arweave.net/tx-679',
        arweaveTimestamp: 1_795_000_000_000,
        arweaveErrorMessage: 'upstream 502',
        arweaveVerifyAttempts: 2,
      })
    )
    const expected = EXPECTED[status]!
    for (const on of [false, true]) {
      if (on) storageOn()
      else storageOff()
      const reader = await read(slug)
      const own = await readOwn(slug)
      const byIdReader = await t.query(api.articles.getArticleById, { id })
      const byIdOwn = await author.query(api.articles.getArticleById, { id })
      expect(reader?.arweaveStatus).toBe(expected.reader)
      expect(byIdReader?.arweaveStatus).toBe(expected.reader)
      expect(own?.arweaveStatus).toBe(on ? expected.on : expected.off)
      expect(byIdOwn?.arweaveStatus).toBe(on ? expected.on : expected.off)
      // A reader gets no transaction for an unfinished upload.
      expect(reader?.arweaveTxId).toBe(expected.reader ? 'tx-679' : undefined)
      // The error and the retry count never leave the backend.
      for (const article of [reader, own, byIdReader, byIdOwn]) {
        expect(article?.arweaveErrorMessage).toBeUndefined()
        expect(article?.arweaveVerifyAttempts).toBeUndefined()
      }
      // Public cards carry a finished upload only.
      const cards = await t.query(api.articles.listArticles, {})
      const card = cards.articles.find((article) => article._id === id)
      expect(card?.arweaveStatus).toBe(expected.reader)
      expect(card?.arweaveErrorMessage).toBeUndefined()
      const [room] = await t.query(api.articles.loadReadingRoomSearchPage, {
        ids: [id],
      })
      expect(room?._id).toBe(id)
      expect(room?.arweaveStatus).toBe(expected.reader)
      expect(room?.arweaveErrorMessage).toBeUndefined()
    }
  }
)

test('the details panel shows a reader no upload state, and the writer theirs', async () => {
  storageOn()
  const { t, author, id, read, readOwn } = await setup()
  const { slug } = await author.mutation(api.articles.publishArticle, { id })
  // What the article page passes to the details panel's storage section.
  const section = async (load: typeof read): Promise<string> => {
    const article = await load(slug)
    return renderToStaticMarkup(
      createElement(ArticleStorageSection, {
        status: article?.arweaveStatus,
        txId: article?.arweaveTxId,
        url: article?.arweaveUrl,
        timestamp: article?.arweaveTimestamp,
      })
    )
  }

  expect(await section(readOwn)).toContain('Uploading to Arweave')
  expect(await section(read)).toBe('')

  await t.run((ctx) => ctx.db.patch(id, { arweaveStatus: 'failed' }))
  expect(await section(readOwn)).toContain('Not stored permanently')
  expect(await section(read)).toBe('')

  await t.run((ctx) => ctx.db.patch(id, { arweaveStatus: 'pending' }))
  storageOff()
  expect(await section(readOwn)).toBe('')
  expect(await section(read)).toBe('')
})
