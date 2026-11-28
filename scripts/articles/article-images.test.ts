/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import { imageSourceRefusal } from '../../lib/security/imageSources'

const modules = import.meta.glob('../../convex/**/*.ts')

const OWN = 'https://own-deployment-123.convex.cloud'
const own = `${OWN}/api/storage/5c1e2f0a-uploaded`
const unsplash = 'https://images.unsplash.com/photo-1?w=800'
const arweave =
  'https://arweave.net/bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U'
const otherConvex = 'https://someone-else-456.convex.cloud/api/storage/x'

const body = (...images: string[]) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Words to read.' }] },
    ...images.map((src) => ({ type: 'resizableImage', attrs: { src } })),
  ],
})

// Storage addresses are on CONVEX_CLOUD_URL, as on a real deployment.
beforeEach(() => vi.stubEnv('CONVEX_CLOUD_URL', OWN))
afterEach(() => vi.unstubAllEnvs())

async function setup() {
  const t = convexTest(schema, modules)
  const authorId = await t.run((ctx) =>
    ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'image-writer',
      name: 'Image Writer',
      stellarAddress: 'G' + 'A'.repeat(55),
      stellarAddressVerifiedAt: 1,
      stellarAddressVerifiedNetwork: 'Test SDF Network ; September 2015',
      createdAt: 1,
      updatedAt: 1,
    })
  )
  const writer = t.withIdentity({ subject: `${authorId}|session` })
  const draft = async (content: unknown, coverImage?: string) => {
    const id = await writer.mutation(api.articles.saveDraft, {
      title: 'Pictures of words',
      content,
      ...(coverImage ? { coverImage } : {}),
    })
    await t.run((ctx) =>
      ctx.db.patch(id, { excerpt: 'A short piece about pictures of words.' })
    )
    return id
  }
  return { t, writer, draft }
}

async function expectRefused(promise: Promise<unknown>, src: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  expect((error as ConvexError<string>).data).toBe(imageSourceRefusal(src))
}

test('a draft autosaves with an image from another host, unchanged (#615)', async () => {
  const { t, draft, writer } = await setup()
  const id = await draft(body(otherConvex), otherConvex)
  await writer.mutation(api.articles.saveDraft, {
    id,
    title: 'Pictures of words',
    content: body(own, otherConvex),
  })
  const row = await t.run((ctx) => ctx.db.get(id))
  expect(row?.content).toEqual(body(own, otherConvex))
  expect(row?.published).toBe(false)
})

test('publishArticle refuses an image from another Convex deployment and names it (#615)', async () => {
  const { t, draft, writer } = await setup()
  const id = await draft(body(own, otherConvex))
  await expectRefused(
    writer.mutation(api.articles.publishArticle, { id }),
    otherConvex
  )
  expect((await t.run((ctx) => ctx.db.get(id)))?.published).toBe(false)
})

test('publishArticle refuses a cover from another host (#615)', async () => {
  const { draft, writer } = await setup()
  const id = await draft(body(own), otherConvex)
  await expectRefused(
    writer.mutation(api.articles.publishArticle, { id }),
    otherConvex
  )
})

test('publishArticle publishes own-storage, Unsplash and Arweave images (#615)', async () => {
  const { t, draft, writer } = await setup()
  const id = await draft(body(own, unsplash, arweave), own)
  await writer.mutation(api.articles.publishArticle, { id })
  expect((await t.run((ctx) => ctx.db.get(id)))?.published).toBe(true)
})

test('createArticle refuses to publish an image from another host, and saves it as a draft (#615)', async () => {
  const { t, writer } = await setup()
  const args = {
    title: 'Pictures of words',
    excerpt: 'A short piece about pictures of words.',
    content: body(otherConvex),
  }
  await expectRefused(
    writer.mutation(api.articles.createArticle, { ...args, published: true }),
    otherConvex
  )
  const id = await writer.mutation(api.articles.createArticle, args)
  expect((await t.run((ctx) => ctx.db.get(id)))?.content).toEqual(
    body(otherConvex)
  )
})

test('countImageHosts counts image and cover hosts by published and draft, with nothing else (#615)', async () => {
  const { t, draft, writer } = await setup()
  const published = await draft(body(own, own, unsplash), own)
  await writer.mutation(api.articles.publishArticle, { id: published })
  await draft(body(otherConvex, 'data:image/png;base64,AAAA', '/relative.png'))
  const report = await t.action(internal.articleImageHosts.countImageHosts, {})
  expect(report).toEqual({
    storageOrigin: OWN,
    articles: { published: 1, draft: 1 },
    images: [
      {
        host: 'own-deployment-123.convex.cloud',
        allowed: true,
        published: 2,
        draft: 0,
      },
      { host: 'images.unsplash.com', allowed: true, published: 1, draft: 0 },
      {
        host: 'someone-else-456.convex.cloud',
        allowed: false,
        published: 0,
        draft: 1,
      },
      { host: '(data address)', allowed: false, published: 0, draft: 1 },
      {
        host: '(relative or invalid address)',
        allowed: false,
        published: 0,
        draft: 1,
      },
    ],
    covers: [
      {
        host: 'own-deployment-123.convex.cloud',
        allowed: true,
        published: 1,
        draft: 0,
      },
    ],
  })
  // No title, text, author or id in the answer.
  const text = JSON.stringify(report)
  for (const leak of ['Pictures', 'Words to read', 'image-writer', published]) {
    expect(text).not.toContain(leak)
  }
})
