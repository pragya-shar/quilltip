/// <reference types="vite/client" />
/**
 * Tip counts (`convex/lib/counts/sync.ts`). The invariant: after any sequence
 * of accepted, settled, failed, reviewed and replayed status changes, every
 * article and passage figure equals a recount from the tip rows and receipts.
 */
import { describe, expect, test } from 'vitest'
import type { MutationCtx } from '../../convex/_generated/server'
import { syncTipCountsForReceipt } from '../../convex/lib/counts/sync'
import { syncReceiptMoneyFor } from '../../convex/lib/chain/tabLedger'
import {
  STATES,
  addTip,
  countTables,
  doc,
  expectFiguresMatch,
  figuresOf,
  mulberry32,
  replay,
  setPaid,
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
        } else if (roll < 0.35 && tip.kind === 'tab') {
          // A settlement pays part or all of the tip.
          await setPaid(w, tip, pick([0, 0.25, 0.5, 1]))
        } else {
          await setState(w, tip, pick(STATES[tip.kind]))
          if (roll > 0.85) await replay(w, tip)
        }
        await expectFiguresMatch(w, tips)
      }
    }
  )
})

describe('a balance tip: in full while accepted or settled, else its paid part', () => {
  const tabTip = (w: Awaited<ReturnType<typeof world>>) =>
    addTip(w, {
      kind: 'tab',
      tipper: w.readers[0]!,
      articleId: w.articles[0]!,
      sentence: 1,
      cents: 100,
      at: 1,
    })
  const article = async (w: Awaited<ReturnType<typeof world>>) =>
    figuresOf((await countTables(w)).articles[0])

  test('a paid part stays counted when the rest is never paid', async () => {
    const w = await world()
    const tip = await tabTip(w)
    await replay(w, tip)
    expect(await article(w)).toMatchObject({ tipCount: 1, tipCents: 100 })
    // A short settlement pays 40 of the 100 cents, then the rest fails.
    await setState(w, tip, 'SHORTFALL')
    expect(await article(w)).toMatchObject({ tipCount: 0, tipCents: 0 })
    await setPaid(w, tip, 0.4)
    expect(await article(w)).toMatchObject({ tipCount: 1, tipCents: 40 })
    await setState(w, tip, 'UNPAID')
    expect(await article(w)).toMatchObject({ tipCount: 1, tipCents: 40 })
    await replay(w, tip)
    expect(await article(w)).toMatchObject({ tipCount: 1, tipCents: 40 })
    expect((await countTables(w)).passages[0]).toMatchObject({
      tipCount: 1,
      tipCents: 40,
    })
  })

  test('a tip never paid leaves the counts once it is not accepted', async () => {
    const w = await world()
    const tip = await tabTip(w)
    await replay(w, tip)
    for (const state of ['UNPAID', 'REJECTED', 'VOID_RESET', 'SHORTFALL']) {
      await setState(w, tip, state)
      expect(await article(w), state).toMatchObject({ tipCount: 0 })
    }
  })

  test('accepted or settled counts the whole tip, whatever is paid so far', async () => {
    const w = await world()
    const tip = await tabTip(w)
    await setPaid(w, tip, 0.25)
    expect(await article(w)).toMatchObject({ tipCount: 1, tipCents: 100 })
    await setState(w, tip, 'SETTLED')
    expect(await article(w)).toMatchObject({ tipCount: 1, tipCents: 100 })
    // Paid in full and then marked rejected: what was paid still counts.
    await setPaid(w, tip, 1)
    await setState(w, tip, 'REJECTED')
    expect(await article(w)).toMatchObject({ tipCount: 1, tipCents: 100 })
  })

  test('the figures equal a recount through partial payments', async () => {
    const w = await world()
    const tips = []
    for (let i = 0; i < 6; i++)
      tips.push(
        await addTip(w, {
          kind: 'tab',
          tipper: w.readers[i % 3]!,
          articleId: w.articles[i % 2]!,
          sentence: i % 4,
          cents: 37 + i * 11,
          at: 10 + i,
        })
      )
    for (const [i, tip] of tips.entries()) {
      await replay(w, tip)
      await setPaid(w, tip, [0, 0.1, 0.5, 0.99, 1, 0.33][i]!)
      await setState(w, tip, ['UNPAID', 'SHORTFALL', 'REJECTED'][i % 3]!)
    }
    await expectFiguresMatch(w, tips)
  })
})

describe('cases', () => {
  test('the money layer syncs the counts with every receipt status change', async () => {
    const w = await world()
    const tip = await addTip(w, {
      kind: 'tab',
      tipper: w.readers[0]!,
      articleId: w.articles[0]!,
      sentence: 2,
      cents: 80,
      at: 1,
    })
    const money = () =>
      w.t.run((ctx) =>
        syncReceiptMoneyFor(ctx as unknown as MutationCtx, tip.receiptId!, 10)
      )
    // Acceptance: the money layer's sync counts the tip.
    await money()
    expect(figuresOf((await countTables(w)).articles[0])).toMatchObject({
      tipCount: 1,
      tipCents: 80,
    })
    // A status change written without a counts sync, then the money sync.
    await setState(w, tip, 'UNPAID', false)
    await money()
    expect(figuresOf((await countTables(w)).articles[0])).toMatchObject({
      tipCount: 0,
    })
    await money()
    await expectFiguresMatch(w, [tip])
  })

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
