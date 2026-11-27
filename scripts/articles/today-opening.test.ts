/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import type { MutationCtx } from '../../convex/_generated/server'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import {
  EXCLUDE_LIMIT,
  MORE_LIMIT,
  WINDOW_MS,
  cleanExclude,
  firstSentence,
  minutesLeft,
  openingOf,
  windowOf,
} from '../../convex/lib/todayOpening'

const modules = import.meta.glob('../../convex/**/*.ts')

/** A sentence of nine words. */
const SENTENCE = 'The ledger sat in the drawer under the bread.'
const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})
/** A body of `count` paragraphs, each of `sentences` ten-word sentences. */
const body = (count: number, sentences = 3, tag = '') => ({
  type: 'doc',
  content: Array.from({ length: count }, (_, i) =>
    paragraph(
      `${tag}Part ${i + 1}: ${Array.from({ length: sentences }, () => SENTENCE).join(' ')}`
    )
  ),
})

/** Day 1000 since the epoch, at 07:00 UTC: inside the 06:00 window. */
const NOW = 1000 * 24 * 60 * 60 * 1000 + 7 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

async function writer(ctx: MutationCtx, username: string, name?: string) {
  return ctx.db.insert('users', {
    email: `${username}@example.test`,
    username,
    name,
    createdAt: 1,
    updatedAt: 1,
  })
}

function article(
  ctx: MutationCtx,
  authorId: Id<'users'>,
  username: string,
  slug: string,
  publishedAt: number,
  overrides: Partial<Doc<'articles'>> = {}
) {
  return ctx.db.insert('articles', {
    slug,
    title: `Title ${slug}`,
    content: body(5, 3, `${slug} `),
    published: true,
    publishedAt,
    authorId,
    authorUsername: username,
    writerNotes: 'private planning notes',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  })
}

/** n writers with one article each, published a day before NOW. */
async function catalogue(t: ReturnType<typeof convexTest>, n: number) {
  return t.run(async (ctx) => {
    const ids: Id<'articles'>[] = []
    for (let i = 0; i < n; i++) {
      const username = `writer${i}`
      const authorId = await writer(ctx, username, `Writer ${i}`)
      ids.push(
        await article(ctx, authorId, username, `a${i}`, NOW - 24 * HOUR - i)
      )
    }
    return ids
  })
}

