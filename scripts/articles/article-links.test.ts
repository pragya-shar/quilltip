/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import { storedArticleContent } from '../../convex/lib/articleContent'

const modules = import.meta.glob('../../convex/**/*.ts')

// Link marks as an editor or a crafted request may send them.
const sent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'stored',
          marks: [
            { type: 'bold' },
            {
              type: 'link',
              attrs: {
                href: 'https://example.com/a',
                target: '_self',
                rel: 'opener',
                class: 'x',
                title: 't',
              },
            },
          ],
        },
        {
          type: 'text',
          text: ' odd',
          marks: [{ type: 'link', attrs: { href: 5 } }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'nested',
              marks: [{ type: 'link', attrs: { href: '/b', target: '_top' } }],
            },
          ],
        },
      ],
    },
  ],
}
const kept = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'stored',
          marks: [
            { type: 'bold' },
            { type: 'link', attrs: { href: 'https://example.com/a' } },
          ],
        },
        {
          type: 'text',
          text: ' odd',
          marks: [{ type: 'link', attrs: { href: null } }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'nested',
              marks: [{ type: 'link', attrs: { href: '/b' } }],
            },
          ],
        },
      ],
    },
  ],
}

async function setup() {
  const t = convexTest(schema, modules)
  const author = await t.run((ctx) =>
    ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'writer',
      createdAt: 1,
      updatedAt: 1,
    })
  )
  return { t, writer: t.withIdentity({ subject: `${author}|session` }) }
}

test('storedArticleContent keeps only the address of every link mark', () => {
  expect(storedArticleContent(sent)).toEqual(kept)
  // The input is not changed.
  expect(JSON.stringify(sent)).toContain('"target":"_self"')
  expect(storedArticleContent(null)).toBeNull()
})

test('createArticle stores link marks with only their address (#612)', async () => {
  const { t, writer } = await setup()
  const id = await writer.mutation(api.articles.createArticle, {
    title: 'Links',
    content: sent,
  })
  expect((await t.run((ctx) => ctx.db.get(id)))?.content).toEqual(kept)
})

test('updateArticle stores link marks with only their address (#612)', async () => {
  const { t, writer } = await setup()
  const id = await writer.mutation(api.articles.createArticle, {
    title: 'Links',
    content: { type: 'doc', content: [] },
  })
  await writer.mutation(api.articles.updateArticle, { id, content: sent })
  expect((await t.run((ctx) => ctx.db.get(id)))?.content).toEqual(kept)
})

test('saveDraft stores link marks with only their address, new and existing (#612)', async () => {
  const { t, writer } = await setup()
  const id = await writer.mutation(api.articles.saveDraft, {
    title: 'Links',
    content: sent,
  })
  expect((await t.run((ctx) => ctx.db.get(id)))?.content).toEqual(kept)
  await t.run((ctx) =>
    ctx.db.patch(id, { content: { type: 'doc', content: [] } })
  )
  await writer.mutation(api.articles.saveDraft, {
    id,
    title: 'Links',
    content: sent,
  })
  expect((await t.run((ctx) => ctx.db.get(id)))?.content).toEqual(kept)
})
