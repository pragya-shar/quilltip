/// <reference types="vite/client" />
/**
 * The counts backfill (`internal.counts.backfill`): over rows that were never
 * synced it gives exactly the recount, a second run changes nothing, and a
 * run beside live syncs ends in the same figures.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { internal } from '../../convex/_generated/api'
import { BACKFILL_BATCH } from '../../convex/counts'
import {
  STATES,
  addTip,
  countTables,
  expectFiguresMatch,
  mulberry32,
  replay,
  setState,
  world,
  type Kind,
  type TipSpec,
} from './fixtures'

type World = Awaited<ReturnType<typeof world>>

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** Tips in random states, written as an old deployment would: never synced. */
async function seedUnsynced(w: World, seed: number, count: number) {
  const random = mulberry32(seed)
  const pick = <T>(list: readonly T[]) =>
    list[Math.floor(random() * list.length)]!
  const tips: TipSpec[] = []
  for (let i = 0; i < count; i++) {
    const kind = pick<Kind>(['tab', 'tab', 'wallet', 'v1'])
    const tip = await addTip(w, {
      kind,
      tipper: pick([...w.readers, w.gone]),
      articleId: pick(w.articles),
      sentence: random() < 0.6 ? pick([0, 1, 2, 3]) : null,
      cents: 10 + Math.floor(random() * 490),
      at: 100 + i,
    })
    await setState(w, tip, pick(STATES[kind]), false)
    tips.push(tip)
  }
  return tips
}

async function runBackfill(w: World, restart = false) {
  const first = await w.t.mutation(internal.counts.backfill, { restart })
  await w.t.finishAllScheduledFunctions(vi.runAllTimers)
  return first
}

const backfillState = (w: World) =>
  w.t.run((ctx) => ctx.db.query('countsBackfills').unique())

describe('backfill', () => {
  test.each([1, 2, 3])(
    'unsynced rows: equal to a recount; a second run changes nothing (seed %i)',
    async (seed) => {
      const w = await world()
      const tips = await seedUnsynced(w, seed, 16)
      expect((await countTables(w)).entries).toEqual([])
      await runBackfill(w)
      await expectFiguresMatch(w, tips)
      expect(await backfillState(w)).toMatchObject({
        source: 'highlightTips',
        cursor: null,
        rows: 16,
        finishedAt: expect.any(Number),
      })
      const before = await countTables(w)
      // Finished: a call without restart does nothing.
      expect(await w.t.mutation(internal.counts.backfill, {})).toMatchObject({
        done: true,
        rows: 16,
      })
      await runBackfill(w, true)
      expect(await countTables(w)).toEqual(before)
      expect(await backfillState(w)).toMatchObject({ rows: 16, changed: 0 })
    }
  )

  test('walks the tables in bounded steps', async () => {
    const w = await world()
    const tips = await seedUnsynced(w, 7, BACKFILL_BATCH + 6)
    const first = await w.t.mutation(internal.counts.backfill, {})
    expect(first.rows).toBeLessThanOrEqual(BACKFILL_BATCH)
    expect(first.done).toBe(false)
    await w.t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await backfillState(w))!.rows).toBe(BACKFILL_BATCH + 6)
    await expectFiguresMatch(w, tips)
  })

  test('beside live syncs: the same end state', async () => {
    const w = await world()
    const tips = await seedUnsynced(w, 11, 14)
    // Half the rows are synced live (a status change after the deploy).
    for (const tip of tips.slice(0, 7)) await replay(w, tip)
    await runBackfill(w)
    await expectFiguresMatch(w, tips)
    // Later status changes keep the figures exact.
    const random = mulberry32(12)
    for (let i = 0; i < 20; i++) {
      const tip = tips[Math.floor(random() * tips.length)]!
      const states = STATES[tip.kind]
      await setState(w, tip, states[Math.floor(random() * states.length)]!)
    }
    await expectFiguresMatch(w, tips)
  })
})
