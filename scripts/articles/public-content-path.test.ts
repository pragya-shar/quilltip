/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import {
  APP_ROUTE_SEGMENTS,
  publicContentPath,
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
])('publicContentPath(%s)', (path, expected) => {
  expect(publicContentPath(path)).toEqual(expected)
})

test('publicRouteExists matches what the pages can show', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const writer = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'writer',
      createdAt: 1,
      updatedAt: 1,
    })
    const base = {
      content: {},
      authorId: writer,
      authorUsername: 'writer',
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
  const exists = (username: string, slug?: string) =>
    t.query(api.publicRoutes.publicRouteExists, { username, slug })

  expect(await exists('writer')).toBe(true)
  expect(await exists('writer', 'live')).toBe(true)
  expect(await exists('writer', 'draft')).toBe(false)
  expect(await exists('writer', 'missing')).toBe(false)
  expect(await exists('nobody')).toBe(false)
  expect(await exists('nobody', 'live')).toBe(false)
})
