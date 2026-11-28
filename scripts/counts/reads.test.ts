/// <reference types="vite/client" />
/**
 * The public line and article reads (`convex/passages.ts`, `counts.article`)
 * and the daily copy they read (`counts.startSnapshot`): figures move only
 * when the copy runs, a line shows only from two tips, nothing returned says
 * when a tip was made or who made it, a line shows only where its text is in
 * the published article now, and "readers" is offered only when every
 * counted tip there is from a known reader.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { MAX_PAID_LINES_PAGE, MIN_LINE_TIPS } from '../../convex/passages'
import {
  SENTENCES,
  addTip,
  doc,
  replay,
  setState,
  world,
  type TipSpec,
} from './fixtures'

type World = Awaited<ReturnType<typeof world>>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-28T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

let nextAt = 1
async function tipLine(
  w: World,
  tipper: Id<'users'>,
  sentence: number | null,
  articleId = w.articles[0]!,
  cents = 50
): Promise<TipSpec> {
  const tip = await addTip(w, {
    kind: 'tab',
    tipper,
    articleId,
    sentence,
    cents,
    at: nextAt++,
  })
  await replay(w, tip)
  return tip
}

/** Runs today's daily copy to the end, as the cron does. */
async function publish(w: World) {
  const started = await w.t.mutation(internal.counts.startSnapshot, {})
  await w.t.finishAllScheduledFunctions(vi.runAllTimers)
  return started
}

/** The next day, so the cron starts a new copy. */
function nextDay() {
  vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)
}

const lines = (w: World, articleId: Id<'articles'> = w.articles[0]!) =>
  w.t.query(api.passages.forArticle, { articleId })
const articleFigures = (w: World, articleId = w.articles[0]!) =>
  w.t.query(api.counts.article, { articleId })

