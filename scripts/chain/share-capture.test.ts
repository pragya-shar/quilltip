/// <reference types="vite/client" />
/**
 * The return trip of a shared line (`tabs.submitTip`'s `shareCode`,
 * `convex/lib/counts/shareSource.ts`): an accepted balance tip opened from
 * another person's personal link to the article records that link, in the
 * mutation that accepts it, and counts once for the sharer's line. A forged,
 * foreign, signed-out or own code records nothing and never fails the tip;
 * a retry counts nothing more; the sharer reads a count from two tips, from
 * the daily copy, with no amounts, times or names.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  as,
  modules,
  prepare,
  seed,
  sign,
  withTabEnv,
  type Seeded,
  type T,
} from './tab-kit'

withTabEnv()

type World = { t: T; s: Seeded; sharer: Id<'users'> }

async function world(): Promise<World> {
  const t = convexTest(schema, modules)
  const s = await seed(t)
  const sharer = await t.run((ctx) =>
    ctx.db.insert('users', {
      username: 'sharer',
      email: 'sharer@example.test',
      createdAt: 1,
      updatedAt: 1,
    })
  )
  return { t, s, sharer }
}

async function share(
  w: World,
  code: string,
  o: {
    kind?: 'personal' | 'canonical'
    by?: Id<'users'> | null
    articleId?: Id<'articles'>
    passageId?: string | null
  } = {}
) {
  await w.t.run((ctx) =>
    ctx.db.insert('shares', {
      code,
      kind: o.kind ?? 'personal',
      articleId: o.articleId ?? w.s.articleId,
      passageId: o.passageId === undefined ? 'p-shared-line' : o.passageId,
      sentenceStart: 0,
      sentenceEnd: 0,
      quote: 'A shared line.',
      contentVersion: 1,
      ...(o.by === null ? {} : { createdBy: o.by ?? w.sharer }),
      createdAt: 1,
      checkedAt: 1,
    })
  )
}

async function tipFrom(w: World, shareCode?: string, cents = 10) {
  const p = await prepare(w.t, w.s, { cents })
  const accepted = await as(w.t, w.s.readerId).mutation(api.tabs.submitTip, {
    prepareId: p.prepareId,
    receipt: p.receipt,
    signature: sign(p),
    ...(shareCode === undefined ? {} : { shareCode }),
  })
  return { p, accepted }
}

const tables = (w: World) =>
  w.t.run(async (ctx) => ({
    lines: await ctx.db.query('shareLineStats').collect(),
    entries: await ctx.db.query('tipCountEntries').collect(),
    tips: await ctx.db.query('tips').collect(),
  }))

/** Runs today's daily copy to its end, one step at a time. */
async function publish(w: World) {
  await w.t.mutation(internal.counts.startSnapshot, {})
  for (;;) {
    const step = await w.t.mutation(internal.counts.snapshotStep, {})
    if (step.done) return
  }
}

