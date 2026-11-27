/// <reference types="vite/client" />
/**
 * Passage share links (`convex/shares.ts`): a removed or changed line is never
 * shown again through a shared link, a link whose line or article is gone is
 * indistinguishable from an unknown code, and a stale quote is not kept.
 */
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  CANONICAL_GENERATIONS,
  MAX_SHAREABLE_SENTENCES,
  MAX_SHARE_QUOTE,
  RECONCILE_BATCH,
  SHARES_PER_USER_PER_HOUR,
  SHARE_CODE_ALPHABET,
  SHARE_CODE_LENGTH,
  SHARE_CODE_SECRET_ENV,
  SIGNED_IN_SHARES_PER_ARTICLE_PER_HOUR,
  SIGNED_OUT_SHARES_PER_ARTICLE_PER_DAY,
  canonicalCode,
} from '../../convex/shares'
import crons from '../../convex/crons'
import {
  canonicalText,
  identifyPassage,
  sentencesOf,
} from '../../lib/passages/sentences'

const modules = import.meta.glob('../../convex/**/*.ts')
const SECRET = 'test-share-secret-0123456789abcdef'

const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  })),
})

const ORIGINAL = doc(
  'The ferry leaves at seven. The tide decides the rest of the morning.',
  'People read on the crossing. A man folds his newspaper into eighths.'
)
const SHARED = 'The tide decides the rest of the morning.'
const TIDE_START = canonicalText(ORIGINAL).text.indexOf(SHARED)
const PEOPLE_START = canonicalText(ORIGINAL).text.indexOf('People')

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv(SHARE_CODE_SECRET_ENV, SECRET)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

type Test = Awaited<ReturnType<typeof setup>>['t']

async function setup(content: unknown = ORIGINAL) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const author = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'tomas',
      name: 'Tomas Reyes',
      stellarAddress: 'G' + 'A'.repeat(55),
      stellarAddressVerifiedAt: 1,
      stellarAddressVerifiedNetwork: 'Test SDF Network ; September 2015',
      createdAt: 1,
      updatedAt: 1,
    })
    const reader = await ctx.db.insert('users', {
      email: 'reader@example.test',
      username: 'june',
      createdAt: 1,
      updatedAt: 1,
    })
    const article = await ctx.db.insert('articles', {
      title: 'The Ferry Timetable',
      slug: 'the-ferry-timetable',
      excerpt: 'A morning crossing and the people who read on it.',
      content,
      tags: ['Essays'],
      authorId: author,
      authorUsername: 'tomas',
      authorName: 'Tomas Reyes',
      published: true,
      publishedAt: 1,
      contentVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    return { author, reader, article }
  })
  return {
    t,
    ids,
    author: t.withIdentity({ subject: `${ids.author}|session` }),
    reader: t.withIdentity({ subject: `${ids.reader}|session` }),
  }
}

async function shareRow(t: Test, code: string) {
  return t.run((ctx) =>
    ctx.db
      .query('shares')
      .withIndex('by_code', (q) => q.eq('code', code))
      .unique()
  )
}

/** Publishes new content as a later version (an edit of the published text). */
async function edit(t: Test, article: Id<'articles'>, content: unknown) {
  await t.run(async (ctx) => {
    const row = (await ctx.db.get(article))!
    await ctx.db.patch(article, {
      content,
      contentVersion: (row.contentVersion ?? 0) + 1,
      updatedAt: Date.now(),
    })
  })
}

async function errorData(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  return (error as ConvexError<Record<string, string | number>>).data
}
const errorCode = async (p: Promise<unknown>) => (await errorData(p)).code

type Client = { mutation: Test['mutation'] }

function shareAt(
  client: Client,
  article: Id<'articles'>,
  start: number,
  end = start
) {
  return client.mutation(api.shares.create, {
    articleId: article,
    passage: { startOffset: start, endOffset: end },
  })
}
const shareTide = (client: Client, article: Id<'articles'>) =>
  shareAt(client, article, TIDE_START + 4, TIDE_START + 10)

