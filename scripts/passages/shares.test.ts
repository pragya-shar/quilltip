/// <reference types="vite/client" />
/**
 * Passage share links (`convex/shares.ts`): the backend cases of architecture
 * slice-2.md section 3 and package S2-A (D17).
 */
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  RECONCILE_BATCH,
  SHARES_PER_ARTICLE_PER_HOUR,
  SHARES_PER_USER_PER_HOUR,
  SHARE_CODE_ALPHABET,
  SHARE_CODE_LENGTH,
  canonicalCode,
} from '../../convex/shares'
import crons from '../../convex/crons'
import {
  canonicalText,
  identifyPassage,
  sentencesOf,
} from '../../lib/passages/sentences'

const modules = import.meta.glob('../../convex/**/*.ts')

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
const TIDE_START = ORIGINAL.content[0]!.content[0]!.text.indexOf(SHARED)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
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
    })
  })
}

async function errorCode(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  return (error as ConvexError<{ code: string }>).data.code
}

/** Every run of four or more consecutive words of `quote`. */
function fourWordRuns(quote: string): string[] {
  const words = quote.split(/\s+/).filter(Boolean)
  const runs: string[] = []
  for (let n = 4; n <= words.length; n++)
    for (let i = 0; i + n <= words.length; i++)
      runs.push(words.slice(i, i + n).join(' '))
  return runs
}

function expectNoQuote(payload: unknown, quote: string) {
  const json = JSON.stringify(payload) ?? 'null'
  for (const run of fourWordRuns(quote)) expect(json).not.toContain(run)
}

async function shareTide(
  client: { mutation: Test['mutation'] },
  article: Id<'articles'>
) {
  return client.mutation(api.shares.create, {
    articleId: article,
    passage: { startOffset: TIDE_START + 4, endOffset: TIDE_START + 10 },
  })
}

