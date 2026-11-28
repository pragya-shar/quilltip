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
  return { t, writer, draft, authorId }
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

test.each([
  [
    'inside a list item in a blockquote',
    {
      type: 'blockquote',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Nested.' }],
                },
                { type: 'resizableImage', attrs: { src: otherConvex } },
              ],
            },
          ],
        },
      ],
    },
  ],
  ['as an image node', { type: 'image', attrs: { src: otherConvex } }],
])('publishArticle refuses an outside image %s (#615)', async (_, node) => {
  const { draft, writer } = await setup()
  const id = await draft({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Words to read.' }],
      },
      node,
    ],
  })
  await expectRefused(
    writer.mutation(api.articles.publishArticle, { id }),
    otherConvex
  )
})

test('publishArticle refuses an image without an address, and says so (#615)', async () => {
  const { draft, writer } = await setup()
  const id = await draft({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Words to read.' }],
      },
      { type: 'resizableImage', attrs: {} },
    ],
  })
  const error = await writer.mutation(api.articles.publishArticle, { id }).then(
    () => null,
    (e: unknown) => e
  )
  expect((error as ConvexError<string>).data).toMatch(
    /^An image in this article has no address\./
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

test('countImageHosts counts allowed and refused addresses per host, by published and draft, across pages, with nothing else (#615)', async () => {
  const { t, draft, writer, authorId } = await setup()
  const published = await draft(body(own, own, unsplash), own)
  await writer.mutation(api.articles.publishArticle, { id: published })
  // Published before this rule: an outside image readers no longer see.
  await t.run((ctx) =>
    ctx.db.insert('articles', {
      title: 'Older pictures',
      slug: 'older-pictures',
      excerpt: 'An older piece with pictures.',
      content: {
        ...body(otherConvex, own),
        content: [
          ...body(otherConvex, own).content,
          // One video the renderers rebuild, one they show without a frame.
          { type: 'youtube', attrs: { src: 'https://youtu.be/dQw4w9WgXcQ' } },
          {
            type: 'youtube',
            attrs: {
              src: 'https://www.youtube.com/embed/videoseries?list=PLx',
            },
          },
        ],
      },
      coverImage: otherConvex,
      tags: [],
      authorId,
      authorUsername: 'image-writer',
      published: true,
      publishedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
  )
  // One host can hold allowed and refused addresses: judged one by one.
  await draft(
    body(
      'https://img.youtube.com/vi/dQw4w9WgXcQ/0.jpg',
      'https://img.youtube.com/other.jpg',
      'http://images.unsplash.com/photo-2',
      unsplash,
      'data:image/png;base64,AAAA',
      '/relative.png'
    )
  )
  await draft({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Words to read.' }],
      },
      { type: 'youtube', attrs: { src: 'https://evil.example/embed/x' } },
    ],
  })
  // Twelve more drafts, so the outside host appears on two pages of ten.
  for (let n = 0; n < 12; n += 1) await draft(body(otherConvex))
  const report = await t.action(internal.articleImageHosts.countImageHosts, {})
  const row = (
    host: string,
    publishedAllowed: number,
    publishedRefused: number,
    draftAllowed: number,
    draftRefused: number
  ) => ({
    host,
    publishedAllowed,
    publishedRefused,
    draftAllowed,
    draftRefused,
  })
  expect(report).toEqual({
    storageOrigin: OWN,
    articles: { published: 2, draft: 14 },
    images: [
      row('someone-else-456.convex.cloud', 0, 1, 0, 12),
      row('own-deployment-123.convex.cloud', 3, 0, 0, 0),
      row('images.unsplash.com', 1, 0, 1, 1),
      row('img.youtube.com', 0, 0, 1, 1),
      row('(data address)', 0, 0, 0, 1),
      row('(relative or invalid address)', 0, 0, 0, 1),
    ],
    covers: [
      row('own-deployment-123.convex.cloud', 1, 0, 0, 0),
      row('someone-else-456.convex.cloud', 0, 1, 0, 0),
    ],
    embeds: {
      publishedRebuilt: 1,
      publishedNoFrame: 1,
      draftRebuilt: 0,
      draftNoFrame: 1,
    },
    avatars: [],
  })
  // No address, title, text, author or id in the answer.
  const text = JSON.stringify(report)
  for (const leak of [
    'Pictures',
    'Older pictures',
    'Words to read',
    'image-writer',
    published,
    '/api/storage/',
    '/vi/',
    'photo-',
  ]) {
    expect(text).not.toContain(leak)
  }
})