async function snapshot(t: Test) {
  return t.run(async (ctx) => ({
    shares: await ctx.db.query('shares').collect(),
    rateLimits: await ctx.db.query('rateLimits').collect(),
    sweeps: await ctx.db.query('shareSweeps').collect(),
    articles: await ctx.db.query('articles').collect(),
    scheduled: await ctx.db.system.query('_scheduled_functions').collect(),
  }))
}

async function fillBucket(t: Test, key: string, count: number) {
  await t.run((ctx) =>
    ctx.db.insert('rateLimits', { key, windowStart: Date.now(), count })
  )
}

describe('create', () => {
  test('snaps to the sentence and stores the quote and range', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    expect(code).toHaveLength(SHARE_CODE_LENGTH)
    expect([...code].every((ch) => SHARE_CODE_ALPHABET.includes(ch))).toBe(true)
    const canonical = canonicalText(ORIGINAL)
    const expected = await identifyPassage(
      ids.article,
      canonical,
      sentencesOf(canonical),
      TIDE_START,
      TIDE_START + 1
    )
    expect(await shareRow(t, code)).toMatchObject({
      kind: 'personal',
      articleId: ids.article,
      passageId: expected!.passageId,
      sentenceStart: 1,
      sentenceEnd: 1,
      quote: SHARED,
      contentVersion: 1,
      createdBy: ids.reader,
    })
  })

  test('one person sharing a line twice, by any selection, gets one code', async () => {
    const { reader, ids } = await setup()
    const a = await shareTide(reader, ids.article)
    const b = await shareAt(
      reader,
      ids.article,
      TIDE_START + 20,
      TIDE_START + 21
    )
    expect(b.code).toBe(a.code)
  })

  test('signed out: one canonical row per line, keyed with the secret, no write when it exists', async () => {
    const { t, ids } = await setup()
    const a = await shareTide(t, ids.article)
    const row = (await shareRow(t, a.code))!
    expect(row.kind).toBe('canonical')
    expect(row.createdBy).toBeUndefined()
    expect(a.code).toBe(
      await canonicalCode(SECRET, ids.article, row.passageId!, 0)
    )
    expect(a.code).not.toBe(
      await canonicalCode(`${SECRET}-other`, ids.article, row.passageId!, 0)
    )
    const before = await snapshot(t)
    expect(await shareAt(t, ids.article, TIDE_START)).toEqual(a)
    expect(await snapshot(t)).toEqual(before)
  })

  test('signed out: a passage of more than one sentence is SINGLE_SENTENCE_ONLY', async () => {
    const { t, ids, reader } = await setup()
    expect(await errorCode(shareAt(t, ids.article, 2, TIDE_START + 4))).toBe(
      'SINGLE_SENTENCE_ONLY'
    )
    // Signed in, the same range is shared.
    expect(
      (await shareAt(reader, ids.article, 2, TIDE_START + 4)).code
    ).toHaveLength(SHARE_CODE_LENGTH)
  })

  test('signed out without a usable secret is SHARING_NOT_CONFIGURED; signed in still works', async () => {
    const { t, ids, reader } = await setup()
    vi.stubEnv(SHARE_CODE_SECRET_ENV, '')
    expect(await errorCode(shareTide(t, ids.article))).toBe(
      'SHARING_NOT_CONFIGURED'
    )
    vi.stubEnv(SHARE_CODE_SECRET_ENV, 'too-short')
    expect(await errorCode(shareTide(t, ids.article))).toBe(
      'SHARING_NOT_CONFIGURED'
    )
    expect((await shareTide(reader, ids.article)).code).toHaveLength(
      SHARE_CODE_LENGTH
    )
  })

  test('canonical and personal codes for one line coexist, resolve alike and name no one', async () => {
    const { t, ids, reader, author } = await setup()
    const codes = [
      await shareTide(t, ids.article),
      await shareTide(reader, ids.article),
      await shareTide(author, ids.article),
    ].map((c) => c.code)
    expect(new Set(codes).size).toBe(3)
    const answers = await Promise.all(
      codes.map((code) => t.mutation(api.shares.resolve, { code }))
    )
    expect(answers[1]).toEqual(answers[0])
    expect(answers[2]).toEqual(answers[0])
    const json = JSON.stringify(answers)
    for (const word of [
      'createdBy',
      'kind',
      'personal',
      'canonical',
      ids.reader,
      ids.author,
      'june',
    ])
      expect(json).not.toContain(word)
  })

  test('an unpublished or missing article is NOT_FOUND, the same either way', async () => {
    const { t, ids, reader } = await setup()
    await t.run((ctx) => ctx.db.patch(ids.article, { published: false }))
    expect(await errorCode(shareTide(reader, ids.article))).toBe('NOT_FOUND')
    await t.run((ctx) => ctx.db.delete(ids.article))
    expect(await errorCode(shareTide(reader, ids.article))).toBe('NOT_FOUND')
  })

  test('whitespace or outside the text is INVALID_PASSAGE', async () => {
    const { ids, reader } = await setup()
    for (const [start, end] of [
      [TIDE_START - 1, TIDE_START],
      [10_000, 10_010],
      [5, 1],
    ] as const) {
      expect(await errorCode(shareAt(reader, ids.article, start, end))).toBe(
        'INVALID_PASSAGE'
      )
    }
  })

  test('a passage over 500 characters is PASSAGE_TOO_LONG, never shortened', async () => {
    const long = `${'word '.repeat(120).trim()}.`
    const { ids, reader } = await setup(doc(long))
    expect(await errorData(shareAt(reader, ids.article, 0, 3))).toEqual({
      code: 'PASSAGE_TOO_LONG',
      max: MAX_SHARE_QUOTE,
    })
  })

  test('an article beyond the sentence limit is ARTICLE_TOO_LONG', async () => {
    const text = Array.from(
      { length: MAX_SHAREABLE_SENTENCES + 1 },
      (_, i) => `Line ${i}.`
    ).join(' ')
    const { ids, reader } = await setup(doc(text))
    expect(await errorData(shareAt(reader, ids.article, 0))).toEqual({
      code: 'ARTICLE_TOO_LONG',
      maxSentences: MAX_SHAREABLE_SENTENCES,
    })
  })

  test('signed in: new codes are limited per person; returning a code is not counted', async () => {
    const lines = Array.from(
      { length: SHARES_PER_USER_PER_HOUR + 1 },
      (_, i) => `Line number ${i} is here.`
    ).join(' ')
    const { ids, reader } = await setup(doc(lines))
    const offsets = sentencesOf(canonicalText(doc(lines)))
    for (let i = 0; i < SHARES_PER_USER_PER_HOUR; i++) {
      await shareAt(reader, ids.article, offsets[i]!.start)
    }
    await shareAt(reader, ids.article, offsets[0]!.start)
    expect(
      await errorCode(
        shareAt(reader, ids.article, offsets[SHARES_PER_USER_PER_HOUR]!.start)
      )
    ).toBe('RATE_LIMITED')
  })

  test('signed-out and signed-in sharing never spend each other’s budget', async () => {
    const { t, ids, reader } = await setup()
    await fillBucket(
      t,
      `shares:signed-out:article:${ids.article}`,
      SIGNED_OUT_SHARES_PER_ARTICLE_PER_DAY
    )
    expect(await errorCode(shareTide(t, ids.article))).toBe('RATE_LIMITED')
    expect((await shareTide(reader, ids.article)).code).toHaveLength(
      SHARE_CODE_LENGTH
    )

    const other = await setup()
    await fillBucket(
      other.t,
      `shares:signed-in:article:${other.ids.article}`,
      SIGNED_IN_SHARES_PER_ARTICLE_PER_HOUR
    )
    expect(await errorCode(shareTide(other.reader, other.ids.article))).toBe(
      'RATE_LIMITED'
    )
    expect((await shareTide(other.t, other.ids.article)).code).toHaveLength(
      SHARE_CODE_LENGTH
    )
  })

  test('signed out, with every canonical generation taken: a random code, found again next time', async () => {
    const { t, ids } = await setup()
    const canonical = canonicalText(ORIGINAL)
    const id = await identifyPassage(
      ids.article,
      canonical,
      sentencesOf(canonical),
      TIDE_START,
      TIDE_START
    )
    await t.run(async (ctx) => {
      for (let n = 0; n < CANONICAL_GENERATIONS; n++) {
        await ctx.db.insert('shares', {
          code: await canonicalCode(SECRET, ids.article, id!.passageId, n),
          kind: 'canonical',
          articleId: ids.article,
          passageId: null,
          sentenceStart: null,
          sentenceEnd: null,
          quote: null,
          contentVersion: 1,
          createdAt: 1,
          checkedAt: 1,
          clearedAt: 1,
        })
      }
    })
    const { code } = await shareTide(t, ids.article)
    expect(await shareRow(t, code)).toMatchObject({
      kind: 'canonical',
      quote: SHARED,
    })
    expect(await t.mutation(api.shares.resolve, { code })).toMatchObject({
      status: 'exact',
    })
    expect(await shareTide(t, ids.article)).toEqual({ code })
  })
})

