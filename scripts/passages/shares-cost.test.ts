/// <reference types="vite/client" />
/**
 * The cost of share paths on the worst article shapes: every path that reads
 * an article's text (`create`, `resolve`, `sweep`, `reconcileArticle`) stays
 * well under the one-second function limit, or refuses or skips the article
 * before any sentence work.
 */
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  MAX_SHAREABLE_BREAKS,
  SHARE_CODE_SECRET_ENV,
} from '../../convex/shares'
import { canonicalText, sentencesOf } from '../../lib/passages/sentences'

const modules = import.meta.glob('../../convex/**/*.ts')
/** Well under the one-second function limit, with room for a loaded machine. */
const BUDGET_MS = 1_000

beforeEach(() => {
  vi.stubEnv(SHARE_CODE_SECRET_ENV, 'test-share-secret-0123456789abcdef')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})
const doc = (...blocks: unknown[]) => ({ type: 'doc', content: blocks })

/** One paragraph of `count` "中." text nodes joined by hard breaks. */
const brokenParagraph = (count: number) => ({
  type: 'paragraph',
  content: Array.from({ length: count }, (_, i) =>
    i
      ? [{ type: 'hardBreak' }, { type: 'text', text: '中.' }]
      : [{ type: 'text', text: '中.' }]
  ).flat(),
})

async function setup(content: unknown) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const author = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'tomas',
      name: 'Tomas',
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
      title: 'T',
      slug: 'a',
      content,
      authorId: author,
      authorUsername: 'tomas',
      published: true,
      publishedAt: 1,
      contentVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    return { reader, article }
  })
  return {
    t,
    ids,
    reader: t.withIdentity({ subject: `${ids.reader}|session` }),
  }
}

type World = Awaited<ReturnType<typeof setup>>

async function timed<T>(run: () => Promise<T>): Promise<[number, T | string]> {
  const started = performance.now()
  let out: T | string
  try {
    out = await run()
  } catch (error) {
    out =
      error instanceof ConvexError
        ? String((error.data as { code: string }).code)
        : String(error)
  }
  return [performance.now() - started, out]
}

async function replace(w: World, articleId: Id<'articles'>, content: unknown) {
  await w.t.run((ctx) =>
    ctx.db.patch(articleId, {
      content,
      contentVersion: 2,
      updatedAt: Date.now() + 10,
    })
  )
}

const sweepStep = (w: World) =>
  w.t.mutation(internal.shares.sweep, { steps: 1 })
const reconcile = (w: World) =>
  w.t.mutation(internal.shares.reconcileArticle, { articleId: w.ids.article })

