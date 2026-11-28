/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import { avatarSourceRefusal } from '../../lib/security/imageSources'

const modules = import.meta.glob('../../convex/**/*.ts')

const OWN = 'https://own-deployment-123.convex.cloud'
const own = `${OWN}/api/storage/5c1e2f0a-photo`
const unsplash = 'https://images.unsplash.com/photo-1?w=200'
const otherConvex = 'https://someone-else-456.convex.cloud/api/storage/photo'

// Uploaded photos are on CONVEX_CLOUD_URL, as on a real deployment.
beforeEach(() => vi.stubEnv('CONVEX_CLOUD_URL', OWN))
afterEach(() => vi.unstubAllEnvs())

async function setup(avatar?: string) {
  const t = convexTest(schema, modules)
  const id = await t.run((ctx) =>
    ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'photo-writer',
      name: 'Photo Writer',
      ...(avatar ? { avatar } : {}),
      createdAt: 1,
      updatedAt: 1,
    })
  )
  return { t, id, writer: t.withIdentity({ subject: `${id}|session` }) }
}

test('updateProfile refuses a photo from another host and keeps the old one (#633)', async () => {
  const { t, id, writer } = await setup(own)
  for (const src of [
    otherConvex,
    `${OWN}/api/query`,
    'https://tracker.example/pixel.png',
    'http://images.unsplash.com/photo-1',
  ]) {
    const error = await writer
      .mutation(api.users.updateProfile, { avatar: src })
      .then(
        () => null,
        (e: unknown) => e
      )
    expect(error, src).toBeInstanceOf(ConvexError)
    expect((error as ConvexError<string>).data).toBe(avatarSourceRefusal(src))
  }
  expect((await t.run((ctx) => ctx.db.get(id)))?.avatar).toBe(own)
})

test('the refusal names the photo and the hosts that are allowed (#633)', () => {
  expect(avatarSourceRefusal(otherConvex)).toBe(
    `This photo cannot be used: ${otherConvex}. Profile photos must be uploaded, or come from img.youtube.com, images.unsplash.com, plus.unsplash.com or arweave.net.`
  )
})

test('updateProfile keeps an uploaded or listed photo, and clearing still works (#633)', async () => {
  const { t, id, writer } = await setup()
  await writer.mutation(api.users.updateProfile, { avatar: own })
  expect((await t.run((ctx) => ctx.db.get(id)))?.avatar).toBe(own)
  await writer.mutation(api.users.updateProfile, { avatar: unsplash })
  expect((await t.run((ctx) => ctx.db.get(id)))?.avatar).toBe(unsplash)
  // An empty address removes the photo, as before.
  await writer.mutation(api.users.updateProfile, { avatar: '' })
  expect((await t.run((ctx) => ctx.db.get(id)))?.avatar).toBe('')
  await writer.mutation(api.users.updateProfile, { avatar: own })
  await writer.mutation(api.users.clearAvatar, {})
  expect((await t.run((ctx) => ctx.db.get(id)))?.avatar).toBeUndefined()
  // A name change alone is not checked against the photo.
  await t.run((ctx) => ctx.db.patch(id, { avatar: otherConvex }))
  await writer.mutation(api.users.updateProfile, { name: 'Photo Writer Two' })
  expect((await t.run((ctx) => ctx.db.get(id)))?.name).toBe('Photo Writer Two')
})

test('countImageHosts counts profile photo hosts, allowed and refused, with nothing else (#633)', async () => {
  const t = convexTest(schema, modules)
  const avatars = [
    own,
    own,
    unsplash,
    otherConvex,
    'http://images.unsplash.com/x',
    undefined,
  ]
  for (const [n, avatar] of avatars.entries()) {
    await t.run((ctx) =>
      ctx.db.insert('users', {
        email: `photo-${n}@example.test`,
        username: `photo-${n}`,
        name: `Photo Person ${n}`,
        ...(avatar ? { avatar } : {}),
        createdAt: 1,
        updatedAt: 1,
      })
    )
  }
  const report = await t.action(internal.articleImageHosts.countImageHosts, {})
  expect(report.avatars).toEqual([
    { host: 'own-deployment-123.convex.cloud', allowed: 2, refused: 0 },
    { host: 'images.unsplash.com', allowed: 1, refused: 1 },
    { host: 'someone-else-456.convex.cloud', allowed: 0, refused: 1 },
  ])
  const text = JSON.stringify(report)
  for (const leak of [
    'Photo Person',
    'photo-',
    '@example.test',
    '/api/storage/',
  ]) {
    expect(text).not.toContain(leak)
  }
})