describe('create', () => {
  test('snaps to the sentence and stores the quote and range', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    expect(code).toHaveLength(SHARE_CODE_LENGTH)
    expect([...code].every((ch) => SHARE_CODE_ALPHABET.includes(ch))).toBe(true)
    const row = await shareRow(t, code)
    const canonical = canonicalText(ORIGINAL)
    const expected = await identifyPassage(
      ids.article,
      canonical,
      sentencesOf(canonical),
      TIDE_START,
      TIDE_START + 1
    )
    expect(row).toMatchObject({
      articleId: ids.article,
      passageId: expected!.passageId,
      sentenceStart: 1,
      sentenceEnd: 1,
      quote: SHARED,
      contentVersion: 1,
      createdBy: ids.reader,
    })
  })

  test('one person sharing a line twice, by any selection, gets one personal code', async () => {
    const { t, ids, reader } = await setup()
    const a = await shareTide(reader, ids.article)
    const b = await reader.mutation(api.shares.create, {
      articleId: ids.article,
      passage: { startOffset: TIDE_START + 20, endOffset: TIDE_START + 21 },
    })
    expect(b.code).toBe(a.code)
    expect((await shareRow(t, a.code))!).toMatchObject({
      kind: 'personal',
      createdBy: ids.reader,
    })
  })

  test('signed-out shares of a line are one canonical row, derived from the article and passage', async () => {
    const { t, ids } = await setup()
    const a = await shareTide(t, ids.article)
    const b = await t.mutation(api.shares.create, {
      articleId: ids.article,
      passage: { startOffset: TIDE_START, endOffset: TIDE_START },
    })
    expect(b.code).toBe(a.code)
    const row = (await shareRow(t, a.code))!
    expect(row.kind).toBe('canonical')
    expect(row.createdBy).toBeUndefined()
    expect(a.code).toBe(await canonicalCode(ids.article, row.passageId!, 0))
    expect(await t.run((ctx) => ctx.db.query('shares').collect())).toHaveLength(
      1
    )
  })

  test('canonical and personal codes for one line coexist, resolve alike and name no one', async () => {
    const { t, ids, reader, author } = await setup()
    const canonical = await shareTide(t, ids.article)
    const june = await shareTide(reader, ids.article)
    const tomas = await shareTide(author, ids.article)
    expect(new Set([canonical.code, june.code, tomas.code]).size).toBe(3)
    const answers = await Promise.all(
      [canonical, june, tomas].map(({ code }) =>
        t.mutation(api.shares.resolve, { code })
      )
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

  test('a selection of whitespace or outside the text is INVALID_PASSAGE', async () => {
    const { ids, reader } = await setup()
    for (const passage of [
      { startOffset: TIDE_START - 1, endOffset: TIDE_START },
      { startOffset: 10_000, endOffset: 10_010 },
      { startOffset: 5, endOffset: 1 },
    ]) {
      expect(
        await errorCode(
          reader.mutation(api.shares.create, {
            articleId: ids.article,
            passage,
          })
        )
      ).toBe('INVALID_PASSAGE')
    }
  })

  test('a passage longer than 500 characters is PASSAGE_TOO_LONG', async () => {
    const long = `${'word '.repeat(120).trim()}.`
    const { ids, reader } = await setup(doc(long))
    expect(
      await errorCode(
        reader.mutation(api.shares.create, {
          articleId: ids.article,
          passage: { startOffset: 0, endOffset: 3 },
        })
      )
    ).toBe('PASSAGE_TOO_LONG')
  })

  test('new codes are rate limited per signed-in person; returning a code is not counted', async () => {
    const sentences = Array.from(
      { length: SHARES_PER_USER_PER_HOUR + 1 },
      (_, i) => `Line number ${i} is here.`
    )
    const { ids, reader } = await setup(doc(sentences.join(' ')))
    const offsets = sentencesOf(canonicalText(doc(sentences.join(' '))))
    for (let i = 0; i < SHARES_PER_USER_PER_HOUR; i++) {
      await reader.mutation(api.shares.create, {
        articleId: ids.article,
        passage: {
          startOffset: offsets[i]!.start,
          endOffset: offsets[i]!.start,
        },
      })
    }
    // An existing passage still answers.
    await reader.mutation(api.shares.create, {
      articleId: ids.article,
      passage: { startOffset: offsets[0]!.start, endOffset: offsets[0]!.start },
    })
    const last = offsets[SHARES_PER_USER_PER_HOUR]!
    expect(
      await errorCode(
        reader.mutation(api.shares.create, {
          articleId: ids.article,
          passage: { startOffset: last.start, endOffset: last.start },
        })
      )
    ).toBe('RATE_LIMITED')
  })

  test('signed-out sharing has no signed-out bucket: only the article and table limits apply', async () => {
    const sentences = Array.from({ length: 3 }, (_, i) => `Line ${i} is here.`)
    const content = doc(sentences.join(' '))
    const { t, ids } = await setup(content)
    const offsets = sentencesOf(canonicalText(content))
    const first = await t.mutation(api.shares.create, {
      articleId: ids.article,
      passage: { startOffset: offsets[0]!.start, endOffset: offsets[0]!.start },
    })
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('rateLimits')
        .withIndex('by_key', (q) =>
          q.eq('key', `shares:article:${ids.article}`)
        )
        .unique()
      await ctx.db.patch(row!._id, { count: SHARES_PER_ARTICLE_PER_HOUR })
    })
    // A line already shared still answers with its code.
    expect(
      await t.mutation(api.shares.create, {
        articleId: ids.article,
        passage: {
          startOffset: offsets[0]!.start,
          endOffset: offsets[0]!.start,
        },
      })
    ).toEqual(first)
    // A new line waits for the article's window.
    expect(
      await errorCode(
        t.mutation(api.shares.create, {
          articleId: ids.article,
          passage: {
            startOffset: offsets[1]!.start,
            endOffset: offsets[1]!.start,
          },
        })
      )
    ).toBe('RATE_LIMITED')
  })
})

