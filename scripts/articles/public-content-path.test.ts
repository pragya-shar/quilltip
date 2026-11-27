/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import {
  APP_ROUTE_SEGMENTS,
  publicContentPath,
  writerPathUsername,
} from '../../lib/routing/publicContentPath'
import { REDIRECTED_SEGMENTS } from '../../lib/routing/redirects'

const modules = import.meta.glob('../../convex/**/*.ts')
const appPages = Object.keys(import.meta.glob('../../app/**/page.tsx'))

// A path that redirects keeps its segment reserved, so no writer can take
// a handle that the redirect would hide.
test('every top-level app route and redirect is excluded from the writer check', () => {
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
  for (const segment of REDIRECTED_SEGMENTS) topLevel.add(segment)
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
])('publicContentPath(%s)', (path, expected) => {
  expect(publicContentPath(path)).toEqual(expected)
})

test('resolvePublicRoute matches what the pages can show', async () => {
  const t = convexTest(schema, modules)
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
    await ctx.db.insert('articles', {
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
  expect(await resolve('Writer', 'live')).toEqual({ kind: 'found' })
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
