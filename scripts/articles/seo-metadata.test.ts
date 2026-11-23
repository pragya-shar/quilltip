/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import {
  articleMetaDescription,
  toMetaDescription,
} from '../../lib/seo/siteMetadata'

const modules = import.meta.glob('../../convex/**/*.ts')

test.each([false, true])(
  'server metadata reads never see drafts (published=%s)',
  async (published) => {
    const t = convexTest(schema, modules)
    const authorId = await t.run(async (ctx) => {
      const author = await ctx.db.insert('users', {
        email: 'writer@example.test',
        username: 'writer',
        createdAt: 1,
        updatedAt: 1,
      })
      await ctx.db.insert('articles', {
        title: 'Words to keep',
        slug: 'words-to-keep',
        content: {},
        excerpt: 'Private until published',
        authorId: author,
        authorUsername: 'writer',
        published,
        createdAt: 1,
        updatedAt: 1,
      })
      return author
    })
    const args = { username: 'writer', slug: 'words-to-keep' }
    const anonymous = await t.query(api.articles.getArticleBySlug, args)
    const asAuthor = await t
      .withIdentity({ subject: `${authorId}|session` })
      .query(api.articles.getArticleBySlug, args)
    if (published) {
      expect(anonymous?.title).toBe('Words to keep')
    } else {
      expect(anonymous).toBeNull()
      expect(asAuthor).toBeNull()
    }
  }
)

test('descriptions prefer the excerpt and fall back to article text', () => {
  expect(
    articleMetaDescription({ excerpt: '  A short   excerpt ', content: {} })
  ).toBe('A short excerpt')
  expect(
    articleMetaDescription({
      excerpt: '',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
        ],
      },
    })
  ).toBe('Body text')
})

test('long descriptions are cut at a word boundary', () => {
  const result = toMetaDescription('word '.repeat(60))
  expect(result.length).toBeLessThanOrEqual(160)
  expect(result.endsWith('word…')).toBe(true)
})