describe('resolve', () => {
  test('exact: the stored range, the current text, no quote field', async () => {
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

  test('the article link uses the writer’s current handle', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    await t.run((ctx) => ctx.db.patch(ids.author, { username: 'tomas-r' }))
    const result = await t.mutation(api.shares.resolve, { code })
    expect(result!.article.href).toBe('/tomas-r/the-ferry-timetable')
  })

  test('moved: an unchanged sentence in an edited article is found again, same passage id', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    const passageId = (await shareRow(t, code))!.passageId
    const after = doc(
      'A new opening line. The ferry leaves at seven.',
      'People read on the crossing.',
      `${SHARED} A man folds his newspaper into eighths.`
    )
    await edit(t, ids.article, after)
    const result = await t.mutation(api.shares.resolve, { code })
    const canonical = canonicalText(after)
    const start = canonical.text.indexOf(SHARED)
    expect(result).toMatchObject({
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
    // The quote still matches, so it is kept.
    expect((await shareRow(t, code))!.quote).toBe(SHARED)
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
    {
      name: 'the same sentence twice in the new text',
      content: doc(
        `The ferry leaves at seven. ${SHARED}`,
        `People read on the crossing. ${SHARED}`
      ),
    },
  ])(
    'changed ($name): no passage, no old words, the quote cleared',
    async ({ content }) => {
      const { t, ids, reader } = await setup()
      const { code } = await shareTide(reader, ids.article)
      await edit(t, ids.article, content)
      const result = await t.mutation(api.shares.resolve, { code })
      expect(result).toMatchObject({ status: 'changed', passage: null })
      expect(result!.article.href).toBe('/tomas/the-ferry-timetable')
      expectNoQuote(result, SHARED)
      const row = (await shareRow(t, code))!
      expect(row).toMatchObject({
        quote: null,
        passageId: null,
        sentenceStart: null,
        sentenceEnd: null,
      })
      expect(row.clearedAt).toEqual(expect.any(Number))
      // Still changed on the next visit, from the cleared row.
      expect(await t.mutation(api.shares.resolve, { code })).toMatchObject({
        status: 'changed',
        passage: null,
      })
    }
  )

  test('an ambiguous line resolves exact at its version and changed after an edit', async () => {
    const twice = doc(`${SHARED} One more line.`, `${SHARED} The end.`)
    const { t, ids, reader } = await setup(twice)
    const { code } = await reader.mutation(api.shares.create, {
      articleId: ids.article,
      passage: { startOffset: 1, endOffset: 2 },
    })
    expect(await t.mutation(api.shares.resolve, { code })).toMatchObject({
      status: 'exact',
      passage: { sentenceStart: 0, sentenceEnd: 0 },
    })
    await edit(
      t,
      ids.article,
      doc('A new opening.', `${SHARED} One more line.`, `${SHARED} The end.`)
    )
    expect(await t.mutation(api.shares.resolve, { code })).toMatchObject({
      status: 'changed',
      passage: null,
    })
  })

  test('unknown, malformed, unpublished and deleted all answer the same null', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    const unknown = await t.mutation(api.shares.resolve, { code: 'zzzzzzzz' })
    const malformed = await t.mutation(api.shares.resolve, {
      code: 'not a code!',
    })
    await t.run((ctx) => ctx.db.patch(ids.article, { published: false }))
    const unpublished = await t.mutation(api.shares.resolve, { code })
    expect((await shareRow(t, code))!.quote).toBeNull()
    await t.run((ctx) => ctx.db.delete(ids.article))
    const deleted = await t.mutation(api.shares.resolve, { code })
    for (const answer of [unknown, malformed, unpublished, deleted]) {
      expect(answer).toBeNull()
    }
  })

  test('a republish of the old text does not re-link a cleared share', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    await t.run((ctx) => ctx.db.patch(ids.article, { published: false }))
    expect(await t.mutation(api.shares.resolve, { code })).toBeNull()
    await t.run((ctx) => ctx.db.patch(ids.article, { published: true }))
    expect(await t.mutation(api.shares.resolve, { code })).toMatchObject({
      status: 'changed',
      passage: null,
    })
    // Sharing the line again makes a new code; the old one stays changed.
    const again = await shareTide(reader, ids.article)
    expect(again.code).not.toBe(code)
    expect(
      await t.mutation(api.shares.resolve, { code: again.code })
    ).toMatchObject({
      status: 'exact',
    })
  })
})

