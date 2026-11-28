/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  ARTICLE_SCHEMA,
  articleContentHashHex,
  bytesToHex,
  canonicalArticleBytes,
  sha256,
} from '../../convex/lib/chain/ids'
import type { ArticleUpload } from '../../lib/arweave/articleUpload'
import vectorsFile from '../../contracts/shared/test-vectors.json'

// No network: the Turbo upload is replaced by a recorder.
const uploads = vi.hoisted(() => [] as ArticleUpload[])
vi.mock('../../lib/arweave/client', () => ({
  parseWalletKey: () => ({}),
  uploadArticle: async (upload: ArticleUpload) => {
    uploads.push(upload)
    return {
      success: true,
      txId: 'bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U',
      url: 'https://arweave.net/bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U',
      contentHash: upload.contentHash,
    }
  },
  getTransactionStatus: async () => ({ confirmed: false, confirmations: 0 }),
}))

const modules = import.meta.glob('../../convex/**/*.ts')

const content = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ünïcödé ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'and plain text, kept\r\nas typed.' },
      ],
    },
  ],
}

async function setup() {
  const t = convexTest(schema, modules)
  const authorId = await t.run((ctx) =>
    ctx.db.insert('users', {
      email: 'anchor@example.test',
      username: 'anchor-writer',
      name: 'Anchor Writer',
      stellarAddress: 'G' + 'A'.repeat(55),
      // The writer proved control of this address on testnet.
      stellarAddressVerifiedAt: 1,
      stellarAddressVerifiedNetwork: 'Test SDF Network ; September 2015',
      createdAt: 1,
      updatedAt: 1,
    })
  )
  const author = t.withIdentity({ subject: `${authorId}|session` })
  const id = await author.mutation(api.articles.saveDraft, {
    title: 'Anchored words',
    content,
  })
  await t.run((ctx) =>
    ctx.db.patch(id, { excerpt: 'A short piece about anchored words.' })
  )
  return { t, author, authorId, id }
}

const expectedHash = (
  id: Id<'articles'>,
  authorId: Id<'users'>,
  contentVersion = 1
) =>
  articleContentHashHex({
    articleId: id,
    authorId,
    title: 'Anchored words',
    content,
    contentVersion,
  })

// Fake timers keep scheduled functions from starting on their own, so a test
// decides when the scheduled upload runs and it never runs twice at once.
beforeEach(() => {
  uploads.length = 0
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

// This suite runs in the edge runtime that Convex tests use; the shared
// vectors must give the same bytes and digests here as in Node.
test.each(vectorsFile.canonical_articles.cases)(
  'shared vector $name matches in the Convex test runtime',
  async (vector) => {
    const bytes = canonicalArticleBytes(vector.input)
    expect(new TextDecoder().decode(bytes)).toBe(vector.canonical)
    expect(bytes.length).toBe(vector.byte_length)
    expect(bytesToHex(await sha256(bytes))).toBe(vector.sha256)
  }
)

test('publish records content_hash over the canonical article bytes', async () => {
  const { t, author, authorId, id } = await setup()
  // Arweave disabled: Convex still computes the same bytes for registration.
  const result = await author.mutation(api.articles.publishArticle, { id })

  const hash = await expectedHash(id, authorId)
  expect(result).toMatchObject({ contentHash: hash, contentVersion: 1 })
  const row = await t.run((ctx) => ctx.db.get(id))
  expect(row).toMatchObject({
    contentHash: hash,
    contentVersion: 1,
    contentHashSchema: ARTICLE_SCHEMA,
  })
  // Recomputing from the stored row, twice, gives the stored hash.
  const fromRow = {
    articleId: row!._id,
    authorId: row!.authorId,
    title: row!.title,
    content: row!.content,
    contentVersion: row!.contentVersion!,
  }
  expect(await articleContentHashHex(fromRow)).toBe(hash)
  expect(await articleContentHashHex(fromRow)).toBe(hash)
})

test('the Arweave body is the canonical bytes and hashes to contentHash', async () => {
  vi.stubEnv('ARWEAVE_ENABLED', 'true')
  vi.stubEnv('ARWEAVE_WALLET_KEY', '{"kty":"RSA"}')
  const { t, author, authorId, id } = await setup()
  await author.mutation(api.articles.publishArticle, { id })
  // Run the upload that publish scheduled, once. The verification it
  // schedules later is not run.
  vi.runOnlyPendingTimers()
  await t.finishInProgressScheduledFunctions()

  expect(uploads).toHaveLength(1)
  const [upload] = uploads
  const hash = await expectedHash(id, authorId)
  expect(bytesToHex(await sha256(upload!.body))).toBe(hash)
  expect(upload!.body).toEqual(
    canonicalArticleBytes({
      articleId: id,
      authorId,
      title: 'Anchored words',
      content,
      contentVersion: 1,
    })
  )
  // The upload time is a tag, not part of the body.
  const body = new TextDecoder().decode(upload!.body)
  expect(body).not.toMatch(/timestamp|publishedAt|anchor-writer/i)
  expect(upload!.tags).toContainEqual({ name: 'Content-Hash', value: hash })
  expect(upload!.tags.map((tag) => tag.name)).toContain('Timestamp')

  const row = await t.run((ctx) => ctx.db.get(id))
  expect(row).toMatchObject({
    arweaveStatus: 'uploaded',
    arweaveTxId: 'bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U',
    contentHash: hash,
    contentVersion: 1,
  })
})

test('an article published before keeps its stored hash and is not re-uploaded', async () => {
  vi.stubEnv('ARWEAVE_ENABLED', 'true')
  vi.stubEnv('ARWEAVE_WALLET_KEY', '{"kty":"RSA"}')
  const { t, id } = await setup()
  const legacyHash = 'ab'.repeat(32)
  // A row from before canonical bytes: legacy hash, no schema label.
  await t.run((ctx) =>
    ctx.db.patch(id, {
      published: true,
      publishedAt: 1,
      contentHash: legacyHash,
      contentVersion: 1,
      arweaveStatus: 'pending',
    })
  )
  // A retry scheduled before the change was deployed.
  await t.action(internal.arweave.uploadArticleToArweave, { articleId: id })

  expect(uploads).toHaveLength(0)
  const row = await t.run((ctx) => ctx.db.get(id))
  expect(row?.contentHash).toBe(legacyHash)
  expect(row?.contentHashSchema).toBeUndefined()
  expect(row?.arweaveStatus).toBe('failed')
})

test('republishing changed content moves to the next content version', async () => {
  const { t, author, authorId, id } = await setup()
  await t.run((ctx) => ctx.db.patch(id, { arweaveStatus: 'verified' }))
  await author.mutation(api.articles.publishArticle, { id })

  // Same bytes after a return to draft: same version and hash.
  await t.run((ctx) => ctx.db.patch(id, { published: false }))
  await author.mutation(api.articles.publishArticle, { id })
  let row = await t.run((ctx) => ctx.db.get(id))
  expect(row).toMatchObject({
    contentVersion: 1,
    contentHash: await expectedHash(id, authorId),
  })

  // Changed title: version 2, hashed at version 2.
  await t.run((ctx) =>
    ctx.db.patch(id, { published: false, title: 'Anchored words, again' })
  )
  await author.mutation(api.articles.publishArticle, { id })
  row = await t.run((ctx) => ctx.db.get(id))
  expect(row?.contentVersion).toBe(2)
  expect(row?.contentHash).toBe(
    await articleContentHashHex({
      articleId: id,
      authorId,
      title: 'Anchored words, again',
      content,
      contentVersion: 2,
    })
  )
})
