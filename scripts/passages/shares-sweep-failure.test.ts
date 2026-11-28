/// <reference types="vite/client" />
/**
 * One article whose check throws never stops the share sweep: the sweep
 * records it, marks its shares checked and goes on to the shares after it.
 * The text module is wrapped so that one marked article throws.
 */
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import { SHARE_CODE_SECRET_ENV } from '../../convex/shares'

const BROKEN = 'This article cannot be read.'

vi.mock('../../lib/passages/sentences', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('../../lib/passages/sentences')>()
  return {
    ...real,
    canonicalText: (content: unknown) => {
      if (JSON.stringify(content).includes(BROKEN)) {
        throw new Error('unreadable article')
      }
      return real.canonicalText(content)
    },
  }
})

const modules = import.meta.glob('../../convex/**/*.ts')
const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv(SHARE_CODE_SECRET_ENV, 'test-share-secret-0123456789abcdef')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

test('a share check that throws is recorded and the walk goes on', async () => {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const author = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'tomas',
      createdAt: 1,
      updatedAt: 1,
    })
    const article = (slug: string, text: string) =>
      ctx.db.insert('articles', {
        title: slug,
        slug,
        content: doc(text),
        authorId: author,
        authorUsername: 'tomas',
        published: true,
        publishedAt: 1,
        contentVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      })
    return {
      first: await article('first', 'The first line stays.'),
      second: await article('second', 'The second line stays.'),
    }
  })
  const share = (articleId: typeof ids.first) =>
    t.mutation(api.shares.create, {
      articleId,
      passage: { startOffset: 0, endOffset: 0 },
    })
  const broken = await share(ids.first)
  const after = await share(ids.second)
  vi.advanceTimersByTime(1000)
  await t.run(async (ctx) => {
    // The first article becomes unreadable; the second loses its line.
    await ctx.db.patch(ids.first, {
      content: doc(BROKEN),
      updatedAt: Date.now(),
    })
    await ctx.db.patch(ids.second, {
      content: doc('Something else entirely.'),
      updatedAt: Date.now(),
    })
  })

  expect(await t.mutation(internal.shares.sweep, {})).toMatchObject({
    seen: 2,
    failed: 1,
    rechecked: 1,
    cleared: 1,
    done: true,
  })
  const rows = await t.run((ctx) => ctx.db.query('shares').collect())
  const byCode = new Map(rows.map((r) => [r.code, r]))
  expect(byCode.get(broken.code)).toMatchObject({
    quote: 'The first line stays.',
    checkedAt: Date.now(),
  })
  expect(byCode.get(after.code)!.quote).toBeNull()
  expect(
    await t.run((ctx) => ctx.db.query('shareSweeps').unique())
  ).toMatchObject({
    cursor: null,
    failures: 1,
    lastFailedArticleId: ids.first,
    lastFailureAt: Date.now(),
    lastPassAt: Date.now(),
  })
  // Marked checked: the next pass does not try it again until it changes.
  expect(await t.mutation(internal.shares.sweep, {})).toMatchObject({
    failed: 0,
    rechecked: 0,
  })
})