describe('resolve writes nothing on the normal path', () => {
  async function snapshot(t: Test) {
    return t.run(async (ctx) => ({
      shares: await ctx.db.query('shares').collect(),
      rateLimits: await ctx.db.query('rateLimits').collect(),
      sweeps: await ctx.db.query('shareSweeps').collect(),
      articles: await ctx.db.query('articles').collect(),
      scheduled: await ctx.db.system.query('_scheduled_functions').collect(),
    }))
  }

  test('a fresh share resolves exact with no write anywhere', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    const before = await snapshot(t)
    expect(await t.mutation(api.shares.resolve, { code })).toMatchObject({
      status: 'exact',
    })
    expect(await snapshot(t)).toEqual(before)
  })

  test('a moved share and an unknown code also write nothing', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    await edit(
      t,
      ids.article,
      doc(
        'A new opening line.',
        ...ORIGINAL.content.map((p) => p.content[0]!.text)
      )
    )
    const before = await snapshot(t)
    expect(await t.mutation(api.shares.resolve, { code })).toMatchObject({
      status: 'moved',
    })
    expect(
      await t.mutation(api.shares.resolve, { code: 'zzzzzzzz' })
    ).toBeNull()
    expect(await snapshot(t)).toEqual(before)
  })

  test('a signed-out share after a clear gets the next canonical code, not the old one', async () => {
    const { t, ids } = await setup()
    const old = await shareTide(t, ids.article)
    await t.run((ctx) => ctx.db.patch(ids.article, { published: false }))
    expect(await t.mutation(api.shares.resolve, { code: old.code })).toBeNull()
    await t.run((ctx) => ctx.db.patch(ids.article, { published: true }))
    const again = await shareTide(t, ids.article)
    const passageId = (await shareRow(t, again.code))!.passageId!
    expect(again.code).toBe(await canonicalCode(ids.article, passageId, 1))
    expect(again.code).not.toBe(old.code)
    expect(
      await t.mutation(api.shares.resolve, { code: old.code })
    ).toMatchObject({
      status: 'changed',
      passage: null,
    })
  })
})

