/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import type { MutationCtx } from '../../convex/_generated/server'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'

const modules = import.meta.glob('../../convex/**/*.ts')

const insertArticle = (
  ctx: MutationCtx,
  authorId: Id<'users'>,
  slug: string,
  publishedAt: number,
  overrides: Partial<Doc<'articles'>> = {}
) =>
  ctx.db.insert('articles', {
    slug,
    title: `Article ${slug}`,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: `Opening ${slug}. Second sentence.` },
          ],
        },
      ],
    },
    published: true,
    publishedAt,
    authorId,
    authorUsername: 'writer',
    createdAt: 1,
    updatedAt: 1,
    writerNotes: 'Never return private planning notes',
    ...overrides,
  })

test('Read next fills two public destinations after skipping current, drafts, placeholders and missing authors', async () => {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const authorId = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'writer',
      createdAt: 1,
      updatedAt: 1,
    })
    const missingAuthorId = await ctx.db.insert('users', {
      email: 'gone@example.test',
      username: 'gone',
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.delete(missingAuthorId)
    const insert = (
      slug: string,
      publishedAt: number,
      overrides?: Partial<Doc<'articles'>>
    ) => insertArticle(ctx, authorId, slug, publishedAt, overrides)
    const second = await insert('second', 1)
    const first = await insert('first', 2)
    await insert('orphan-one', 3, { authorId: missingAuthorId })
    await insert('orphan-two', 4, { authorId: missingAuthorId })
    await insert('untitled', 5, { title: 'Untitled' })
    await insert('draft', 6, { published: false })
    const current = await insert('current', 7)
    return { current, first, second, authorId }
  })
  const expected = [
    {
      id: ids.first,
      title: 'Article first',
      slug: 'first',
      username: 'writer',
      opening: 'Opening first.',
    },
    {
      id: ids.second,
      title: 'Article second',
      slug: 'second',
      username: 'writer',
      opening: 'Opening second.',
    },
  ]
  expect(
    await t.query(api.articles.getReadNextArticles, { articleId: ids.current })
  ).toEqual(expected)
  expect(
    await t
      .withIdentity({ subject: `${ids.authorId}|session` })
      .query(api.articles.getReadNextArticles, { articleId: ids.current })
  ).toEqual(expected)
  await t.run((ctx) => ctx.db.patch(ids.first, { published: false }))
  expect(
    await t.query(api.articles.getReadNextArticles, { articleId: ids.current })
  ).toEqual([expected[1]])
  await t.run((ctx) => ctx.db.patch(ids.second, { published: false }))
  expect(
    await t.query(api.articles.getReadNextArticles, { articleId: ids.current })
  ).toEqual([])
})

test('Read next includes candidate 50 and excludes candidate 51', async () => {
  const t = convexTest(schema, modules)
  const { current, withinBudget } = await t.run(async (ctx) => {
    const authorId = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'writer',
      createdAt: 1,
      updatedAt: 1,
    })

    // The index scans newest first: current, 48 placeholders, then two eligible articles.
    const current = await insertArticle(ctx, authorId, 'current', 51)
    for (let publishedAt = 50; publishedAt >= 3; publishedAt--) {
      await insertArticle(
        ctx,
        authorId,
        `placeholder-${publishedAt}`,
        publishedAt,
        {
          title: 'Untitled',
        }
      )
    }
    const withinBudget = await insertArticle(ctx, authorId, 'within-budget', 2)
    await insertArticle(ctx, authorId, 'beyond-budget', 1)
    return { current, withinBudget }
  })

  expect(
    await t.query(api.articles.getReadNextArticles, { articleId: current })
  ).toEqual([
    {
      id: withinBudget,
      title: 'Article within-budget',
      slug: 'within-budget',
      username: 'writer',
      opening: 'Opening within-budget.',
    },
  ])
})