describe('resolve', () => {
  test('exact: the stored range and the current text, nothing else', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    const result = await t.mutation(api.shares.resolve, { code })
    expect(result).toEqual({
      status: 'exact',
      article: {
        id: ids.article,
        slug: 'the-ferry-timetable',
        title: 'The Ferry Timetable',
        writerName: 'Tomas Reyes',
        href: '/tomas/the-ferry-timetable',
      },
      passage: {
        passageId: (await shareRow(t, code))!.passageId,
        sentenceStart: 1,
        sentenceEnd: 1,
        startOffset: TIDE_START,
        endOffset: TIDE_START + SHARED.length,
        text: SHARED,
      },
    })
    expect(JSON.stringify(result)).not.toContain('quote')
  })

  test('exact after a version bump that left the line in place', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    await edit(
      t,
      ids.article,
      doc(
        'The ferry leaves at seven. The tide decides the rest of the morning.',
        'People read on the crossing. A man folds his paper.'
      )
    )
    expect(await t.mutation(api.shares.resolve, { code })).toMatchObject({
      status: 'exact',
      passage: { sentenceStart: 1, sentenceEnd: 1 },
    })
  })

  test('moved: an unchanged sentence elsewhere, same passage id', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    const passageId = (await shareRow(t, code))!.passageId
    const after = doc(
      'A new opening line. The ferry leaves at seven.',
      'People read on the crossing.',
      `${SHARED} A man folds his newspaper into eighths.`
    )
    await edit(t, ids.article, after)
    const start = canonicalText(after).text.indexOf(SHARED)
    expect(await t.mutation(api.shares.resolve, { code })).toMatchObject({
      status: 'moved',
      passage: {
        passageId,
        sentenceStart: 3,
        sentenceEnd: 3,
        startOffset: start,
        endOffset: start + SHARED.length,
        text: SHARED,
      },
    })
    expect((await shareRow(t, code))!.quote).toBe(SHARED)
  })

  test('the article link uses the writer’s current handle', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    await t.run((ctx) => ctx.db.patch(ids.author, { username: 'tomas-r' }))
    expect((await t.mutation(api.shares.resolve, { code }))!.article.href).toBe(
      '/tomas-r/the-ferry-timetable'
    )
  })

  test.each([
    {
      name: 'edited line',
      content: doc(
        'The ferry leaves at seven. The tide decides nothing at all this morning.',
        'People read on the crossing. A man folds his newspaper into eighths.'
      ),
    },
    {
      name: 'deleted line',
      content: doc(
        'The ferry leaves at seven.',
        'People read on the crossing. A man folds his newspaper into eighths.'
      ),
    },
    {
      name: 'near match, one word changed',
      content: doc(
        'The ferry leaves at seven. The tide decides the rest of the evening.',
        'People read on the crossing.'
      ),
    },
    {
      name: 'the line now inside a longer sentence',
      content: doc(
        'The ferry leaves at seven, and the tide decides the rest of the morning.'
      ),
    },
  ])(
    'gone ($name): null, like an unknown code, and the quote is cleared',
    async ({ content }) => {
      const { t, ids, reader } = await setup()
      const { code } = await shareTide(reader, ids.article)
      await edit(t, ids.article, content)
      const unknown = await t.mutation(api.shares.resolve, {
        code: 'zzzzzzzz',
      })
      const answer = await t.mutation(api.shares.resolve, { code })
      expect(answer).toBeNull()
      expect(answer).toEqual(unknown)
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      expect(await shareRow(t, code)).toMatchObject({
        quote: null,
        passageId: null,
        sentenceStart: null,
        sentenceEnd: null,
        clearedAt: expect.any(Number),
      })
      expect(await t.mutation(api.shares.resolve, { code })).toBeNull()
    }
  )

  test('changed: the line exists twice after an edit; no passage, quote kept', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    await edit(
      t,
      ids.article,
      doc(
        `The ferry leaves at seven. ${SHARED}`,
        `People read on the crossing. ${SHARED}`
      )
    )
    expect(await t.mutation(api.shares.resolve, { code })).toMatchObject({
      status: 'changed',
      passage: null,
    })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await shareRow(t, code))!.quote).toBe(SHARED)
  })

  test('an ambiguous line is exact at its own version', async () => {
    const twice = doc(`${SHARED} One more line.`, `${SHARED} The end.`)
    const { t, ids, reader } = await setup(twice)
    const { code } = await shareAt(reader, ids.article, 1, 2)
    expect(await t.mutation(api.shares.resolve, { code })).toMatchObject({
      status: 'exact',
      passage: { sentenceStart: 0, sentenceEnd: 0 },
    })
  })

  test('unknown, malformed, removed, unpublished and deleted all answer the same null', async () => {
    const { t, ids, reader } = await setup()
    const removed = await shareTide(reader, ids.article)
    const hidden = await shareAt(reader, ids.article, PEOPLE_START)
    await edit(
      t,
      ids.article,
      doc(
        'The ferry leaves at seven.',
        'People read on the crossing. A man folds his newspaper into eighths.'
      )
    )
    const answers = [
      await t.mutation(api.shares.resolve, { code: 'zzzzzzzz' }),
      await t.mutation(api.shares.resolve, { code: 'not a code!' }),
      await t.mutation(api.shares.resolve, { code: 'x'.repeat(10_000) }),
      await t.mutation(api.shares.resolve, { code: removed.code }),
    ]
    await t.run((ctx) => ctx.db.patch(ids.article, { published: false }))
    answers.push(await t.mutation(api.shares.resolve, { code: hidden.code }))
    await t.run((ctx) => ctx.db.delete(ids.article))
    answers.push(await t.mutation(api.shares.resolve, { code: hidden.code }))
    expect(answers).toEqual([null, null, null, null, null, null])
  })

  test('the returned text is normalized and capped', async () => {
    const spaced = `Wide${' '.repeat(5_000)}spaces here.`
    const { t, ids, reader } = await setup(doc(spaced))
    const { code } = await shareAt(reader, ids.article, 0)
    const result = await t.mutation(api.shares.resolve, { code })
    expect(result!.passage!.text).toBe('Wide spaces here.')
  })
})

