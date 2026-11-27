/// <reference types="vite/client" />
/**
 * Tip counts (`convex/lib/counts/sync.ts`). The invariant: after any sequence
 * of accepted, settled, failed, reviewed and replayed status changes, every
 * article and passage figure equals a recount from the tip rows and receipts.
 */
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from '../../convex/schema'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import type { MutationCtx } from '../../convex/_generated/server'
import {
  syncTipCounts,
  syncTipCountsForReceipt,
  type TipSource,
} from '../../convex/lib/counts/sync'
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

const CONTENT = doc(
  'The ferry leaves at seven. The tide decides the rest.',
  'People read on the crossing. A man folds his paper.'
)
const SENTENCES = sentencesOf(canonicalText(CONTENT))

type Kind = 'tab' | 'wallet' | 'v1'
type TipSpec = {
  kind: Kind
  source: TipSource
  rowId: Id<'tips'> | Id<'highlightTips'>
  receiptId: Id<'tabReceipts'> | null
  articleId: Id<'articles'>
  sentence: number | null
}

/** One state of each kind, as the money layer writes it. */
const STATES: Record<Kind, string[]> = {
  tab: ['ACCEPTED', 'SHORTFALL', 'SETTLED', 'UNPAID', 'REJECTED', 'VOID_RESET'],
  wallet: [
    'PREPARED',
    'SUBMITTED',
    'CONFIRMED',
    'FAILED',
    'EXPIRED',
    'MISMATCH:review',
    'MISMATCH:credit_decoded',
    'MISMATCH:no_credit',
  ],
  v1: ['PENDING', 'CONFIRMED', 'FAILED', 'REVERSED'],
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function world() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const user = (name: string) =>
      ctx.db.insert('users', {
        email: `${name}@example.test`,
        username: name,
        createdAt: 1,
        updatedAt: 1,
      })
    const writer = await user('writer')
    const readers = [await user('ana'), await user('ben'), await user('cy')]
    // A tipper whose account no longer exists: not a known reader.
    const gone = await user('gone')
    await ctx.db.delete(gone)
    const article = (slug: string) =>
      ctx.db.insert('articles', {
        title: slug,
        slug,
        content: CONTENT,
        authorId: writer,
        authorUsername: 'writer',
        published: true,
        publishedAt: 1,
        contentVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      })
    const articles = [await article('first'), await article('second')]
    const account = await ctx.db.insert('tabAccounts', {
      network: 'TESTNET',
      chainEpoch: 'test',
      userId: readers[0]!,
      readerAddress: 'G' + 'B'.repeat(55),
      tabContractId: 'C' + 'A'.repeat(55),
      status: 'OPEN',
      confirmedBalance: '0',
      outstanding: '0',
      acceptedToday: '0',
      acceptedDay: '2026-11-28',
      settledSinceBalance: [],
      pendingKeys: [],
      createdAt: 1,
      updatedAt: 1,
    } as never)
    return { writer, readers, gone, articles, account }
  })
  return { t, ...ids }
}

type World = Awaited<ReturnType<typeof world>>

