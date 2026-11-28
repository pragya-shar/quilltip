/// <reference types="vite/client" />
// Runs under vitest (`bun run test:reader`, scripts/articles/convex.config.mts):
// convex-test loads the functions through `import.meta.glob`, which plain
// `bun test` does not provide.
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
  compareForWindow,
  firstSentence,
  minutesLeft,
  openingOf,
  readAnchor,
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

/** Day 1000 since the epoch, at 07:00 UTC: the start of the 07:00 window. */
const NOW = 1000 * 24 * 60 * 60 * 1000 + 7 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000
/** Half past seven, inside the 07:00 window, for articles of that hour. */
const HALF_PAST = NOW + 30 * MINUTE

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
    // 12 paragraphs of 30 words: longer than the opening.
    content: body(12, 3, `${slug} `),
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
      paragraphs: expect.any(Array),
      continues: true,
      // Seven paragraphs shown (0 to 6): Read more continues at the eighth.
      readMoreHref: '/writer0/a0#s-7-0',
      minutesLeft: expect.any(Number),
    })
    // Whole paragraphs up to 220 words: seven of 30 words (210).
    expect(result.opening!.paragraphs).toHaveLength(7)
    expect(result.opening!.paragraphs[0]).toMatch(/^a0 Part 1: /)
    expect(result.opening!.paragraphs[6]).toMatch(/^a0 Part 7: /)
    // 150 words left at 230 a minute.
    expect(result.opening!.minutesLeft).toBe(1)
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

  test('among the candidates, each writer opens Today in turn, tipped or not', async () => {
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
    await catalogue(t, 15)
    const result = await t.query(api.today.opening, { at: NOW })
    expect(result.more).toHaveLength(MORE_LIMIT)
    const ids = [
      result.opening!.articleId,
      ...result.more.map((m) => m.articleId),
    ]
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of result.more) {
      expect(item.href).toMatch(/^\/writer\d+\/a\d+$/)
      expect(item.first).toMatch(
        /^a\d+ Part 1: The ledger sat in the drawer under the bread\.$/
      )
    }
  })

  test('an article from the current hour follows the hour’s order, and the opening holds', async () => {
    const t = convexTest(schema, modules)
    const [older] = await catalogue(t, 1)
    const fresh = await t.run(async (ctx) => {
      const authorId = await writer(ctx, 'fresh')
      return article(ctx, authorId, 'fresh', 'fresh', HALF_PAST - 10 * MINUTE)
    })
    const now = await t.query(api.today.opening, { at: HALF_PAST })
    expect(now.opening!.articleId).toBe(older)
    expect(now.more.map((m) => m.articleId)).toEqual([fresh])
    // Later in the same hour: the same opening.
    const later = await t.query(api.today.opening, {
      at: HALF_PAST + 29 * MINUTE,
    })
    expect(later.opening!.articleId).toBe(older)
  })

  test('a catalogue whose every article is from the current hour opens on its newest', async () => {
    const t = convexTest(schema, modules)
    const start = windowOf(HALF_PAST).startsAt
    const [first, second, third] = await t.run(async (ctx) => {
      const ids: Id<'articles'>[] = []
      for (const [i, at] of [
        start,
        start + 10 * MINUTE,
        start + 20 * MINUTE,
      ].entries()) {
        const authorId = await writer(ctx, `hour${i}`)
        ids.push(await article(ctx, authorId, `hour${i}`, `h${i}`, at))
      }
      return ids
    })
    const result = await t.query(api.today.opening, { at: HALF_PAST })
    expect(result.opening!.articleId).toBe(third)
    expect(result.more.map((m) => m.articleId)).toEqual([second, first])
  })

  test('a catalogue from today but an earlier hour opens in the hour’s order', async () => {
    const t = convexTest(schema, modules)
    const start = windowOf(HALF_PAST).startsAt
    const ids = await t.run(async (ctx) => {
      const ids: Id<'articles'>[] = []
      for (let i = 0; i < 4; i++) {
        const authorId = await writer(ctx, `early${i}`)
        ids.push(
          await article(
            ctx,
            authorId,
            `early${i}`,
            `e${i}`,
            start - (i + 1) * HOUR
          )
        )
      }
      return ids
    })
    const result = await t.query(api.today.opening, { at: HALF_PAST })
    const order = [...ids].sort(compareForWindow(windowOf(HALF_PAST).index))
    expect([
      result.opening!.articleId,
      ...result.more.map((m) => m.articleId),
    ]).toEqual(order)
  })

  test('at the hour boundary an article of the past hour joins the hour’s order', async () => {
    const t = convexTest(schema, modules)
    const [older] = await catalogue(t, 1)
    const nextHour = windowOf(HALF_PAST).endsAt
    const fresh = await t.run(async (ctx) => {
      const authorId = await writer(ctx, 'fresh')
      return article(ctx, authorId, 'fresh', 'fresh', HALF_PAST)
    })
    // The last moment of the hour: the opening held, the new article after it.
    const before = await t.query(api.today.opening, { at: nextHour - 1 })
    expect(before.opening!.articleId).toBe(older)
    expect(before.more.map((m) => m.articleId)).toEqual([fresh])
    // The first moment of the next hour: both are in that hour's order.
    const after = await t.query(api.today.opening, { at: nextHour })
    const order = [older, fresh].sort(
      compareForWindow(windowOf(nextHour).index)
    )
    expect([
      after.opening!.articleId,
      ...after.more.map((m) => m.articleId),
    ]).toEqual(order)
  })

  test('an article published after the moment rendered is not shown yet', async () => {
    const t = convexTest(schema, modules)
    const start = windowOf(HALF_PAST).startsAt
    const [early, late] = await t.run(async (ctx) => {
      const a = await writer(ctx, 'early')
      const b = await writer(ctx, 'late')
      return [
        await article(ctx, a, 'early', 'early', start + 1),
        await article(ctx, b, 'late', 'late', HALF_PAST + 1),
      ]
    })
    const now = await t.query(api.today.opening, { at: HALF_PAST })
    expect(now.opening!.articleId).toBe(early)
    expect(now.more).toEqual([])
    const after = await t.query(api.today.opening, { at: HALF_PAST + 1 })
    expect(after.opening!.articleId).toBe(late)
  })

  test('an opened article from the current hour moves to the back like any other', async () => {
    const t = convexTest(schema, modules)
    const start = windowOf(HALF_PAST).startsAt
    const [older, newer] = await t.run(async (ctx) => {
      const a = await writer(ctx, 'older')
      const b = await writer(ctx, 'newer')
      return [
        await article(ctx, a, 'older', 'older', start + 1),
        await article(ctx, b, 'newer', 'newer', start + 10 * MINUTE),
      ]
    })
    const result = await t.query(api.today.opening, {
      at: HALF_PAST,
      exclude: [newer],
    })
    expect(result.opening!.articleId).toBe(older)
    // A skipped article does not fill the list once another opens.
    expect(result.more).toEqual([])
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
  test('takes whole paragraphs up to 220 words, never more', () => {
    // Paragraphs of 29 words: seven fit (203), the eighth would not.
    const opening = openingOf(body(12, 3))!
    expect(opening.paragraphs).toHaveLength(7)
    expect(opening.shownWords).toBe(203)
    expect(opening.continues).toBe(true)
    // Paragraphs of 92 words: two fit (184).
    expect(openingOf(body(4, 10))!.paragraphs).toHaveLength(2)
    // A short article shows whole, and says it does not continue.
    const whole = openingOf(body(2, 4))!
    expect(whole.paragraphs).toHaveLength(2)
    expect(whole.continues).toBe(false)
    expect(whole.shownWords).toBe(whole.totalWords)
    expect(opening.nextParagraph).toBe(7)
  })

  test('a first paragraph over 220 words is cut at a sentence', () => {
    // 30 sentences of nine words in one paragraph, then a second paragraph.
    const opening = openingOf(body(2, 30))!
    expect(opening.paragraphs).toHaveLength(1)
    expect(opening.shownWords).toBeLessThanOrEqual(220)
    expect(opening.paragraphs[0]).toMatch(/bread\.$/)
    expect(opening.continues).toBe(true)
    // Reading continues in the same first paragraph.
    expect(opening.nextParagraph).toBe(0)
  })

  test('needs at least two body paragraphs', () => {
    expect(openingOf(body(1, 30))).toBeNull()
    expect(openingOf(body(2, 1))).not.toBeNull()
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
    const many = Array.from({ length: 60 }, (_, i) => `id${i}`)
    expect(cleanExclude(many).size).toBe(EXCLUDE_LIMIT)
    expect([
      ...cleanExclude(['ok1', '../x', '', 'a b', 'x'.repeat(65)]),
    ]).toEqual(['ok1'])
    expect(cleanExclude(undefined).size).toBe(0)
  })
})

