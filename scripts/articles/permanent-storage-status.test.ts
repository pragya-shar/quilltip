/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'

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
  const read = (slug: string) =>
    t.query(api.articles.getArticleBySlug, {
      username: 'storage-writer',
      slug,
    })
  return { t, author, id, scheduledUploads, read }
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
  const { t, author, id, scheduledUploads, read } = await setup()
  const { slug } = await author.mutation(api.articles.publishArticle, { id })

  expect((await t.run((ctx) => ctx.db.get(id)))?.arweaveStatus).toBe('pending')
  const jobs = await scheduledUploads()
  expect(jobs).toHaveLength(1)
  expect(jobs[0]?.args).toEqual([{ articleId: id }])
  expect((await read(slug))?.arweaveStatus).toBe('pending')
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
  const { t, author, id, read } = await setup()
  const { slug } = await author.mutation(api.articles.publishArticle, { id })
  // An article published while storage was on, read after it is turned off.
  storageOff()

  expect((await read(slug))?.arweaveStatus).toBeUndefined()
  expect((await t.run((ctx) => ctx.db.get(id)))?.arweaveStatus).toBe('pending')

  storageOn()
  expect((await read(slug))?.arweaveStatus).toBe('pending')
})

test.each(['uploaded', 'verified', 'failed'])(
  'a stored %s status reads unchanged while storage is off',
  async (status) => {
    storageOff()
    const { t, author, id, read } = await setup()
    const { slug } = await author.mutation(api.articles.publishArticle, { id })
    await t.run((ctx) => ctx.db.patch(id, { arweaveStatus: status }))

    expect((await read(slug))?.arweaveStatus).toBe(status)
  }
)
