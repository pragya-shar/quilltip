/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { getSchema, getText, getTextSerializersFromSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { estimateReadingMinutes } from '../../lib/reading-time'
import { api, internal } from '../../convex/_generated/api'

const modules = import.meta.glob('../../convex/**/*.ts')
const body = (words: number) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: Array(words).fill('word').join(' ') }],
    },
  ],
})

test.each([undefined, 1, 99])(
  'legacy published cards ignore a missing or stale estimate (%s), including indexed search',
  async (readTime) => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const authorId = await ctx.db.insert('users', {
        email: 'legacy@example.test',
        username: 'legacy-writer',
        createdAt: 1,
        updatedAt: 1,
      })
      await ctx.db.insert('articles', {
        title: 'Legacy minutes',
        slug: 'legacy-minutes',
        content: body(1298),
        published: true,
        authorId,
        authorUsername: 'legacy-writer',
        readTime,
        createdAt: 1,
        updatedAt: 1,
      })
    })
    expect(
      (await t.query(api.articles.listArticles, {})).articles[0]?.readTime
    ).toBe(7)
    await t.mutation(internal.readingRoomIndex.backfill, {})
    expect(
      (
        await t.query(api.articles.listArticles, {
          search: 'Legacy',
          searchByWriterOrTitle: true,
        })
      ).articles[0]?.readTime
    ).toBe(7)
  }
)

test('saved edits keep initial publication and live Reading Room estimates current across a minute boundary', async () => {
  const t = convexTest(schema, modules)
  const authorId = await t.run((ctx) =>
    ctx.db.insert('users', {
      email: 'reading-time@example.test',
      username: 'reading-time-writer',
      name: 'Reading Time Writer',
      stellarAddress: 'G' + 'A'.repeat(55),
      createdAt: 1,
      updatedAt: 1,
    })
  )
  const author = t.withIdentity({ subject: `${authorId}|session` })
  const title = 'Counting the minutes'
  const id = await author.mutation(api.articles.saveDraft, {
    title,
    content: body(1),
  })
  await author.mutation(api.articles.saveDraft, {
    id,
    title,
    content: body(201),
  })
  // Suppress permanent storage in this isolated in-memory fixture.
  await t.run((ctx) => ctx.db.patch(id, { arweaveStatus: 'verified' }))
  await author.mutation(api.articles.publishArticle, { id })
  expect(
    (await t.query(api.articles.listArticles, {})).articles[0]?.readTime
  ).toBe(2)
  await author.mutation(api.articles.saveDraft, {
    id,
    title,
    content: body(401),
  })
  expect(
    (await author.query(api.articles.getArticleById, { id }))?.readTime
  ).toBe(3)
  expect(
    (await t.query(api.articles.listArticles, {})).articles[0]?.readTime
  ).toBe(3)
})

test('formatted fragments, rich blocks and hard breaks match editor word boundaries', async () => {
  const { estimateArticleReadingMinutes } =
    await import('../../lib/reading-time')
  const content = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        content: [{ type: 'text', text: 'word '.repeat(198).trim() }],
      },
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'sun' },
              { type: 'text', text: 'light', marks: [{ type: 'bold' }] },
              { type: 'hardBreak' },
              {
                type: 'text',
                text: 'moon',
                marks: [
                  { type: 'link', attrs: { href: 'https://example.test' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
  const editorSchema = getSchema([StarterKit])
  const editorMinutes = () =>
    estimateReadingMinutes(
      getText(editorSchema.nodeFromJSON(content), {
        textSerializers: getTextSerializersFromSchema(editorSchema),
      })
    )
  expect(editorMinutes()).toBe(1)
  expect(estimateArticleReadingMinutes(content)).toBe(1)
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'star' }],
  })
  expect(editorMinutes()).toBe(2)
  expect(estimateArticleReadingMinutes(content)).toBe(2)
})

test.each([
  null,
  {},
  { type: 'doc', content: [] },
  {
    type: 'doc',
    content: [{ type: 'image', attrs: { alt: 'Not body words' } }],
  },
])(
  'empty or non-text content retains a one-minute minimum: %j',
  async (content) => {
    const { estimateArticleReadingMinutes } =
      await import('../../lib/reading-time')
    expect(estimateArticleReadingMinutes(content)).toBe(1)
  }
)