describe('a tip opened from a share link', () => {
  it("records another person's personal link and counts it for their line", async () => {
    const w = await world()
    await share(w, 'abcdefgh')
    // Read as the share page reads a code: trimmed and lowercased.
    const { p } = await tipFrom(w, ' ABCDEFGH ')
    const after = await tables(w)
    expect(
      after.tips.find((r) => r._id === p.prepareId)!.sourceShareId
    ).toBeDefined()
    expect(after.entries[0]).toMatchObject({
      sharerId: w.sharer,
      sharedPassageId: 'p-shared-line',
      live: true,
    })
    expect(after.lines).toEqual([
      expect.objectContaining({
        sharerId: w.sharer,
        articleId: w.s.articleId,
        passageId: 'p-shared-line',
        tipCount: 1,
      }),
    ])
  })

  it.each([
    ['an unknown code', 'nosuchcd', {}],
    [
      'a signed-out (canonical) link',
      'canonica',
      { kind: 'canonical', by: null },
    ],
    ['a link to another article', 'otherart', { other: true }],
    ["the tipper's own link", 'mineline', { self: true }],
    ['a cleared link with no line', 'clearedl', { passageId: null }],
  ] as const)(
    '%s records nothing and the tip is accepted',
    async (_, code, o) => {
      const w = await world()
      const opts = o as {
        kind?: 'canonical'
        by?: null
        other?: boolean
        self?: boolean
        passageId?: null
      }
      if (code !== 'nosuchcd')
        await share(w, code, {
          ...(opts.kind ? { kind: opts.kind } : {}),
          ...(opts.by === null ? { by: null } : {}),
          ...(opts.other ? { articleId: w.s.otherArticleId } : {}),
          ...(opts.self ? { by: w.s.readerId } : {}),
          ...(opts.passageId === null ? { passageId: null } : {}),
        })
      const { accepted } = await tipFrom(w, code)
      expect(accepted).toMatchObject({ status: 'ACCEPTED' })
      const after = await tables(w)
      expect(after.lines).toEqual([])
      expect(after.entries[0]).not.toHaveProperty('sharerId')
      // A cleared link is still recorded on the tip, but counts no line.
      if (opts.passageId !== null)
        expect(after.tips[0]!.sourceShareId).toBeUndefined()
    }
  )

  it('a malformed or very long code never fails the tip', async () => {
    const w = await world()
    for (const code of ['', '   ', 'not a code!', 'x'.repeat(10_000)]) {
      const { accepted } = await tipFrom(w, code)
      expect(accepted).toMatchObject({ status: 'ACCEPTED' })
    }
    expect((await tables(w)).lines).toEqual([])
  })

  it('a retry of an accepted submit counts nothing more, with any code', async () => {
    const w = await world()
    await share(w, 'abcdefgh')
    await share(w, 'secondcd', { passageId: 'p-another-line' })
    const { p } = await tipFrom(w, 'abcdefgh')
    for (const code of ['abcdefgh', 'secondcd', undefined]) {
      const again = await as(w.t, w.s.readerId).mutation(api.tabs.submitTip, {
        prepareId: p.prepareId,
        receipt: p.receipt,
        signature: sign(p),
        ...(code === undefined ? {} : { shareCode: code }),
      })
      expect(again).toMatchObject({ alreadyAccepted: true })
    }
    const after = await tables(w)
    expect(after.lines).toEqual([
      expect.objectContaining({ passageId: 'p-shared-line', tipCount: 1 }),
    ])
  })

  it('the sharer reads a count from two tips, from the daily copy only', async () => {
    const w = await world()
    await share(w, 'abcdefgh')
    const sharer = as(w.t, w.sharer)
    await tipFrom(w, 'abcdefgh')
    await publish(w)
    // One tip: nothing is said.
    expect(await sharer.query(api.counts.mySharedLines, {})).toEqual([])
    await tipFrom(w, 'abcdefgh')
    // Not before the daily copy runs.
    expect(await sharer.query(api.counts.mySharedLines, {})).toEqual([])
    await w.t.run(async (ctx) => {
      const run = await ctx.db.query('countsSnapshotRuns').unique()
      await ctx.db.patch(run!._id, { day: '2000-01-01' })
    })
    await publish(w)
    const lines = await sharer.query(api.counts.mySharedLines, {})
    expect(lines).toEqual([
      {
        articleId: w.s.articleId,
        passageId: 'p-shared-line',
        tipCount: 2,
      },
    ])
    // Nobody else reads it, and it carries no amount, time or name.
    expect(
      await as(w.t, w.s.readerId).query(api.counts.mySharedLines, {})
    ).toEqual([])
    expect(await w.t.query(api.counts.mySharedLines, {})).toEqual([])
    expect(JSON.stringify(lines)).not.toMatch(/cents|At"|reader|tipper/i)
  })
})

describe('a refused tip', () => {
  it('records nothing: the source rolls back with the refusal', async () => {
    const w = await world()
    await share(w, 'abcdefgh')
    const p = await prepare(w.t, w.s)
    await expect(
      as(w.t, w.s.readerId).mutation(api.tabs.submitTip, {
        prepareId: p.prepareId,
        receipt: p.receipt,
        signature: '00'.repeat(64),
        shareCode: 'abcdefgh',
      })
    ).rejects.toThrow()
    const after = await tables(w)
    expect(after.tips[0]!.sourceShareId).toBeUndefined()
    expect(after.lines).toEqual([])
  })
})