describe('10,000 copies of "5!" and 167-sentence quotes', () => {
  const fives = (n: number) => Array.from({ length: n }, () => '5!').join(' ')

  test('create, resolve, sweep and reconcile stay within budget', async () => {
    const w = await setup(doc(paragraph(fives(10_000))))
    const sentences = sentencesOf(canonicalText(doc(paragraph(fives(10_000)))))
    const codes: string[] = []
    for (let k = 0; k < 3; k++) {
      const [ms, out] = await timed(() =>
        w.reader.mutation(api.shares.create, {
          articleId: w.ids.article,
          passage: {
            startOffset: sentences[k]!.start,
            endOffset: sentences[k + 166]!.end,
          },
        })
      )
      expect(out).toMatchObject({ code: expect.any(String) })
      expect(ms).toBeLessThan(BUDGET_MS)
      codes.push((out as { code: string }).code)
    }
    const [resolveMs, resolved] = await timed(() =>
      w.t.query(api.shares.resolve, { code: codes[0]! })
    )
    expect(resolved).toMatchObject({ status: 'exact' })
    expect(resolveMs).toBeLessThan(BUDGET_MS)

    await replace(w, w.ids.article, doc(paragraph(fives(10_000))))
    const [sweepMs, swept] = await timed(() => sweepStep(w))
    expect(swept).toMatchObject({ rechecked: 3, cleared: 0 })
    expect(sweepMs).toBeLessThan(BUDGET_MS)
    const [reconcileMs, reconciled] = await timed(() => reconcile(w))
    expect(reconciled).toEqual({ cleared: 0, done: true })
    expect(reconcileMs).toBeLessThan(BUDGET_MS)

    // 9,853 sentences; every candidate now fails only at its last sentence.
    const lateMiss = Array.from({ length: 59 }, () => `${fives(166)} 6!`).join(
      ' '
    )
    await replace(w, w.ids.article, doc(paragraph(lateMiss)))
    const [missMs, missed] = await timed(() =>
      w.t.query(api.shares.resolve, { code: codes[1]! })
    )
    expect(missed).toMatchObject({ status: 'changed', passage: null })
    expect(missMs).toBeLessThan(BUDGET_MS)
    const [sweep2Ms, swept2] = await timed(() => sweepStep(w))
    const { rechecked, cleared } = swept2 as {
      rechecked: number
      cleared: number
    }
    expect(cleared).toBe(rechecked)
    expect(cleared).toBeGreaterThanOrEqual(2)
    expect(sweep2Ms).toBeLessThan(BUDGET_MS)
    const rows = await w.t.run((ctx) => ctx.db.query('shares').collect())
    expect(rows.every((r) => r.quote === null)).toBe(true)
  })

  test('reconcile of a full batch of long quotes stays within budget', async () => {
    const w = await setup(doc(paragraph(fives(10_000))))
    await w.t.run(async (ctx) => {
      for (let i = 0; i < 100; i++) {
        await ctx.db.insert('shares', {
          code: `c${String(i).padStart(7, '2')}`,
          kind: 'canonical',
          articleId: w.ids.article,
          passageId: `p${i}`,
          sentenceStart: i,
          sentenceEnd: i + 166,
          quote: `${fives(166)} 6!`,
          contentVersion: 1,
          createdAt: 1,
          checkedAt: 1,
        })
      }
    })
    const [ms, out] = await timed(() => reconcile(w))
    expect(out).toEqual({ cleared: 100, done: true })
    expect(ms).toBeLessThan(BUDGET_MS)
  })
})

describe('one paragraph of "中." joined by hard breaks', () => {
  const plain = 'A plain line to share.'

  test('under the break limit: every path stays within budget', async () => {
    const w = await setup(doc(paragraph(plain)))
    const { code } = await w.t.mutation(api.shares.create, {
      articleId: w.ids.article,
      passage: { startOffset: 0, endOffset: 0 },
    })
    const heavy = doc(paragraph(plain), brokenParagraph(MAX_SHAREABLE_BREAKS))
    await replace(w, w.ids.article, heavy)
    const [resolveMs, resolved] = await timed(() =>
      w.t.query(api.shares.resolve, { code })
    )
    expect(resolved).toMatchObject({ status: 'exact' })
    expect(resolveMs).toBeLessThan(BUDGET_MS)
    const [createMs, created] = await timed(() =>
      w.t.mutation(api.shares.create, {
        articleId: w.ids.article,
        passage: { startOffset: 0, endOffset: 0 },
      })
    )
    expect(created).toEqual({ code })
    expect(createMs).toBeLessThan(BUDGET_MS)
    const [sweepMs, swept] = await timed(() => sweepStep(w))
    expect(swept).toMatchObject({ rechecked: 1, cleared: 0 })
    expect(sweepMs).toBeLessThan(BUDGET_MS)
    const [reconcileMs] = await timed(() => reconcile(w))
    expect(reconcileMs).toBeLessThan(BUDGET_MS)
  })

  test('past the break limit: refused or skipped before any sentence work', async () => {
    const w = await setup(doc(paragraph(plain)))
    const { code } = await w.t.mutation(api.shares.create, {
      articleId: w.ids.article,
      passage: { startOffset: 0, endOffset: 0 },
    })
    await replace(
      w,
      w.ids.article,
      doc(paragraph(plain), brokenParagraph(20_000))
    )
    const [resolveMs, resolved] = await timed(() =>
      w.t.query(api.shares.resolve, { code })
    )
    expect(resolved).toBeNull()
    expect(resolveMs).toBeLessThan(BUDGET_MS)
    const [createMs, created] = await timed(() =>
      w.t.mutation(api.shares.create, {
        articleId: w.ids.article,
        passage: { startOffset: 0, endOffset: 0 },
      })
    )
    expect(created).toBe('ARTICLE_TOO_LONG')
    expect(createMs).toBeLessThan(BUDGET_MS)
    const [sweepMs, swept] = await timed(() => sweepStep(w))
    expect(swept).toMatchObject({ skipped: 1, cleared: 0 })
    expect(sweepMs).toBeLessThan(BUDGET_MS)
    const [reconcileMs, reconciled] = await timed(() => reconcile(w))
    expect(reconciled).toEqual({ cleared: 0, done: true })
    expect(reconcileMs).toBeLessThan(BUDGET_MS)
  })
})