describe('today.opening', () => {
  test('an empty catalogue opens on nothing, and says so', async () => {
    const t = convexTest(schema, modules)
    const result = await t.query(api.today.opening, { at: NOW })
    expect(result.opening).toBeNull()
    expect(result.more).toEqual([])
    expect(result.window).toEqual(windowOf(NOW))
  })

  test('never a draft, an unpublished article, a placeholder title or an article with no body', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const day = NOW - 24 * HOUR
      const draftAuthor = await writer(ctx, 'drafter')
      await article(ctx, draftAuthor, 'drafter', 'draft', day, {
        published: false,
        publishedAt: undefined,
      })
      // Published once, then taken back: still carries a publishedAt.
      const privateAuthor = await writer(ctx, 'private')
      await article(ctx, privateAuthor, 'private', 'hidden', day, {
        published: false,
      })
      const emptyAuthor = await writer(ctx, 'empty')
      await article(ctx, emptyAuthor, 'empty', 'empty', day, {
        content: { type: 'doc', content: [] },
      })
      const shortAuthor = await writer(ctx, 'short')
      await article(ctx, shortAuthor, 'short', 'short', day, {
        content: body(1, 1),
      })
      const imageAuthor = await writer(ctx, 'image')
      await article(ctx, imageAuthor, 'image', 'image', day, {
        content: {
          type: 'doc',
          content: [
            { type: 'heading', content: [{ type: 'text', text: SENTENCE }] },
            { type: 'image', attrs: { src: 'x' } },
          ],
        },
      })
      const untitledAuthor = await writer(ctx, 'untitled')
      await article(ctx, untitledAuthor, 'untitled', 'untitled', day, {
        title: 'Untitled',
      })
    })
    const result = await t.query(api.today.opening, { at: NOW })
    expect(result.opening).toBeNull()
    expect(result.more).toEqual([])
  })

  test('the opening has a title, a byline, its first paragraphs and a link, and nothing private', async () => {
    const t = convexTest(schema, modules)
    const [id] = await catalogue(t, 1)
    const result = await t.query(api.today.opening, { at: NOW })
    expect(result.opening).toEqual({
      articleId: id,
      title: 'Title a0',
      href: '/writer0/a0',
      author: { name: 'Writer 0', username: 'writer0' },
      publishedAt: NOW - 24 * HOUR,
      readMinutes: expect.any(Number),
      paragraphs: [
        expect.stringMatching(/^a0 Part 1: /),
        expect.stringMatching(/^a0 Part 2: /),
        expect.stringMatching(/^a0 Part 3: /),
      ],
      continues: true,
      minutesLeft: expect.any(Number),
    })
    expect(result.opening!.minutesLeft).toBeGreaterThan(0)
    expect(JSON.stringify(result)).not.toContain('private planning notes')
  })

  test('the same window gives the same article; the opening moves with the window', async () => {
    const t = convexTest(schema, modules)
    await catalogue(t, 8)
    const { startsAt, endsAt } = windowOf(NOW)
    const first = await t.query(api.today.opening, { at: startsAt })
    const last = await t.query(api.today.opening, { at: endsAt - 1 })
    const again = await t.query(api.today.opening, { at: NOW })
    expect(last).toEqual(first)
    expect(again).toEqual(first)

    const seen = new Set<string>()
    for (let w = 0; w < 12; w++) {
      const r = await t.query(api.today.opening, { at: NOW + w * WINDOW_MS })
      seen.add(r.opening!.articleId)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  test('every writer opens Today in turn, tipped or not', async () => {
    const t = convexTest(schema, modules)
    const ids = await catalogue(t, 6)
    // The first writer's article is the most tipped by far.
    await t.run((ctx) =>
      ctx.db.patch(ids[0]!, { tipCount: 900, totalTipsUsd: 900 })
    )
    const counts = new Map<string, number>()
    const windows = 240
    for (let w = 0; w < windows; w++) {
      const r = await t.query(api.today.opening, { at: NOW + w * WINDOW_MS })
      const id = r.opening!.articleId
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    expect(counts.size).toBe(6)
    // Each of 6 writers expects 40 of 240; tips change nothing.
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(15)
      expect(n).toBeLessThan(70)
    }
  })

  test('one article per writer: their newest', async () => {
    const t = convexTest(schema, modules)
    const newest = await t.run(async (ctx) => {
      const authorId = await writer(ctx, 'prolific')
      await article(ctx, authorId, 'prolific', 'old', NOW - 48 * HOUR)
      await article(ctx, authorId, 'prolific', 'older', NOW - 72 * HOUR)
      return article(ctx, authorId, 'prolific', 'new', NOW - 24 * HOUR)
    })
    const result = await t.query(api.today.opening, { at: NOW })
    expect(result.opening!.articleId).toBe(newest)
    expect(result.more).toEqual([])
  })

  test('more to read is a short list that ends, without the opening', async () => {
    const t = convexTest(schema, modules)
    await catalogue(t, 9)
    const result = await t.query(api.today.opening, { at: NOW })
    expect(result.more).toHaveLength(MORE_LIMIT)
    const ids = [
      result.opening!.articleId,
      ...result.more.map((m) => m.articleId),
    ]
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of result.more) {
      expect(item.href).toMatch(/^\/writer\d\/a\d$/)
      expect(item.first).toMatch(
        /^a\d Part 1: The ledger sat in the drawer under the bread\.$/
      )
    }
  })

  test('an article published during the window waits for the next window', async () => {
    const t = convexTest(schema, modules)
    const [older] = await catalogue(t, 1)
    const fresh = await t.run(async (ctx) => {
      const authorId = await writer(ctx, 'fresh')
      return article(
        ctx,
        authorId,
        'fresh',
        'fresh',
        windowOf(NOW).startsAt + 1
      )
    })
    const now = await t.query(api.today.opening, { at: NOW })
    expect(now.opening!.articleId).toBe(older)
    expect(now.more).toEqual([])

    const later = new Set<string>()
    for (let w = 1; w < 12; w++) {
      const r = await t.query(api.today.opening, { at: NOW + w * WINDOW_MS })
      later.add(r.opening!.articleId)
      for (const m of r.more) later.add(m.articleId)
    }
    expect(later.has(fresh)).toBe(true)
  })

  test('a catalogue newer than the window still opens on writing', async () => {
    const t = convexTest(schema, modules)
    const id = await t.run(async (ctx) => {
      const authorId = await writer(ctx, 'first')
      return article(
        ctx,
        authorId,
        'first',
        'first',
        windowOf(NOW).startsAt + 1
      )
    })
    const result = await t.query(api.today.opening, { at: NOW })
    expect(result.opening!.articleId).toBe(id)
  })

  test('a finished article is skipped while another exists', async () => {
    const t = convexTest(schema, modules)
    await catalogue(t, 3)
    const plain = await t.query(api.today.opening, { at: NOW })
    const finished = plain.opening!.articleId
    const result = await t.query(api.today.opening, {
      at: NOW,
      exclude: [finished],
    })
    expect(result.opening!.articleId).not.toBe(finished)
    expect(result.more.map((m) => m.articleId)).not.toContain(finished)

    // Finished everything: the opening is still an article, never empty.
    const all = [finished, ...plain.more.map((m) => m.articleId)]
    const none = await t.query(api.today.opening, { at: NOW, exclude: all })
    expect(none.opening).not.toBeNull()
  })

  test('a writer whose account is gone is skipped', async () => {
    const t = convexTest(schema, modules)
    const kept = await t.run(async (ctx) => {
      const goneId = await writer(ctx, 'gone')
      await article(ctx, goneId, 'gone', 'gone', NOW - 24 * HOUR)
      await ctx.db.delete(goneId)
      const authorId = await writer(ctx, 'here')
      return article(ctx, authorId, 'here', 'here', NOW - 48 * HOUR)
    })
    const result = await t.query(api.today.opening, { at: NOW })
    expect(result.opening!.articleId).toBe(kept)
    expect(result.opening!.author).toEqual({ name: 'here', username: 'here' })
  })

  test('the byline and the link use the current handle', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const authorId = await writer(ctx, 'new_handle', 'Ama')
      await article(ctx, authorId, 'old_handle', 'piece', NOW - 24 * HOUR)
    })
    const result = await t.query(api.today.opening, { at: NOW })
    expect(result.opening!.href).toBe('/new_handle/piece')
    expect(result.opening!.author.name).toBe('Ama')
  })
})