describe('resolve writes nothing on the normal path', () => {
  test('exact, moved, unknown, unpublished and deleted: no write anywhere', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    let before = await snapshot(t)
    await t.mutation(api.shares.resolve, { code })
    await t.mutation(api.shares.resolve, { code: 'zzzzzzzz' })
    expect(await snapshot(t)).toEqual(before)

    await edit(
      t,
      ids.article,
      doc(
        'A new opening line.',
        ...ORIGINAL.content.map((p) => p.content[0]!.text)
      )
    )
    before = await snapshot(t)
    expect(await t.mutation(api.shares.resolve, { code })).toMatchObject({
      status: 'moved',
    })
    expect(await snapshot(t)).toEqual(before)

    await t.run((ctx) => ctx.db.patch(ids.article, { published: false }))
    before = await snapshot(t)
    expect(await t.mutation(api.shares.resolve, { code })).toBeNull()
    expect(await snapshot(t)).toEqual(before)

    await t.run((ctx) => ctx.db.delete(ids.article))
    before = await snapshot(t)
    expect(await t.mutation(api.shares.resolve, { code })).toBeNull()
    expect(await snapshot(t)).toEqual(before)
  })
})

describe('reconcileArticle and the article paths', () => {
  test('an edit clears quotes whose line is gone and keeps the rest', async () => {
    const { t, ids, reader } = await setup()
    const tide = await shareTide(reader, ids.article)
    const people = await shareAt(reader, ids.article, PEOPLE_START)
    await edit(
      t,
      ids.article,
      doc('The ferry leaves at seven.', 'People read on the crossing.')
    )
    await t.mutation(internal.shares.reconcileArticle, {
      articleId: ids.article,
    })
    expect((await shareRow(t, tide.code))!.quote).toBeNull()
    expect((await shareRow(t, people.code))!.quote).toBe(
      'People read on the crossing.'
    )
  })

  test('unpublish through the article paths clears every quote within one run', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    await t.mutation(internal.articles.setAllArticlesToDraft, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await shareRow(t, code)).toMatchObject({
      quote: null,
      passageId: null,
    })
  })

  test('hiding a reviewed article clears its quotes', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    const row = (await t.run((ctx) => ctx.db.get(ids.article)))!
    await t.mutation(internal.articles.hideReviewedArticles, {
      articles: [
        {
          id: ids.article,
          expectedTitle: row.title,
          expectedUpdatedAt: row.updatedAt,
        },
      ],
      dryRun: false,
    })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await shareRow(t, code))!.quote).toBeNull()
  })

  test('deleting an article clears the shares that point at it', async () => {
    const { t, ids, author } = await setup()
    const draft = await t.run((ctx) =>
      ctx.db.insert('articles', {
        title: 'A draft',
        slug: 'a-draft',
        content: ORIGINAL,
        authorId: ids.author,
        authorUsername: 'tomas',
        published: false,
        createdAt: 1,
        updatedAt: 1,
      })
    )
    await t.run((ctx) =>
      ctx.db.insert('shares', {
        code: 'abcdefgh',
        kind: 'canonical',
        articleId: draft,
        passageId: 'p',
        sentenceStart: 1,
        sentenceEnd: 1,
        quote: SHARED,
        contentVersion: null,
        createdAt: 1,
        checkedAt: 1,
      })
    )
    await author.mutation(api.articles.deleteArticle, { id: draft })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await shareRow(t, 'abcdefgh')).toMatchObject({
      quote: null,
      passageId: null,
    })
  })

  test('a republish with new text clears the shares whose line it lost', async () => {
    const { t, ids, author, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    await t.run((ctx) =>
      ctx.db.patch(ids.article, {
        published: false,
        content: doc('The ferry leaves at seven. The tide is gentle today.'),
      })
    )
    await author.mutation(api.articles.publishArticle, { id: ids.article })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await shareRow(t, code))!.quote).toBeNull()
  })

  test('a cleared share is not re-linked by a republish; sharing again makes a new code', async () => {
    const { t, ids, reader } = await setup()
    const old = await shareTide(reader, ids.article)
    const anon = await shareTide(t, ids.article)
    await t.mutation(internal.articles.setAllArticlesToDraft, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    await t.run((ctx) => ctx.db.patch(ids.article, { published: true }))
    for (const { code } of [old, anon])
      expect(await t.mutation(api.shares.resolve, { code })).toBeNull()
    const again = await shareTide(reader, ids.article)
    expect(again.code).not.toBe(old.code)
    const anonAgain = await shareTide(t, ids.article)
    const passageId = (await shareRow(t, anonAgain.code))!.passageId!
    expect(anonAgain.code).toBe(
      await canonicalCode(SECRET, ids.article, passageId, 1)
    )
    expect(
      await t.mutation(api.shares.resolve, { code: anonAgain.code })
    ).toMatchObject({ status: 'exact' })
  })

  test('many shares are reconciled in bounded batches', async () => {
    const { t, ids } = await setup()
    const total = RECONCILE_BATCH * 2 + 5
    await t.run(async (ctx) => {
      for (let i = 0; i < total; i++) {
        await ctx.db.insert('shares', {
          code: `c${String(i).padStart(7, '2')}`,
          kind: 'canonical',
          articleId: ids.article,
          passageId: `p${i}`,
          sentenceStart: 1,
          sentenceEnd: 1,
          quote: `A line that is not in the article, number ${i}.`,
          contentVersion: 1,
          createdAt: 1,
          checkedAt: 1,
        })
      }
    })
    expect(
      await t.mutation(internal.shares.reconcileArticle, {
        articleId: ids.article,
      })
    ).toEqual({ cleared: RECONCILE_BATCH, done: false })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const rows = await t.run((ctx) => ctx.db.query('shares').collect())
    expect(rows).toHaveLength(total)
    expect(rows.every((s) => s.quote === null)).toBe(true)
  })
})

