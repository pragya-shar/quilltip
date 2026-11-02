/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'

const modules = import.meta.glob('../../convex/**/*.ts')

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
    const insert = (slug: string, publishedAt: number, overrides = {}) =>
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