describe('the daily copy', () => {
  test('nothing public moves at the moment of a tip, only when the copy runs', async () => {
    const w = await world()
    await tipLine(w, w.readers[0]!, 1)
    await tipLine(w, w.readers[1]!, 1)
    expect(await lines(w)).toEqual({ lines: [] })
    expect(await articleFigures(w)).toMatchObject({ tipCount: 0 })
    expect(await publish(w)).toBe('started')
    expect((await lines(w)).lines).toEqual([
      expect.objectContaining({ tipCount: 2 }),
    ])
    expect(await articleFigures(w)).toMatchObject({ tipCount: 2 })

    // A third tip today: the public figures stay as copied.
    await tipLine(w, w.readers[2]!, 1)
    expect((await lines(w)).lines).toEqual([
      expect.objectContaining({ tipCount: 2 }),
    ])
    // The copy runs once a day: a second start today does nothing.
    expect(await publish(w)).toBe('done')
    expect(await articleFigures(w)).toMatchObject({ tipCount: 2 })
    nextDay()
    expect(await publish(w)).toBe('started')
    expect((await lines(w)).lines).toEqual([
      expect.objectContaining({ tipCount: 3 }),
    ])
    expect(await articleFigures(w)).toMatchObject({ tipCount: 3 })
  })

  test('a run writes only figures that changed, and carries only its day', async () => {
    const w = await world()
    await tipLine(w, w.readers[0]!, 2)
    await tipLine(w, w.readers[1]!, 2)
    await publish(w)
    const first = await w.t.run((ctx) =>
      ctx.db.query('countsSnapshotRuns').unique()
    )
    expect(first).toMatchObject({ day: '2026-11-28', rows: 2, changed: 2 })
    const copies = await w.t.run(async (ctx) => ({
      articles: await ctx.db.query('articleTipSnapshots').collect(),
      passages: await ctx.db.query('passageTipSnapshots').collect(),
    }))
    // Day granularity only: no copy keeps a time.
    for (const copy of [...copies.articles, ...copies.passages])
      expect(copy.day).toBe('2026-11-28')
    nextDay()
    await publish(w)
    expect(
      await w.t.run((ctx) => ctx.db.query('countsSnapshotRuns').unique())
    ).toMatchObject({ day: '2026-11-29', rows: 2, changed: 0 })
  })

  test('no public read returns a time or names a tipper', async () => {
    const w = await world()
    for (const reader of w.readers) await tipLine(w, reader, 0)
    await tipLine(w, w.readers[0]!, null)
    await publish(w)
    const answers = JSON.stringify([
      await lines(w),
      await articleFigures(w),
      await w.t.query(api.passages.paidLines, {
        paginationOpts: { numItems: 5, cursor: null },
      }),
      await w.t.query(api.passages.byWriter, { userId: w.writer }),
    ])
    expect(answers).not.toMatch(/At"|"day"|_creationTime/)
    for (const reader of w.readers) expect(answers).not.toContain(reader)
  })
})

describe('passages.forArticle', () => {
  test('tipped lines in reading order, with the copy label', async () => {
    const w = await world()
    await tipLine(w, w.readers[0]!, 3)
    await tipLine(w, w.readers[0]!, 1)
    await tipLine(w, w.readers[1]!, 1)
    await tipLine(w, w.gone, 3)
    await publish(w)
    const { lines: got } = await lines(w)
    expect(got).toEqual([
      {
        passageId: expect.any(String),
        startOffset: SENTENCES[1]!.start,
        endOffset: SENTENCES[1]!.end,
        tipCount: 2,
        tipCents: 100,
        readerCount: 2,
        unidentifiedTipCount: 0,
        label: 'readers',
      },
      {
        passageId: expect.any(String),
        startOffset: SENTENCES[3]!.start,
        endOffset: SENTENCES[3]!.end,
        tipCount: 2,
        tipCents: 100,
        readerCount: 1,
        unidentifiedTipCount: 1,
        label: 'tips',
      },
    ])
    // The text kept to find the line is never part of the answer.
    expect(JSON.stringify(got)).not.toContain('The tide')
  })

  test(`a line shows only from ${MIN_LINE_TIPS} tips`, async () => {
    const w = await world()
    await tipLine(w, w.readers[0]!, 0)
    await tipLine(w, w.readers[1]!, 2)
    await tipLine(w, w.readers[1]!, 2)
    await publish(w)
    expect((await lines(w)).lines).toEqual([
      expect.objectContaining({
        startOffset: SENTENCES[2]!.start,
        tipCount: 2,
        readerCount: 1,
      }),
    ])
    // The article's own figure counts every tip.
    expect(await articleFigures(w)).toMatchObject({ tipCount: 3 })
  })

  test('current text only: a moved line follows, a gone or repeated line is left out', async () => {
    const w = await world()
    for (const [sentence, a, b] of [
      [1, 0, 1],
      [2, 1, 2],
      [3, 2, 0],
    ] as const) {
      await tipLine(w, w.readers[a]!, sentence)
      await tipLine(w, w.readers[b]!, sentence)
    }
    await publish(w)
    const moved = doc(
      'A new opening paragraph.',
      'The ferry leaves at seven. The tide decides the rest.',
      'People read on the crossing. People read on the crossing.'
    )
    await w.t.run((ctx) => ctx.db.patch(w.articles[0]!, { content: moved }))
    const { lines: got } = await lines(w)
    const text = 'A new opening paragraph.The ferry leaves at seven. '
    expect(got).toEqual([
      expect.objectContaining({
        startOffset: text.length,
        endOffset: text.length + 'The tide decides the rest.'.length,
        tipCount: 2,
      }),
    ])
  })

  test('a line whose tips all left the counts is not shown after the next copy', async () => {
    const w = await world()
    const a = await tipLine(w, w.readers[0]!, 0)
    const b = await tipLine(w, w.readers[1]!, 0)
    await publish(w)
    expect((await lines(w)).lines).toHaveLength(1)
    await setState(w, a, 'UNPAID')
    await setState(w, b, 'UNPAID')
    nextDay()
    await publish(w)
    expect(await lines(w)).toEqual({ lines: [] })
    expect(await articleFigures(w)).toMatchObject({ tipCount: 0 })
  })

  test('an unpublished or deleted article has no lines and no figures', async () => {
    const w = await world()
    await tipLine(w, w.readers[0]!, 0)
    await tipLine(w, w.readers[1]!, 0)
    await publish(w)
    await w.t.run((ctx) => ctx.db.patch(w.articles[0]!, { published: false }))
    expect(await lines(w)).toEqual({ lines: [] })
    expect(await articleFigures(w)).toBeNull()
    await w.t.run((ctx) => ctx.db.delete(w.articles[0]!))
    expect(await lines(w)).toEqual({ lines: [] })
  })
})

describe('counts.article', () => {
  test('figures with the copy label, zeros before the first copy', async () => {
    const w = await world()
    expect(await articleFigures(w, w.articles[1]!)).toEqual({
      tipCount: 0,
      tipCents: 0,
      readerCount: 0,
      unidentifiedTipCount: 0,
      label: 'tips',
    })
    await tipLine(w, w.readers[0]!, null, w.articles[1]!, 30)
    await tipLine(w, w.readers[0]!, 2, w.articles[1]!, 20)
    await publish(w)
    expect(await articleFigures(w, w.articles[1]!)).toEqual({
      tipCount: 2,
      tipCents: 50,
      readerCount: 1,
      unidentifiedTipCount: 0,
      label: 'readers',
    })
    await tipLine(w, w.gone, null, w.articles[1]!, 10)
    nextDay()
    await publish(w)
    expect(await articleFigures(w, w.articles[1]!)).toMatchObject({
      tipCount: 3,
      unidentifiedTipCount: 1,
      label: 'tips',
    })
  })
})

describe('passages.paidLines', () => {
  test('most tipped first, with the current text, writer and link', async () => {
    const w = await world()
    for (const reader of w.readers) await tipLine(w, reader, 2)
    await tipLine(w, w.readers[0]!, 3)
    await tipLine(w, w.readers[1]!, 3)
    await tipLine(w, w.readers[2]!, 0, w.articles[1]!)
    await publish(w)
    const page = await w.t.query(api.passages.paidLines, {
      paginationOpts: { numItems: 5, cursor: null },
    })
    expect(page.page.map((l) => [l.text, l.tipCount])).toEqual([
      ['People read on the crossing.', 3],
      ['A man folds his paper.', 2],
    ])
    expect(page.page[0]).toEqual({
      passageId: expect.any(String),
      articleId: w.articles[0],
      text: 'People read on the crossing.',
      startOffset: SENTENCES[2]!.start,
      endOffset: SENTENCES[2]!.end,
      article: { title: 'first', slug: 'first', href: '/writer/first' },
      writer: { name: 'writer', username: 'writer' },
      tipCount: 3,
      tipCents: 150,
      readerCount: 3,
      unidentifiedTipCount: 0,
      label: 'readers',
    })
  })

  test('unpublished articles and changed lines are left out', async () => {
    const w = await world()
    await tipLine(w, w.readers[0]!, 0)
    await tipLine(w, w.readers[1]!, 0)
    await tipLine(w, w.readers[0]!, 1, w.articles[1]!)
    await tipLine(w, w.readers[1]!, 1, w.articles[1]!)
    await publish(w)
    await w.t.run(async (ctx) => {
      await ctx.db.patch(w.articles[1]!, { published: false })
      await ctx.db.patch(w.articles[0]!, {
        content: doc('The ferry leaves at eight.'),
      })
    })
    const page = await w.t.query(api.passages.paidLines, {
      paginationOpts: { numItems: 5, cursor: null },
    })
    expect(page.page).toEqual([])
  })

  test('a page reads at most a fixed number of rows', async () => {
    const w = await world()
    let count = 0
    for (const articleId of w.articles)
      for (let s = 0; s < SENTENCES.length; s++) {
        await tipLine(w, w.readers[0]!, s, articleId)
        await tipLine(w, w.readers[1]!, s, articleId)
        count++
      }
    await publish(w)
    const first = await w.t.query(api.passages.paidLines, {
      paginationOpts: { numItems: 100, cursor: null },
    })
    expect(first.page.length).toBe(Math.min(MAX_PAID_LINES_PAGE, count))
    const all = [...first.page]
    let cursor = first.continueCursor
    let done = first.isDone
    while (!done) {
      const next = await w.t.query(api.passages.paidLines, {
        paginationOpts: { numItems: 100, cursor },
      })
      expect(next.page.length).toBeLessThanOrEqual(MAX_PAID_LINES_PAGE)
      all.push(...next.page)
      cursor = next.continueCursor
      done = next.isDone
    }
    expect(all).toHaveLength(count)
    expect(new Set(all.map((l) => l.passageId)).size).toBe(count)
  })
})

describe('passages.byWriter', () => {
  test("a writer's most tipped lines, only that writer's, at most the limit", async () => {
    const w = await world()
    for (const reader of w.readers) await tipLine(w, reader, 1)
    await tipLine(w, w.readers[0]!, 0, w.articles[1]!)
    await tipLine(w, w.readers[1]!, 0, w.articles[1]!)
    // One tip: not shown.
    await tipLine(w, w.readers[2]!, 3)
    await publish(w)
    const got = await w.t.query(api.passages.byWriter, {
      userId: w.writer,
      limit: 1,
    })
    expect(got).toEqual([
      expect.objectContaining({
        text: 'The tide decides the rest.',
        tipCount: 3,
        article: expect.objectContaining({ href: '/writer/first' }),
      }),
    ])
    expect(
      await w.t.query(api.passages.byWriter, { userId: w.writer })
    ).toHaveLength(2)
    expect(
      await w.t.query(api.passages.byWriter, { userId: w.readers[0]! })
    ).toEqual([])
  })
})
