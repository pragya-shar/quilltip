/// <reference types="vite/client" />
/**
 * Tip counts (`convex/lib/counts/sync.ts`). The invariant: after any sequence
 * of accepted, settled, failed, reviewed and replayed status changes, every
 * article and passage figure equals a recount from the tip rows and receipts.
 */
import { describe, expect, test } from 'vitest'
import type { MutationCtx } from '../../convex/_generated/server'
import { syncTipCountsForReceipt } from '../../convex/lib/counts/sync'
import {
  STATES,
  addTip,
  countTables,
  doc,
  expectFiguresMatch,
  figuresOf,
  mulberry32,
  replay,
  setState,
  world,
  type Kind,
  type TipSpec,
} from './fixtures'

describe('invariant: the figures equal a recount from the rows', () => {
  test.each([1, 2, 3, 4, 5, 6])(
    'random sequence of status changes and replays, seed %i',
    async (seed) => {
      const random = mulberry32(seed)
      const pick = <T>(list: readonly T[]) =>
        list[Math.floor(random() * list.length)]!
      const w = await world()
      const tippers = [...w.readers, w.gone]
      const tips: TipSpec[] = []
      for (let i = 0; i < 14; i++) {
        const kind = pick<Kind>(['tab', 'tab', 'wallet', 'v1'])
        tips.push(
          await addTip(w, {
            kind,
            tipper: pick(tippers),
            articleId: pick(w.articles),
            sentence: random() < 0.6 ? pick([0, 1, 2, 3]) : null,
            cents: 10 + Math.floor(random() * 490),
            at: 100 + i,
          })
        )
        // A balance tip counts from acceptance.
        if (kind === 'tab') await replay(w, tips[i]!)
      }
      await expectFiguresMatch(w, tips)
      for (let step = 0; step < 60; step++) {
        const tip = pick(tips)
        const roll = random()
        if (roll < 0.2) {
          await replay(w, tip)
        } else {
          await setState(w, tip, pick(STATES[tip.kind]))
          if (roll > 0.85) await replay(w, tip)
        }
        await expectFiguresMatch(w, tips)
      }
    }
  )
})

describe('cases', () => {
  test('replaying a change writes nothing', async () => {
    const w = await world()
    const tip = await addTip(w, {
      kind: 'tab',
      tipper: w.readers[0]!,
      articleId: w.articles[0]!,
      sentence: 1,
      cents: 50,
      at: 1,
    })
    expect(await replay(w, tip)).toMatchObject({ changed: true, live: true })
    const before = await countTables(w)
    for (let i = 0; i < 3; i++)
      expect(await replay(w, tip)).toMatchObject({ changed: false })
    await setState(w, tip, 'ACCEPTED')
    expect(await countTables(w)).toEqual(before)
  })

  test('a failed balance tip takes its count back exactly once', async () => {
    const w = await world()
    const tip = await addTip(w, {
      kind: 'tab',
      tipper: w.readers[0]!,
      articleId: w.articles[0]!,
      sentence: 0,
      cents: 120,
      at: 1,
    })
    await replay(w, tip)
    await setState(w, tip, 'UNPAID')
    await replay(w, tip)
    await setState(w, tip, 'UNPAID')
    const t = await countTables(w)
    expect(figuresOf(t.articles[0])).toEqual(figuresOf(null))
    expect(figuresOf(t.passages[0])).toEqual(figuresOf(null))
    expect(t.entries[0]).toMatchObject({ live: false, cents: 0 })
  })

  test('a reader tipping twice is two tips and one reader, on the article and the line', async () => {
    const w = await world()
    for (const at of [1, 2]) {
      const tip = await addTip(w, {
        kind: 'tab',
        tipper: w.readers[0]!,
        articleId: w.articles[0]!,
        sentence: 2,
        cents: 50,
        at,
      })
      await replay(w, tip)
    }
    const t = await countTables(w)
    expect(figuresOf(t.articles[0])).toEqual({
      tipCount: 2,
      tipCents: 100,
      distinctTippers: 1,
      unidentifiedTipCount: 0,
    })
    expect(figuresOf(t.passages[0])).toEqual(figuresOf(t.articles[0]))
  })

  test('an unknown tipper adds a tip and its cents, never a reader', async () => {
    const w = await world()
    const known = await addTip(w, {
      kind: 'tab',
      tipper: w.readers[0]!,
      articleId: w.articles[0]!,
      sentence: null,
      cents: 30,
      at: 1,
    })
    const unknown = await addTip(w, {
      kind: 'tab',
      tipper: w.gone,
      articleId: w.articles[0]!,
      sentence: null,
      cents: 40,
      at: 2,
    })
    await replay(w, known)
    await replay(w, unknown)
    expect(figuresOf((await countTables(w)).articles[0])).toEqual({
      tipCount: 2,
      tipCents: 70,
      distinctTippers: 1,
      unidentifiedTipCount: 1,
    })
  })

  test('a credit_decoded review counts the decoded amount at the row’s quote', async () => {
    const w = await world()
    const tip = await addTip(w, {
      kind: 'wallet',
      tipper: w.readers[1]!,
      articleId: w.articles[1]!,
      sentence: null,
      cents: 50,
      at: 1,
    })
    await setState(w, tip, 'MISMATCH:review')
    expect(figuresOf((await countTables(w)).articles[0])).toEqual(
      figuresOf(null)
    )
    await setState(w, tip, 'MISMATCH:credit_decoded')
    // Decoded 2,100,000 base units against 5,000,000 expected: 42% of 50 cents.
    expect((await countTables(w)).articles[0]).toMatchObject({
      tipCount: 1,
      tipCents: 21,
    })
  })

  test('a tip keeps the passage it was counted on after the article is edited', async () => {
    const w = await world()
    const tip = await addTip(w, {
      kind: 'tab',
      tipper: w.readers[0]!,
      articleId: w.articles[0]!,
      sentence: 1,
      cents: 60,
      at: 1,
    })
    await replay(w, tip)
    await w.t.run((ctx) =>
      ctx.db.patch(w.articles[0]!, { content: doc('Entirely new text.') })
    )
    await setState(w, tip, 'REJECTED')
    const t = await countTables(w)
    expect(t.passages).toHaveLength(1)
    expect(figuresOf(t.passages[0])).toEqual(figuresOf(null))
    expect(t.passages[0]!.passageId.startsWith('legacy:')).toBe(false)
  })

  test('a receipt syncs the highlight tip row it belongs to', async () => {
    const w = await world()
    const tip = await addTip(w, {
      kind: 'tab',
      tipper: w.readers[2]!,
      articleId: w.articles[0]!,
      sentence: 3,
      cents: 25,
      at: 1,
    })
    await w.t.run((ctx) =>
      syncTipCountsForReceipt(ctx as unknown as MutationCtx, tip.receiptId!)
    )
    const t = await countTables(w)
    expect(t.entries[0]).toMatchObject({
      source: 'highlightTips',
      rowId: String(tip.rowId),
      live: true,
    })
    expect(t.passages[0]).toMatchObject({ tipCount: 1, tipCents: 25 })
  })

  test('a tip that never counted writes nothing', async () => {
    const w = await world()
    const tip = await addTip(w, {
      kind: 'wallet',
      tipper: w.readers[0]!,
      articleId: w.articles[0]!,
      sentence: 0,
      cents: 50,
      at: 1,
    })
    await setState(w, tip, 'SUBMITTED')
    await setState(w, tip, 'FAILED')
    const t = await countTables(w)
    expect(t).toEqual({
      entries: [],
      articles: [],
      passages: [],
      memberships: [],
    })
  })
})