async function addTip(
  w: World,
  spec: {
    kind: Kind
    tipper: Id<'users'>
    articleId: Id<'articles'>
    sentence: number | null
    cents: number
    at: number
  }
): Promise<TipSpec> {
  return w.t.run(async (ctx) => {
    const base = {
      articleId: spec.articleId,
      tipperId: spec.tipper,
      authorId: w.writer,
      articleTitle: 'An article',
      articleSlug: 'an-article',
      amountUsd: spec.cents / 100,
      amountCents: spec.cents,
      createdAt: spec.at,
      updatedAt: spec.at,
      ...(spec.kind === 'v1'
        ? { status: 'PENDING' }
        : {
            status: 'PREPARED',
            contractVersion: 'v2' as const,
            channel:
              spec.kind === 'tab' ? ('tab' as const) : ('direct' as const),
            grossBaseUnits: String(spec.cents * 100_000),
          }),
    }
    let rowId: Id<'tips'> | Id<'highlightTips'>
    let source: TipSource
    if (spec.sentence === null) {
      source = 'tips'
      rowId = await ctx.db.insert('tips', base)
    } else {
      const s = SENTENCES[spec.sentence]!
      source = 'highlightTips'
      rowId = await ctx.db.insert('highlightTips', {
        ...base,
        highlightId: `h${spec.at}`,
        highlightText: s.text,
        startOffset: s.start,
        endOffset: s.end,
      })
    }
    let receiptId: Id<'tabReceipts'> | null = null
    if (spec.kind === 'tab') {
      receiptId = await ctx.db.insert('tabReceipts', {
        network: 'TESTNET',
        chainEpoch: 'test',
        tabAccountId: w.account,
        keyId: 0,
        writerAddress: 'G' + 'C'.repeat(55),
        authorId: w.writer,
        articleId: spec.articleId,
        articleKey: 'k',
        seq: spec.at,
        amount: String(spec.cents * 100_000),
        cumulativeAfter: '0',
        clientRef: `ref${spec.at}`,
        contentHash: 'h',
        leafHash: 'l',
        tipRowId: rowId,
        status: 'ACCEPTED',
        receiptsRoot: 'r',
        voucherSignature: 's',
        acceptorPublicKey: 'a',
        acceptanceSignature: 'a',
        acceptedAt: spec.at,
        amountCents: spec.cents,
        createdAt: spec.at,
        updatedAt: spec.at,
      } as never)
      await ctx.db.patch(rowId, {
        status: 'ACCEPTED',
        tabReceiptId: receiptId,
      } as never)
    }
    return {
      kind: spec.kind,
      source,
      rowId,
      receiptId,
      articleId: spec.articleId,
      sentence: spec.sentence,
    }
  })
}

/** Puts a tip in a state the way the money layer would, then syncs. */
async function setState(w: World, tip: TipSpec, state: string, sync = true) {
  await w.t.run(async (ctx) => {
    if (tip.kind === 'tab') {
      await ctx.db.patch(tip.receiptId!, { status: state } as never)
    } else if (tip.kind === 'v1') {
      await ctx.db.patch(tip.rowId, {
        status: state,
        verifiedAt: state === 'CONFIRMED' ? 5 : undefined,
      } as never)
    } else {
      const [status, flag] = state.split(':')
      await ctx.db.patch(tip.rowId, {
        status,
        verifiedAt:
          status === 'CONFIRMED' || status === 'MISMATCH' ? 5 : undefined,
        needsReview: flag === 'review' ? true : undefined,
        reviewResolution:
          flag === 'credit_decoded' || flag === 'no_credit' ? flag : undefined,
        onChainGrossBaseUnits:
          flag === 'credit_decoded' ? String(3 * 100_000 * 7) : undefined,
      } as never)
    }
    if (sync) await syncOf(ctx as unknown as MutationCtx, tip)
  })
}

async function syncOf(ctx: MutationCtx, tip: TipSpec) {
  return tip.receiptId
    ? syncTipCountsForReceipt(ctx, tip.receiptId, 10)
    : syncTipCounts(ctx, tip.source, tip.rowId, 10)
}

async function replay(w: World, tip: TipSpec) {
  return w.t.run((ctx) => syncOf(ctx as unknown as MutationCtx, tip))
}

type Recount = {
  tipCount: number
  tipCents: number
  distinctTippers: number
  unidentifiedTipCount: number
}

