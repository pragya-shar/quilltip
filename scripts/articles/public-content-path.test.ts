/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  APP_ROUTE_SEGMENTS,
  publicContentPath,
  writerPathUsername,
} from '../../lib/routing/publicContentPath'

const modules = import.meta.glob('../../convex/**/*.ts')
const appPages = Object.keys(import.meta.glob('../../app/**/page.tsx'))

test('every top-level app route is excluded from the writer check', () => {
  const topLevel = new Set(
    appPages
      .map((file) =>
        file
          .replace('../../app/', '')
          .split('/')
          .filter((segment) => !/^\(.*\)$/.test(segment))
      )
      .map((segments) => segments[0])
      .filter(
        (segment): segment is string =>
          !!segment && segment !== 'page.tsx' && !segment.startsWith('[')
      )
  )
  expect([...topLevel].sort()).toEqual([...APP_ROUTE_SEGMENTS].sort())
})

test.each([
  ['/pragya', { username: 'pragya' }],
  [
    '/pragya/fame-beyond-limits',
    { username: 'pragya', slug: 'fame-beyond-limits' },
  ],
  ['/a%20b/c', { username: 'a b', slug: 'c' }],
  ['/', null],
  ['/articles', null],
  ['/dashboard/stats', null],
  ['/login', null],
  ['/robots.txt', null],
  ['/images/banner.png', null],
  ['/a/b/c', null],
  ['/_next', null],
  ['/_vercel', null],
  ['/_writer', { username: '_writer' }],
  ['/_writer/missing', { username: '_writer', slug: 'missing' }],
  ['/%E0%A4%A', null],
  // No handle starts with "@" (#609): never a writer page, never a check.
  ['/@pragya', null],
  ['/@pragya/fame-beyond-limits', null],
  ['/%40pragya', null],
])('publicContentPath(%s)', (path, expected) => {
  expect(publicContentPath(path)).toEqual(expected)
})

test('resolvePublicRoute matches what the pages can show', async () => {
  const t = convexTest(schema, modules)
  let live: Id<'articles'> | undefined
  await t.run(async (ctx) => {
    const writer = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'Writer',
      usernameLower: 'writer',
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.insert('usernameHistory', {
      userId: writer,
      username: 'old_name',
      usernameLower: 'old_name',
      retiredAt: 1,
    })
    const base = {
      content: {},
      authorId: writer,
      authorUsername: 'Writer',
      createdAt: 1,
      updatedAt: 1,
    }
    live = await ctx.db.insert('articles', {
      ...base,
      title: 'Live',
      slug: 'live',
      published: true,
    })
    await ctx.db.insert('articles', {
      ...base,
      title: 'Draft',
      slug: 'draft',
      published: false,
    })
  })
  const resolve = (username: string, slug?: string) =>
    t.query(api.publicRoutes.resolvePublicRoute, { username, slug })

  expect(await resolve('Writer')).toEqual({ kind: 'found' })
  // A found article names its stored copy, so the page can tell whether its
  // cached copy is current.
  expect(await resolve('Writer', 'live')).toEqual({
    kind: 'found',
    version: `${live}:1`,
  })
  expect(await resolve('Writer', 'draft')).toEqual({ kind: 'missing' })
  expect(await resolve('nobody')).toEqual({ kind: 'missing' })
  // Different letter case and earlier handles redirect to the current one.
  expect(await resolve('writer')).toEqual({ kind: 'moved', username: 'Writer' })
  expect(await resolve('Old_Name', 'live')).toEqual({
    kind: 'moved',
    username: 'Writer',
  })
  expect(await resolve('old_name', 'draft')).toEqual({ kind: 'missing' })
})

test.each([
  ['/nobody-here', 'nobody-here'],
  ['/_writer', '_writer'],
  ['/a%20b', 'a b'],
  ['/nobody-here/missing-article', null],
  ['/articles', null],
  ['/dashboard/stats', null],
  ['/robots.txt', null],
  ['/a/b/c', null],
  ['/', null],
])('writerPathUsername(%s)', (path, expected) => {
  expect(writerPathUsername(path)).toBe(expected)
})

test('an article version changes with every write and with its id', async () => {
  const t = convexTest(schema, modules)
  const { writer, first } = await t.run(async (ctx) => {
    const writer = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'Writer',
      usernameLower: 'writer',
      createdAt: 1,
      updatedAt: 1,
    })
    const first = await ctx.db.insert('articles', {
      content: {},
      authorId: writer,
      authorUsername: 'Writer',
      createdAt: 1,
      updatedAt: 1,
      title: 'Live',
      slug: 'live',
      published: true,
    })
    return { writer, first }
  })
  const version = async () => {
    const route = await t.query(api.publicRoutes.resolvePublicRoute, {
      username: 'Writer',
      slug: 'live',
    })
    return route.kind === 'found' ? route.version : route.kind
  }
  const before = await version()
  await t.run((ctx) => ctx.db.patch(first, { updatedAt: 2 }))
  const edited = await version()
  expect(edited).not.toEqual(before)
  // Hidden: missing. Published again: found, under a new version.
  await t.run((ctx) => ctx.db.patch(first, { published: false, updatedAt: 3 }))
  expect(await version()).toBe('missing')
  await t.run((ctx) => ctx.db.patch(first, { published: true, updatedAt: 4 }))
  const republished = await version()
  expect([before, edited]).not.toContain(republished)
  // Deleted, and another article takes the slug with the same time stamp.
  await t.run(async (ctx) => {
    await ctx.db.delete(first)
    await ctx.db.insert('articles', {
      content: {},
      authorId: writer,
      authorUsername: 'Writer',
      createdAt: 4,
      updatedAt: 4,
      title: 'Another',
      slug: 'live',
      published: true,
    })
  })
  expect(await version()).not.toEqual(republished)
})