describe('today.opening past the first page', () => {
  test('a writer whose newest article is older than 60 others still gets a turn', async () => {
    const t = convexTest(schema, modules)
    const quiet = await t.run(async (ctx) => {
      const busyId = await writer(ctx, 'busy')
      for (let i = 0; i < 70; i++)
        await article(ctx, busyId, 'busy', `busy-${i}`, NOW - 24 * HOUR - i)
      const quietId = await writer(ctx, 'quiet')
      return article(ctx, quietId, 'quiet', 'quiet', NOW - 30 * 24 * HOUR)
    })
    const result = await t.query(api.today.opening, { at: NOW })
    const ids = [
      result.opening!.articleId,
      ...result.more.map((m) => m.articleId),
    ]
    expect(ids).toContain(quiet)
    expect(ids).toHaveLength(2)
  })

  test('60 newer articles without a body do not leave Today empty', async () => {
    const t = convexTest(schema, modules)
    const real = await t.run(async (ctx) => {
      const notesId = await writer(ctx, 'notes')
      for (let i = 0; i < 70; i++)
        await article(ctx, notesId, 'notes', `note-${i}`, NOW - 24 * HOUR - i, {
          content: body(1, 1),
        })
      const writerId = await writer(ctx, 'writer')
      return article(ctx, writerId, 'writer', 'real', NOW - 30 * 24 * HOUR)
    })
    const result = await t.query(api.today.opening, { at: NOW })
    expect(result.opening!.articleId).toBe(real)
  })
})

