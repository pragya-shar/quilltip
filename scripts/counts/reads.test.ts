/// <reference types="vite/client" />
/**
 * The line and article reads (`convex/passages.ts`, `counts.article`): a
 * line shows only where its text is in the published article now, a gone,
 * changed or repeated line is left out, and "readers" is offered only when
 * every counted tip there is from a known reader.
 */
import { describe, expect, test } from 'vitest'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { MAX_PAID_LINES_PAGE } from '../../convex/passages'
import {
  CONTENT,
  SENTENCES,
  addTip,
  doc,
  replay,
  setState,
  world,
  type TipSpec,
} from './fixtures'

type World = Awaited<ReturnType<typeof world>>

async function tipLine(
  w: World,
  tipper: Id<'users'>,
  sentence: number | null,
  at: number,
  articleId = w.articles[0]!,
  cents = 50
): Promise<TipSpec> {
  const tip = await addTip(w, {
    kind: 'tab',
    tipper,
    articleId,
    sentence,
    cents,
    at,
  })
  await replay(w, tip)
  return tip
}

const lines = (w: World, articleId: Id<'articles'> = w.articles[0]!) =>
  w.t.query(api.passages.forArticle, { articleId })

describe('passages.forArticle', () => {
  test('tipped lines in reading order, with the copy label', async () => {
    const w = await world()
    await tipLine(w, w.readers[0]!, 3, 1)
    await tipLine(w, w.readers[0]!, 1, 2)
    await tipLine(w, w.readers[1]!, 1, 3)
    await tipLine(w, w.gone, 3, 4)
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

  test('current text only: a moved line follows, a gone or repeated line is left out', async () => {
    const w = await world()
    await tipLine(w, w.readers[0]!, 1, 1)
    await tipLine(w, w.readers[1]!, 2, 2)
    await tipLine(w, w.readers[2]!, 3, 3)
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
        tipCount: 1,
      }),
    ])
  })

  test('a line whose tips all left the counts is not shown', async () => {
    const w = await world()
    const tip = await tipLine(w, w.readers[0]!, 0, 1)
    await setState(w, tip, 'UNPAID')
    expect(await lines(w)).toEqual({ lines: [] })
  })

  test('an unpublished or deleted article has no lines and no figures', async () => {
    const w = await world()
    await tipLine(w, w.readers[0]!, 0, 1)
    await w.t.run((ctx) => ctx.db.patch(w.articles[0]!, { published: false }))
    expect(await lines(w)).toEqual({ lines: [] })
    expect(
      await w.t.query(api.counts.article, { articleId: w.articles[0]! })
    ).toBeNull()
    await w.t.run((ctx) => ctx.db.delete(w.articles[0]!))
    expect(await lines(w)).toEqual({ lines: [] })
  })
})

describe('counts.article', () => {
  test('figures with the copy label, zeros before the first tip', async () => {
    const w = await world()
    expect(
      await w.t.query(api.counts.article, { articleId: w.articles[1]! })
    ).toEqual({
      tipCount: 0,
      tipCents: 0,
      readerCount: 0,
      unidentifiedTipCount: 0,
      label: 'tips',
    })
    await tipLine(w, w.readers[0]!, null, 1, w.articles[1]!, 30)
    await tipLine(w, w.readers[0]!, 2, 2, w.articles[1]!, 20)
    expect(
      await w.t.query(api.counts.article, { articleId: w.articles[1]! })
    ).toEqual({
      tipCount: 2,
      tipCents: 50,
      readerCount: 1,
      unidentifiedTipCount: 0,
      label: 'readers',
    })
    await tipLine(w, w.gone, null, 3, w.articles[1]!, 10)
    expect(
      await w.t.query(api.counts.article, { articleId: w.articles[1]! })
    ).toMatchObject({ tipCount: 3, unidentifiedTipCount: 1, label: 'tips' })
  })
})

describe('passages.paidLines', () => {
  test('most tipped first, with the current text, writer and link', async () => {
    const w = await world()
    await tipLine(w, w.readers[0]!, 2, 1)
    await tipLine(w, w.readers[1]!, 2, 2)
    await tipLine(w, w.readers[2]!, 0, 3, w.articles[1]!)
    await tipLine(w, w.readers[0]!, 3, 4)
    const page = await w.t.query(api.passages.paidLines, {
      paginationOpts: { numItems: 5, cursor: null },
    })
    expect(page.page.map((l) => [l.text, l.tipCount])).toEqual([
      ['People read on the crossing.', 2],
      ['A man folds his paper.', 1],
      ['The ferry leaves at seven.', 1],
    ])
    expect(page.page[0]).toMatchObject({
      articleId: w.articles[0],
      startOffset: SENTENCES[2]!.start,
      endOffset: SENTENCES[2]!.end,
      article: { slug: 'first', href: '/writer/first' },
      writer: { username: 'writer' },
      readerCount: 2,
      label: 'readers',
      lastTipAt: 2,
    })
    const recent = await w.t.query(api.passages.paidLines, {
      paginationOpts: { numItems: 5, cursor: null },
      order: 'recent',
    })
    expect(recent.page.map((l) => l.lastTipAt)).toEqual([4, 3, 2])
  })

  test('unpublished articles and changed lines are left out', async () => {
    const w = await world()
    await tipLine(w, w.readers[0]!, 0, 1)
    await tipLine(w, w.readers[0]!, 1, 2, w.articles[1]!)
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
    let at = 1
    for (const articleId of w.articles)
      for (let s = 0; s < SENTENCES.length; s++)
        await tipLine(w, w.readers[0]!, s, at++, articleId)
    const first = await w.t.query(api.passages.paidLines, {
      paginationOpts: { numItems: 100, cursor: null },
    })
    expect(first.page.length).toBeLessThanOrEqual(MAX_PAID_LINES_PAGE)
    expect(first.page.length).toBe(Math.min(MAX_PAID_LINES_PAGE, at - 1))
    const all = [...first.page]
    let cursor = first.continueCursor
    let done = first.isDone
    while (!done) {
      const next = await w.t.query(api.passages.paidLines, {
        paginationOpts: { numItems: 100, cursor },
      })
      all.push(...next.page)
      cursor = next.continueCursor
      done = next.isDone
    }
    expect(all).toHaveLength(at - 1)
    expect(new Set(all.map((l) => l.passageId)).size).toBe(at - 1)
  })
})

describe('passages.byWriter', () => {
  test("a writer's most tipped lines, only that writer's, at most the limit", async () => {
    const w = await world()
    await tipLine(w, w.readers[0]!, 1, 1)
    await tipLine(w, w.readers[1]!, 1, 2)
    await tipLine(w, w.readers[0]!, 0, 3, w.articles[1]!)
    const got = await w.t.query(api.passages.byWriter, {
      userId: w.writer,
      limit: 1,
    })
    expect(got).toEqual([
      expect.objectContaining({
        text: 'The tide decides the rest.',
        tipCount: 2,
        article: expect.objectContaining({ href: '/writer/first' }),
      }),
    ])
    expect(
      await w.t.query(api.passages.byWriter, { userId: w.writer })
    ).toHaveLength(2)
    expect(
      await w.t.query(api.passages.byWriter, { userId: w.readers[0]! })
    ).toEqual([])
    expect(CONTENT).toBeDefined()
  })
})
