/// <reference types="vite/client" />
/**
 * Shared fixtures for the tip count tests: a world of readers, articles and a
 * tab account; tips of each kind put into states as the money layer writes
 * them; and an independent recount of the figures from the rows.
 */
import { convexTest } from 'convex-test'
import { expect } from 'vitest'
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

export const modules = import.meta.glob('../../convex/**/*.ts')

export const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  })),
})

export const CONTENT = doc(
  'The ferry leaves at seven. The tide decides the rest.',
  'People read on the crossing. A man folds his paper.'
)
export const SENTENCES = sentencesOf(canonicalText(CONTENT))

export type Kind = 'tab' | 'wallet' | 'v1'
export type TipSpec = {
  kind: Kind
  source: TipSource
  rowId: Id<'tips'> | Id<'highlightTips'>
  receiptId: Id<'tabReceipts'> | null
  articleId: Id<'articles'>
  sentence: number | null
}

/** One state of each kind, as the money layer writes it. */
export const STATES: Record<Kind, string[]> = {
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

export function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export async function world() {
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

export type World = Awaited<ReturnType<typeof world>>

export async function addTip(
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
      // Each balance tip is the only receipt of its own pair (key = `at`),
      // so a test sets what of it was paid with `setPaid`.
      const amount = String(spec.cents * 100_000)
      await ctx.db.insert('tabVouchers', {
        network: 'TESTNET',
        chainEpoch: 'test',
        tabAccountId: w.account,
        tabContractId: 'C' + 'A'.repeat(55),
        tokenContractId: 'C' + 'T'.repeat(55),
        readerAddress: 'G' + 'B'.repeat(55),
        keyId: spec.at,
        writerAddress: 'G' + 'C'.repeat(55),
        authorId: w.writer,
        cumulative: amount,
        receiptsRoot: 'r',
        leafHashes: ['l'],
        signature: 's',
        acceptance: { acceptor: 'a', signature: 'a' },
        seq: 1,
        paidOnChain: '0',
        unsettled: true,
        state: 'ACTIVE',
        earnedNet: '0',
        pendingNet: '0',
        acceptedAt: spec.at,
        updatedAt: spec.at,
      })
      receiptId = await ctx.db.insert('tabReceipts', {
        network: 'TESTNET',
        chainEpoch: 'test',
        tabAccountId: w.account,
        keyId: spec.at,
        writerAddress: 'G' + 'C'.repeat(55),
        authorId: w.writer,
        articleId: spec.articleId,
        articleKey: 'k',
        seq: 1,
        amount,
        cumulativeAfter: amount,
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
export async function setState(
  w: World,
  tip: TipSpec,
  state: string,
  sync = true
) {
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

/**
 * Sets what a balance tip's pair has paid on chain, as a fraction of the
 * tip, the way a settlement records it, then syncs.
 */
export async function setPaid(
  w: World,
  tip: TipSpec,
  fraction: number,
  sync = true
) {
  await w.t.run(async (ctx) => {
    const receipt = (await ctx.db.get(tip.receiptId!))!
    const pair = (await ctx.db
      .query('tabVouchers')
      .withIndex('by_pair', (q) =>
        q
          .eq('tabAccountId', receipt.tabAccountId)
          .eq('keyId', receipt.keyId)
          .eq('writerAddress', receipt.writerAddress)
      )
      .first())!
    const paid = Math.floor(Number(receipt.amount) * fraction)
    await ctx.db.patch(pair._id, { paidOnChain: String(paid) })
    if (sync) await syncOf(ctx as unknown as MutationCtx, tip)
  })
}

export async function syncOf(ctx: MutationCtx, tip: TipSpec) {
  return tip.receiptId
    ? syncTipCountsForReceipt(ctx, tip.receiptId, 10)
    : syncTipCounts(ctx, tip.source, tip.rowId, 10)
}

export async function replay(w: World, tip: TipSpec) {
  return w.t.run((ctx) => syncOf(ctx as unknown as MutationCtx, tip))
}

export type Recount = {
  tipCount: number
  tipCents: number
  distinctTippers: number
  unidentifiedTipCount: number
}

/** The figures recomputed from the rows, without the module under test. */
export async function recount(w: World, tips: TipSpec[]) {
  const rows = await w.t.run(async (ctx) => {
    const pairs = await ctx.db.query('tabVouchers').collect()
    return Promise.all(
      tips.map(async (tip) => {
        const row = (await ctx.db.get(tip.rowId)) as
          | Doc<'tips'>
          | Doc<'highlightTips'>
        const receipt = tip.receiptId ? await ctx.db.get(tip.receiptId) : null
        return {
          tip,
          row,
          receipt,
          // What the tip's own pair has paid on chain, in base units.
          paid: receipt
            ? Number(
                pairs.find((pair) => pair.keyId === receipt.keyId)
                  ?.paidOnChain ?? 0
              )
            : 0,
          tipperKnown: (await ctx.db.get(row.tipperId)) !== null,
        }
      })
    )
  })
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
  for (const { tip, row, receipt, paid, tipperKnown } of rows) {
    let counted: boolean
    let cents = row.amountCents
    if (tip.kind === 'tab') {
      // In full while accepted or settled; otherwise only the paid part.
      const amount = Number(receipt!.amount)
      if (['ACCEPTED', 'SETTLED'].includes(receipt!.status)) {
        counted = true
      } else {
        const part = Math.min(paid, amount)
        counted = part > 0
        cents = Math.round((row.amountCents * part) / amount)
      }
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

export const figuresOf = (r: Partial<Recount> | null | undefined): Recount => ({
  tipCount: r?.tipCount ?? 0,
  tipCents: r?.tipCents ?? 0,
  distinctTippers: r?.distinctTippers ?? 0,
  unidentifiedTipCount: r?.unidentifiedTipCount ?? 0,
})

export async function expectFiguresMatch(w: World, tips: TipSpec[]) {
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

export async function countTables(w: World) {
  return w.t.run(async (ctx) => ({
    entries: await ctx.db.query('tipCountEntries').collect(),
    articles: await ctx.db.query('articleTipStats').collect(),
    passages: await ctx.db.query('passageStats').collect(),
    memberships: await ctx.db.query('tipperMemberships').collect(),
  }))
}