describe('the opening rule', () => {
  test('takes whole paragraphs, at most three, and stops near the word limit', () => {
    expect(openingOf(body(5, 3))).toMatchObject({
      paragraphs: [expect.any(String), expect.any(String), expect.any(String)],
      continues: true,
    })
    // Two paragraphs of 90 words pass the word limit after the second.
    const long = openingOf(body(4, 10))!
    expect(long.paragraphs).toHaveLength(2)
    expect(long.continues).toBe(true)
    // A short article shows whole, and says it does not continue.
    const whole = openingOf(body(2, 4))!
    expect(whole.paragraphs).toHaveLength(2)
    expect(whole.continues).toBe(false)
  })

  test('reads paragraphs in quotes, joins line breaks, skips headings and empty paragraphs', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Heading' }] },
        { type: 'paragraph', content: [] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Line one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'line two.', marks: [{ type: 'bold' }] },
          ],
        },
        {
          type: 'blockquote',
          content: [
            paragraph(`${SENTENCE} ${SENTENCE} ${SENTENCE} ${SENTENCE}`),
          ],
        },
        paragraph(`${SENTENCE} ${SENTENCE} ${SENTENCE}`),
      ],
    }
    expect(openingOf(doc)!.paragraphs[0]).toBe('Line one line two.')
    expect(openingOf(doc)!.paragraphs).toHaveLength(3)
  })

  test('minutes left are the remaining words at 230 a minute, rounded up', () => {
    expect(minutesLeft(0)).toBe(0)
    expect(minutesLeft(-5)).toBe(0)
    expect(minutesLeft(1)).toBe(1)
    expect(minutesLeft(230)).toBe(1)
    expect(minutesLeft(231)).toBe(2)
    expect(minutesLeft(920)).toBe(4)
  })

  test('a first sentence is whole, or cut at a word', () => {
    expect(firstSentence('One. Two.')).toBe('One.')
    expect(firstSentence('No full stop')).toBe('No full stop')
    const long = `${'word '.repeat(60)}end.`
    expect(firstSentence(long).length).toBeLessThanOrEqual(180)
    expect(firstSentence(long)).toMatch(/word…$/)
  })

  test('cleans the skip list: ids only, at most the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => `id${i}`)
    expect(cleanExclude(many).size).toBe(EXCLUDE_LIMIT)
    expect([
      ...cleanExclude(['ok1', '../x', '', 'a b', 'x'.repeat(65)]),
    ]).toEqual(['ok1'])
    expect(cleanExclude(undefined).size).toBe(0)
  })
})