describe('reconcileArticle and the article paths', () => {
  test('an edit clears quotes that no longer match and keeps the rest', async () => {
    const { t, ids, reader } = await setup()
    const tide = await shareTide(reader, ids.article)
    const people = await reader.mutation(api.shares.create, {
      articleId: ids.article,
      passage: {
        startOffset: canonicalText(ORIGINAL).text.indexOf('People'),
        endOffset: canonicalText(ORIGINAL).text.indexOf('People') + 3,
      },
    })
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
    expect((await shareRow(t, code))!).toMatchObject({
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
    const code = 'abcdefgh'
    await t.run((ctx) =>
      ctx.db.insert('shares', {
        code,
        articleId: draft,
        passageId: 'p',
        sentenceStart: 1,
        sentenceEnd: 1,
        quote: SHARED,
        contentVersion: null,
        kind: 'canonical',
        createdAt: 1,
        checkedAt: 1,
      })
    )
    await author.mutation(api.articles.deleteArticle, { id: draft })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await shareRow(t, code))!).toMatchObject({
      quote: null,
      passageId: null,
    })
  })

  test('a republish with new text clears the shares it no longer contains', async () => {
    const { t, ids, author, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    // Simulate a writer change that reaches the publish path: the article is
    // a draft again with the line rewritten, then published.
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

  test('many shares are reconciled in bounded batches', async () => {
    const { t, ids } = await setup()
    const total = RECONCILE_BATCH * 2 + 5
    await t.run(async (ctx) => {
      for (let i = 0; i < total; i++) {
        await ctx.db.insert('shares', {
          code: `c${String(i).padStart(7, '2')}`,
          articleId: ids.article,
          passageId: `p${i}`,
          sentenceStart: 1,
          sentenceEnd: 1,
          quote: `A line that is not in the article, number ${i}.`,
          contentVersion: 1,
          kind: 'canonical',
          createdAt: 1,
          checkedAt: 1,
        })
      }
    })
    const first = await t.mutation(internal.shares.reconcileArticle, {
      articleId: ids.article,
    })
    expect(first).toEqual({ cleared: RECONCILE_BATCH, done: false })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const left = await t.run((ctx) =>
      ctx.db
        .query('shares')
        .withIndex('by_article_passage', (q) => q.eq('articleId', ids.article))
        .collect()
    )
    expect(left).toHaveLength(total)
    expect(left.every((s) => s.quote === null)).toBe(true)
  })
})

describe('sweep', () => {
  test('is registered as a cron', () => {
    const jobs = (crons as unknown as { crons: Record<string, unknown> }).crons
    expect(Object.keys(jobs)).toContain('sweep passage share quotes')
  })

  test('with no shares it reads one page and writes nothing', async () => {
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

  test('catches an edit that skipped the reconcile call', async () => {
    const { t, ids, reader } = await setup()
    const tide = await shareTide(reader, ids.article)
    const people = await reader.mutation(api.shares.create, {
      articleId: ids.article,
      passage: {
        startOffset: canonicalText(ORIGINAL).text.indexOf('People'),
        endOffset: canonicalText(ORIGINAL).text.indexOf('People') + 2,
      },
    })
    // A content change with a later updatedAt and no hook.
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.article, {
        content: doc(
          'The ferry leaves at seven.',
          'People read on the crossing.'
        ),
        contentVersion: 2,
        updatedAt: Date.now() + 1000,
      })
    })
    vi.advanceTimersByTime(2000)
    expect(await t.mutation(internal.shares.sweep, {})).toMatchObject({
      rechecked: 2,
      cleared: 1,
    })
    expect((await shareRow(t, tide.code))!.quote).toBeNull()
    const kept = (await shareRow(t, people.code))!
    expect(kept.quote).toBe('People read on the crossing.')
    // Re-checked once: the next run leaves it alone.
    expect(await t.mutation(internal.shares.sweep, {})).toMatchObject({
      rechecked: 0,
    })
    expect(await shareRow(t, people.code)).toEqual(kept)
  })

  test('catches an unpublish that skipped the reconcile call', async () => {
    const { t, ids, reader } = await setup()
    const { code } = await shareTide(reader, ids.article)
    await t.run((ctx) => ctx.db.patch(ids.article, { published: false }))
    await t.mutation(internal.shares.sweep, {})
    expect((await shareRow(t, code))!.quote).toBeNull()
  })

  test('walks a large table in bounded steps and starts again after a pass', async () => {
    const { t, ids } = await setup()
    const total = RECONCILE_BATCH * 2 + 5
    await t.run(async (ctx) => {
      for (let i = 0; i < total; i++) {
        await ctx.db.insert('shares', {
          code: `s${String(i).padStart(7, '2')}`,
          articleId: ids.article,
          passageId: `p${i}`,
          sentenceStart: 1,
          sentenceEnd: 1,
          quote: `A line that is not in the article, number ${i}.`,
          contentVersion: 1,
          kind: 'canonical',
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
    const state = await t.run((ctx) => ctx.db.query('shareSweeps').unique())
    expect(state).toMatchObject({
      cursor: null,
      lastPassAt: expect.any(Number),
    })
  })
})
