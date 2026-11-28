/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * Every way an article leaves its public address changes what the route check
 * answers, so the article page stops using its cached copy at once (#613).
 * No writer-facing unpublish exists; an article goes private through these
 * internal paths, or its address changes with the writer's handle.
 */

const modules = import.meta.glob('../../convex/**/*.ts')

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const WRITER = 'writer_one'

async function setup(article: { title?: string } = {}) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const writer = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: WRITER,
      usernameLower: WRITER,
      articleCount: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    const live = await ctx.db.insert('articles', {
      title: article.title ?? 'A street lamp that comes on early',
      slug: 'the-lamp',
      content: {},
      authorId: writer,
      authorUsername: WRITER,
      published: true,
      publishedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    return { writer, live }
  })
  const route = (username = WRITER, slug = 'the-lamp') =>
    t.query(api.publicRoutes.resolvePublicRoute, { username, slug })
  return { t, ids, route }
}

async function expectFoundThenMissing(
  route: () => Promise<unknown>,
  hide: () => Promise<unknown>
) {
  expect(await route()).toMatchObject({ kind: 'found' })
  await hide()
  expect(await route()).toEqual({ kind: 'missing' })
}

test('a reviewed takedown (hideReviewedArticles) leaves the address', async () => {
  const { t, ids, route } = await setup()
  await expectFoundThenMissing(route, () =>
    t.mutation(internal.articles.hideReviewedArticles, {
      articles: [
        {
          id: ids.live,
          expectedTitle: 'A street lamp that comes on early',
          expectedUpdatedAt: 1,
        },
      ],
      dryRun: false,
    })
  )
})

test('unpublishArticlesWithPlaceholderTitles leaves the address', async () => {
  const { t, route } = await setup({ title: 'Untitled' })
  await expectFoundThenMissing(route, () =>
    t.mutation(internal.articles.unpublishArticlesWithPlaceholderTitles, {})
  )
})

test('setAllArticlesToDraft leaves the address', async () => {
  const { t, route } = await setup()
  await expectFoundThenMissing(route, () =>
    t.mutation(internal.articles.setAllArticlesToDraft, {})
  )
})

test('a handle change moves the address to the new handle', async () => {
  const { t, ids, route } = await setup()
  const before = await route()
  await t
    .withIdentity({ subject: `${ids.writer}|session` })
    .mutation(api.handles.changeHandle, { handle: 'writer_two' })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await route()).toEqual({ kind: 'moved', username: 'writer_two' })
  // Same article, same stored copy, new address: its own cache entry, since
  // the page keys copies by handle and slug as well as version.
  expect(await route('writer_two')).toEqual(before)
})

test('a freed slug taken by a later article gets its own version', async () => {
  // Unpublished (this path also clears publishedAt, so the draft can be
  // deleted), deleted, and the slug taken by a new article.
  const { t, ids, route } = await setup({ title: 'Untitled' })
  const before = await route()
  await t.mutation(internal.articles.unpublishArticlesWithPlaceholderTitles, {})
  await t
    .withIdentity({ subject: `${ids.writer}|session` })
    .mutation(api.articles.deleteArticle, { id: ids.live })
  const later: Id<'articles'> = await t.run((ctx) =>
    ctx.db.insert('articles', {
      title: 'A later article',
      slug: 'the-lamp',
      content: {},
      authorId: ids.writer,
      authorUsername: WRITER,
      published: true,
      publishedAt: 1,
      createdAt: 1,
      // Even with the same time stamp, the id differs.
      updatedAt: 1,
    })
  )
  const after = await route()
  expect(after).toEqual({ kind: 'found', version: `${later}:1` })
  expect(after).not.toEqual(before)
})