/** The figures recomputed from the rows, without the module under test. */
async function recount(w: World, tips: TipSpec[]) {
  const rows = await w.t.run(async (ctx) =>
    Promise.all(
      tips.map(async (tip) => ({
        tip,
        row: (await ctx.db.get(tip.rowId)) as
          | Doc<'tips'>
          | Doc<'highlightTips'>,
        receipt: tip.receiptId ? await ctx.db.get(tip.receiptId) : null,
        tipperKnown:
          (await ctx.db.get(
            ((await ctx.db.get(tip.rowId)) as Doc<'tips'>).tipperId
          )) !== null,
      }))
    )
  )
  const articles = new Map<string, Recount & { readers: Set<string> }>()
  const passages = new Map<string, Recount & { readers: Set<string> }>()
  const bump = (
    map: Map<string, Recount & { readers: Set<string> }>,
    key: string,
    cents: number,
    reader: string | null
  ) => {
    const r = map.get(key) ?? {
      tipCount: 0,
      tipCents: 0,
      distinctTippers: 0,
      unidentifiedTipCount: 0,
      readers: new Set<string>(),
    }
    r.tipCount++
    r.tipCents += cents
    if (reader) r.readers.add(reader)
    else r.unidentifiedTipCount++
    r.distinctTippers = r.readers.size
    map.set(key, r)
  }
  for (const { tip, row, receipt, tipperKnown } of rows) {
    let counted: boolean
    let cents = row.amountCents
    if (tip.kind === 'tab') {
      counted = ['ACCEPTED', 'SHORTFALL', 'SETTLED'].includes(receipt!.status)
    } else if (tip.kind === 'v1') {
      counted = row.status === 'CONFIRMED' && (row.verifiedAt ?? 0) > 0
    } else {
      counted =
        (row.verifiedAt ?? 0) > 0 &&
        row.needsReview !== true &&
        row.reviewResolution !== 'no_credit' &&
        (row.status === 'CONFIRMED' || row.status === 'MISMATCH')
      if (counted && row.reviewResolution === 'credit_decoded') {
        cents = Math.round(
          (row.amountCents * Number(row.onChainGrossBaseUnits)) /
            Number(row.grossBaseUnits)
        )
      }
    }
    if (!counted) continue
    const reader = tipperKnown ? String(row.tipperId) : null
    bump(articles, tip.articleId, cents, reader)
    if (tip.sentence !== null) {
      const canonical = canonicalText(CONTENT)
      const s = SENTENCES[tip.sentence]!
      const id = await identifyPassage(
        tip.articleId,
        canonical,
        sentencesOf(canonical),
        s.start,
        s.end
      )
      bump(passages, `${tip.articleId}|${id!.passageId}`, cents, reader)
    }
  }
  return { articles, passages }
}

const figuresOf = (r: Partial<Recount> | null | undefined): Recount => ({
  tipCount: r?.tipCount ?? 0,
  tipCents: r?.tipCents ?? 0,
  distinctTippers: r?.distinctTippers ?? 0,
  unidentifiedTipCount: r?.unidentifiedTipCount ?? 0,
})

async function expectFiguresMatch(w: World, tips: TipSpec[]) {
  const want = await recount(w, tips)
  const stored = await w.t.run(async (ctx) => ({
    articles: await ctx.db.query('articleTipStats').collect(),
    passages: await ctx.db.query('passageStats').collect(),
    memberships: await ctx.db.query('tipperMemberships').collect(),
  }))
  for (const articleId of w.articles) {
    expect(
      figuresOf(stored.articles.find((a) => a.articleId === articleId)),
      `article ${articleId}`
    ).toEqual(figuresOf(want.articles.get(articleId)))
  }
  const keys = new Set([
    ...want.passages.keys(),
    ...stored.passages.map((p) => `${p.articleId}|${p.passageId}`),
  ])
  for (const key of keys) {
    const [articleId, passageId] = key.split('|')
    expect(
      figuresOf(
        stored.passages.find(
          (p) => p.articleId === articleId && p.passageId === passageId
        )
      ),
      `passage ${key}`
    ).toEqual(figuresOf(want.passages.get(key)))
  }
  // Membership rows agree with the distinct readers they imply.
  for (const m of stored.memberships)
    expect(m.liveTips).toBeGreaterThanOrEqual(0)
  const live = stored.memberships.filter((m) => m.liveTips > 0)
  expect(live.filter((m) => m.scope === 'article').length).toBe(
    stored.articles.reduce((sum, a) => sum + a.distinctTippers, 0)
  )
  expect(live.filter((m) => m.scope === 'passage').length).toBe(
    stored.passages.reduce((sum, p) => sum + p.distinctTippers, 0)
  )
}

async function countTables(w: World) {
  return w.t.run(async (ctx) => ({
    entries: await ctx.db.query('tipCountEntries').collect(),
    articles: await ctx.db.query('articleTipStats').collect(),
    passages: await ctx.db.query('passageStats').collect(),
    memberships: await ctx.db.query('tipperMemberships').collect(),
  }))
}

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