describe('today.latestDraft', () => {
  test('the caller’s own newest draft: id, title and words; nothing for anyone else', async () => {
    const t = convexTest(schema, modules)
    const ids = await t.run(async (ctx) => {
      const me = await writer(ctx, 'me')
      const other = await writer(ctx, 'other')
      await article(ctx, me, 'me', 'old-draft', 0, {
        published: false,
        publishedAt: undefined,
        updatedAt: 10,
      })
      const latest = await article(ctx, me, 'me', 'new-draft', 0, {
        published: false,
        publishedAt: undefined,
        title: '  The year I stopped buying books ',
        content: { type: 'doc', content: [paragraph('One two three four.')] },
        updatedAt: 20,
      })
      // A newer published article and another writer's draft never count.
      await article(ctx, me, 'me', 'published', NOW, { updatedAt: 30 })
      await article(ctx, other, 'other', 'their-draft', 0, {
        published: false,
        publishedAt: undefined,
        updatedAt: 40,
      })
      return { me, other, latest }
    })
    expect(await t.query(api.today.latestDraft, {})).toBeNull()
    const mine = await t
      .withIdentity({ subject: `${ids.me}|session` })
      .query(api.today.latestDraft, {})
    expect(mine).toEqual({
      id: ids.latest,
      title: 'The year I stopped buying books',
      words: 4,
    })
    const nobody = await t.run(async (ctx) => writer(ctx, 'nobody'))
    expect(
      await t
        .withIdentity({ subject: `${nobody}|session` })
        .query(api.today.latestDraft, {})
    ).toBeNull()
  })
})