describe('sweep', () => {
  test('is registered as a cron', () => {
    const jobs = (crons as unknown as { crons: Record<string, unknown> }).crons
    expect(Object.keys(jobs)).toContain('sweep passage share quotes')
  })

  test('with no shares it writes nothing', async () => {
    const { t } = await setup()
    expect(await t.mutation(internal.shares.sweep, {})).toEqual({
      seen: 0,
      rechecked: 0,
      cleared: 0,
      done: true,
    })
    expect(await t.run((ctx) => ctx.db.query('shareSweeps').collect())).toEqual(
      []
    )
  })

  test('an unchanged article: no share row is written', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    const before = await shareRow(t, code)
    expect(await t.mutation(internal.shares.sweep, {})).toMatchObject({
      seen: 1,
      rechecked: 0,
      cleared: 0,
    })
    expect(await shareRow(t, code)).toEqual(before)
  })

  test('catches an edit and an unpublish that skipped the reconcile call', async () => {
    const { t, ids, reader } = await setup()
    const tide = await shareTide(reader, ids.article)
    const people = await shareAt(reader, ids.article, PEOPLE_START)
    vi.advanceTimersByTime(1000)
    await edit(
      t,
      ids.article,
      doc('The ferry leaves at seven.', 'People read on the crossing.')
    )
    expect(await t.mutation(internal.shares.sweep, {})).toMatchObject({
      rechecked: 2,
      cleared: 1,
    })
    expect((await shareRow(t, tide.code))!.quote).toBeNull()
    const kept = (await shareRow(t, people.code))!
    expect(await t.mutation(internal.shares.sweep, {})).toMatchObject({
      rechecked: 0,
    })
    expect(await shareRow(t, people.code)).toEqual(kept)
    await t.run((ctx) => ctx.db.patch(ids.article, { published: false }))
    await t.mutation(internal.shares.sweep, {})
    expect((await shareRow(t, people.code))!.quote).toBeNull()
  })

  test('a saved position that is no longer a valid cursor starts the pass again', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    await t.run((ctx) =>
      ctx.db.insert('shareSweeps', {
        key: 'shares',
        cursor: 'not-a-cursor',
        lastRunAt: 1,
      })
    )
    await t.run((ctx) => ctx.db.patch(ids.article, { published: false }))
    expect(await t.mutation(internal.shares.sweep, {})).toMatchObject({
      seen: 1,
      cleared: 1,
      done: true,
    })
    expect((await shareRow(t, code))!.quote).toBeNull()
    expect(
      await t.run((ctx) => ctx.db.query('shareSweeps').unique())
    ).toMatchObject({ cursor: null })
  })

  test('walks a large table in bounded steps', async () => {
    const { t, ids } = await setup()
    const total = RECONCILE_BATCH * 2 + 5
    await t.run(async (ctx) => {
      for (let i = 0; i < total; i++) {
        await ctx.db.insert('shares', {
          code: `s${String(i).padStart(7, '2')}`,
          kind: 'canonical',
          articleId: ids.article,
          passageId: `p${i}`,
          sentenceStart: 1,
          sentenceEnd: 1,
          quote: `A line that is not in the article, number ${i}.`,
          contentVersion: 1,
          createdAt: 1,
          checkedAt: 1,
        })
      }
      await ctx.db.patch(ids.article, { updatedAt: 2 })
    })
    expect(await t.mutation(internal.shares.sweep, { steps: 1 })).toMatchObject(
      {
        seen: RECONCILE_BATCH,
        cleared: RECONCILE_BATCH,
        done: false,
      }
    )
    await t.mutation(internal.shares.sweep, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const rows = await t.run((ctx) => ctx.db.query('shares').collect())
    expect(rows.every((r) => r.quote === null)).toBe(true)
    expect(
      await t.run((ctx) => ctx.db.query('shareSweeps').unique())
    ).toMatchObject({ cursor: null, lastPassAt: expect.any(Number) })
  })
})