describe('one paragraph with a long run of combining marks', () => {
  const plain = 'A plain line to share.'
  // "a" and 99,988 pairs of marks: 199,977 characters, under the size limit.
  const marks = 'a' + '\u0315\u0300'.repeat(99_988)

  test('refused or skipped before any NFC, on every path', async () => {
    const w = await setup(doc(paragraph(plain)))
    const { code } = await w.t.mutation(api.shares.create, {
      articleId: w.ids.article,
      passage: { startOffset: 0, endOffset: 0 },
    })
    await replace(w, w.ids.article, doc(paragraph(plain), paragraph(marks)))
    const [resolveMs, resolved] = await timed(() =>
      w.t.query(api.shares.resolve, { code })
    )
    expect(resolved).toBeNull()
    expect(resolveMs).toBeLessThan(BUDGET_MS)
    const [createMs, created] = await timed(() =>
      w.t.mutation(api.shares.create, {
        articleId: w.ids.article,
        passage: { startOffset: 0, endOffset: 0 },
      })
    )
    expect(created).toBe('ARTICLE_TOO_LONG')
    expect(createMs).toBeLessThan(BUDGET_MS)
    const [sweepMs, swept] = await timed(() => sweepStep(w))
    expect(swept).toMatchObject({ skipped: 1, cleared: 0 })
    expect(sweepMs).toBeLessThan(BUDGET_MS)
    const [reconcileMs, reconciled] = await timed(() => reconcile(w))
    expect(reconciled).toEqual({ cleared: 0, done: true })
    expect(reconcileMs).toBeLessThan(BUDGET_MS)
  })

  test('runs of 32 marks are searched, within budget', async () => {
    const run = Array.from(
      { length: 2_000 },
      () => 'a' + '\u0300'.repeat(32)
    ).join(' ')
    const w = await setup(doc(paragraph(plain), paragraph(run)))
    const [createMs, created] = await timed(() =>
      w.t.mutation(api.shares.create, {
        articleId: w.ids.article,
        passage: { startOffset: 0, endOffset: 0 },
      })
    )
    expect(created).toMatchObject({ code: expect.any(String) })
    expect(createMs).toBeLessThan(BUDGET_MS)
    const { code } = created as { code: string }
    const [resolveMs, resolved] = await timed(() =>
      w.t.query(api.shares.resolve, { code })
    )
    expect(resolved).toMatchObject({ status: 'exact' })
    expect(resolveMs).toBeLessThan(BUDGET_MS)
    await replace(w, w.ids.article, doc(paragraph(plain), paragraph(run)))
    const [sweepMs, swept] = await timed(() => sweepStep(w))
    expect(swept).toMatchObject({ rechecked: 1, cleared: 0 })
    expect(sweepMs).toBeLessThan(BUDGET_MS)
    const [reconcileMs] = await timed(() => reconcile(w))
    expect(reconcileMs).toBeLessThan(BUDGET_MS)
  })
})