describe('Read more', () => {
  test('a whole article links to itself, with no anchor', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const authorId = await writer(ctx, 'short')
      await article(ctx, authorId, 'short', 'short', NOW - 24 * HOUR, {
        content: body(2, 4),
      })
    })
    const result = await t.query(api.today.opening, { at: NOW })
    expect(result.opening!.continues).toBe(false)
    expect(result.opening!.readMoreHref).toBe('/short/short')
  })

  test('paragraphs in quotes count, as the article view counts them', () => {
    const doc = {
      type: 'doc',
      content: [
        paragraph(`${SENTENCE} `.repeat(20)),
        { type: 'blockquote', content: [paragraph(`${SENTENCE} `.repeat(4))] },
        { type: 'heading', content: [{ type: 'text', text: 'Heading' }] },
        paragraph(`${SENTENCE} `.repeat(20)),
      ],
    }
    // 180 + 36 words fit; the third body paragraph (index 2) does not.
    expect(openingOf(doc)!.nextParagraph).toBe(2)
    expect(readAnchor(2)).toBe('s-2-0')
  })
})

describe('the read is bounded', () => {
  test('at most 200 articles are read: a writer behind them is not a candidate that day', async () => {
    const t = convexTest(schema, modules)
    const quiet = await t.run(async (ctx) => {
      const busyId = await writer(ctx, 'busy')
      for (let i = 0; i < 210; i++)
        await article(ctx, busyId, 'busy', `busy-${i}`, NOW - 24 * HOUR - i)
      const quietId = await writer(ctx, 'quiet')
      return article(ctx, quietId, 'quiet', 'quiet', NOW - 30 * 24 * HOUR)
    })
    const result = await t.query(api.today.opening, { at: NOW })
    const ids = [
      result.opening!.articleId,
      ...result.more.map((m) => m.articleId),
    ]
    expect(ids).toHaveLength(1)
    expect(ids).not.toContain(quiet)
  })

  test('more than 50 articles at one publish time do not stall the read', async () => {
    const t = convexTest(schema, modules)
    const quiet = await t.run(async (ctx) => {
      const busyId = await writer(ctx, 'busy')
      for (let i = 0; i < 60; i++)
        await article(ctx, busyId, 'busy', `same-${i}`, NOW - 24 * HOUR)
      const quietId = await writer(ctx, 'quiet')
      return article(ctx, quietId, 'quiet', 'quiet', NOW - 30 * 24 * HOUR)
    })
    const result = await t.query(api.today.opening, { at: NOW })
    const ids = [
      result.opening!.articleId,
      ...result.more.map((m) => m.articleId),
    ]
    expect(ids).toContain(quiet)
  })
})

describe('a short first paragraph', () => {
  test('goes on into the next paragraph, cut at a sentence, never past 220 words', () => {
    const doc = {
      type: 'doc',
      content: [
        paragraph('A short first paragraph of eight words.'),
        paragraph(Array.from({ length: 30 }, () => SENTENCE).join(' ')),
        paragraph(SENTENCE),
      ],
    }
    const opening = openingOf(doc)!
    expect(opening.paragraphs).toHaveLength(2)
    expect(opening.shownWords).toBeGreaterThanOrEqual(60)
    expect(opening.shownWords).toBeLessThanOrEqual(220)
    expect(opening.paragraphs[1]).toMatch(/bread\.$/)
    // Read more continues in the paragraph that was cut.
    expect(opening.nextParagraph).toBe(1)
    expect(opening.continues).toBe(true)
  })
})
