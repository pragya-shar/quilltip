/**
 * Lifetime totals per recipient for the writer's earnings summary (#552),
 * kept on `authorEarnings` and read as they are.
 *
 * XLM, dollars and count cover the same tips: verified v1 tips, confirmed v2
 * wallet tips (each recipient's share) and tab tips settled on chain. Each
 * group is credited in the mutation that credits its tips, so its XLM, its
 * dollars and its count change together:
 *
 * | Group  | XLM                     | Dollars          | Count          | Credited by                  |
 * | ------ | ----------------------- | ---------------- | -------------- | ---------------------------- |
 * | v1     | `v1ShareStroops`        | `v1EarnedCents`  | `v1TipCount`   | `articleTipVerify`, `stellarVerify` |
 * | Wallet | `walletEarnedBaseUnits` | `v2EarnedCents`  | `v2TipCount`   | `lib/v2Earnings.ts` (`creditUser`) |
 * | Tab    | `tabSettledBaseUnits`   | `tabEarnedCents` | `tabTipCount`  | `setReceiptStatus` (settled) |
 *
 * A legacy v1 tip flagged `amountUsdSuspicious` keeps its verified XLM and
 * its place in the count, but has no trusted dollar amount: it counts in
 * `v1UnpricedTipCount` instead of `v1EarnedCents`.
 *
 * `lifetimeTotalsAt` marks a row whose totals cover its whole history. A row
 * created after this change gets it at once, unless its user has v1 rows;
 * other rows get it from the rebuild (`earningsTotalsBackfill.ts`), which
 * reads the history in steps and stores its progress on the row
 * (`lifetimeRebuild`). A credit made during a rebuild also goes into the
 * rebuild's sums when the rebuild has already read the row or pair it
 * changes, so the rebuild never restarts and never counts a tip twice.
 *
 * `tipRowTotals` is the one rule for a tip row: live credits, the rebuild and
 * the summary query apply it. Live writers, one per group: `creditV1TipTotals`
 * (v1 verification) and `reverseV1TipTotals` (a v1 tip marked fraudulent),
 * `creditUser` in `v2Earnings.ts` (wallet) and `creditTabTipTotals` (tab
 * settlement). The rebuild replaces the totals with
 * the same rule applied to the history.
 */
import type { Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { DatabaseReader, MutationCtx } from '../_generated/server'
import {
  roundCents,
  tabShareCents,
  writerShareCents,
  writerShareStroops,
} from './authorEarnings'
import type {
  lifetimeRebuildValidator,
  lifetimeTotalsValidator,
} from './lifetimeTotalsFields'
import {
  AGGREGATE_LIMIT,
  contractVersionOf,
  countsAsPaid,
  type TipRow,
} from './tipReads'

export type LifetimeTotals = Infer<typeof lifetimeTotalsValidator>
export type LifetimeRebuild = Infer<typeof lifetimeRebuildValidator>
export type BaseUnits = Record<string, string>

export function emptyLifetimeTotals(): LifetimeTotals {
  return {
    v1TipCount: 0,
    v1EarnedCents: 0,
    v1ShareStroops: '0',
    v1UnpricedTipCount: 0,
    tabTipCount: 0,
    tabEarnedCents: 0,
    tabSettledBaseUnits: {},
    walletEarnedBaseUnits: {},
  }
}

export function addUnits(
  a: BaseUnits | undefined,
  b: BaseUnits | undefined
): BaseUnits {
  const out = { ...a }
  for (const [token, units] of Object.entries(b ?? {})) {
    out[token] = (BigInt(out[token] ?? '0') + BigInt(units)).toString()
  }
  return out
}

export function addLifetimeTotals(
  a: LifetimeTotals,
  b: Partial<LifetimeTotals>
): LifetimeTotals {
  return {
    v1TipCount: a.v1TipCount + (b.v1TipCount ?? 0),
    v1EarnedCents: roundCents(a.v1EarnedCents + (b.v1EarnedCents ?? 0)),
    v1ShareStroops: (
      BigInt(a.v1ShareStroops) + BigInt(b.v1ShareStroops ?? '0')
    ).toString(),
    v1UnpricedTipCount: a.v1UnpricedTipCount + (b.v1UnpricedTipCount ?? 0),
    tabTipCount: a.tabTipCount + (b.tabTipCount ?? 0),
    tabEarnedCents: roundCents(a.tabEarnedCents + (b.tabEarnedCents ?? 0)),
    tabSettledBaseUnits: addUnits(a.tabSettledBaseUnits, b.tabSettledBaseUnits),
    walletEarnedBaseUnits: addUnits(
      a.walletEarnedBaseUnits,
      b.walletEarnedBaseUnits
    ),
  }
}

/** The totals stored on a row; a missing field is zero. */
export function readLifetimeTotals(
  row: Doc<'authorEarnings'> | null | undefined
): LifetimeTotals {
  return {
    v1TipCount: row?.v1TipCount ?? 0,
    v1EarnedCents: row?.v1EarnedCents ?? 0,
    v1ShareStroops: row?.v1ShareStroops ?? '0',
    v1UnpricedTipCount: row?.v1UnpricedTipCount ?? 0,
    tabTipCount: row?.tabTipCount ?? 0,
    tabEarnedCents: row?.tabEarnedCents ?? 0,
    tabSettledBaseUnits: row?.tabSettledBaseUnits ?? {},
    walletEarnedBaseUnits: row?.walletEarnedBaseUnits ?? {},
  }
}

/**
 * The tab tips settled on chain as the totals keep them, for the writer's
 * money views (`convex/earnings.ts`, `lib/chain/balanceFigures.ts`), which
 * read them and never write them.
 */
export function tabSettledOf(
  row: Doc<'authorEarnings'> | null | undefined,
  token: string | null
): { tipCount: number; cents: number; baseUnits: bigint } {
  const t = readLifetimeTotals(row)
  return {
    tipCount: t.tabTipCount,
    cents: t.tabEarnedCents,
    baseUnits: token ? BigInt(t.tabSettledBaseUnits[token] ?? '0') : BigInt(0),
  }
}

/**
 * What one tip row adds to its author's totals: a verified v1 tip, or a tab
 * tip settled on chain (`earningsAppliedAt`). Wallet tips are credited per
 * recipient share by the earnings sync, so a wallet row adds nothing here.
 */
export function tipRowTotals(row: TipRow): Partial<LifetimeTotals> | null {
  if (contractVersionOf(row) === 'v1') {
    if (!countsAsPaid(row)) return null
    const share = (writerShareStroops(row) ?? BigInt(0)).toString()
    if ('amountUsdSuspicious' in row && row.amountUsdSuspicious === true) {
      return { v1TipCount: 1, v1ShareStroops: share, v1UnpricedTipCount: 1 }
    }
    return {
      v1TipCount: 1,
      v1ShareStroops: share,
      v1EarnedCents: writerShareCents(
        row.amountCents,
        row.expectedAmountStroops
      ),
    }
  }
  return null
}

/**
 * What a tab tip adds once `paidNet` of its receipt is paid on chain: the
 * net itself, the tip's quoted cents in proportion to the paid share of the
 * receipt's gross (the same grid as `tabShareCents`), and the tip once, from
 * its first paid part. Nothing while nothing is paid.
 */
export function tabPaidTotals(
  paidNet: bigint,
  amountCents: number,
  gross: bigint,
  token: string
): Partial<LifetimeTotals> | null {
  if (paidNet <= BigInt(0)) return null
  return {
    tabTipCount: 1,
    tabEarnedCents: tabShareCents(amountCents, paidNet, gross),
    tabSettledBaseUnits: { [token]: paidNet.toString() },
  }
}

/** The change of a tab tip's totals when its paid net goes `before` → `after`. */
export function tabPaidDelta(
  amountCents: number,
  gross: bigint,
  token: string,
  before: bigint,
  after: bigint
): Partial<LifetimeTotals> {
  const was = tabPaidTotals(before, amountCents, gross, token)
  const now = tabPaidTotals(after, amountCents, gross, token)
  return {
    tabTipCount: (now ? 1 : 0) - (was ? 1 : 0),
    tabEarnedCents: roundCents(
      (now?.tabEarnedCents ?? 0) - (was?.tabEarnedCents ?? 0)
    ),
    tabSettledBaseUnits: { [token]: (after - before).toString() },
  }
}

export type TipTable = 'tips' | 'highlightTips'
const PHASE_ORDER = { tips: 0, highlightTips: 1, pairs: 2 } as const

/** True when the rebuild has read this tip row (it reads by `_creationTime`). */
export function rebuildHasRead(
  r: LifetimeRebuild,
  table: TipTable,
  creationTime: number
): boolean {
  const t = PHASE_ORDER[table]
  const p = PHASE_ORDER[r.phase]
  if (t !== p) return t < p
  return r.lastCreationTime !== null && creationTime <= r.lastCreationTime
}

async function earningsRow(ctx: MutationCtx, userId: Id<'users'>) {
  return ctx.db
    .query('authorEarnings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
}

/**
 * The only live writer of the `tab*` totals: the tab settlement credit
 * (`creditTabPaidRange` in `applyPairSettlement`, once per paid range of a
 * pair), with the change `tabPaidDelta` gives for the tip's receipt. Writes
 * only the `tab*` fields, and nothing for a row that is not a tab tip.
 */
export async function creditTabTipTotals(
  ctx: MutationCtx,
  userId: Id<'users'>,
  table: TipTable,
  row: TipRow,
  delta: Partial<LifetimeTotals>
): Promise<void> {
  if (row.channel !== 'tab') return
  await creditRowTotals(ctx, userId, table, row, {
    tabTipCount: delta.tabTipCount,
    tabEarnedCents: delta.tabEarnedCents,
    tabSettledBaseUnits: delta.tabSettledBaseUnits,
  })
}

/**
 * The only live writer of the `v1*` totals: v1 verification
 * (`articleTipVerify`, `stellarVerify`). Writes nothing for any other row.
 */
export async function creditV1TipTotals(
  ctx: MutationCtx,
  userId: Id<'users'>,
  table: TipTable,
  row: TipRow
): Promise<void> {
  const delta = tipRowTotals(row)
  if (delta?.v1TipCount !== 1) return
  await creditRowTotals(ctx, userId, table, row, delta)
}

/**
 * Takes a verified v1 tip back out of the v1 totals when reconciliation marks
 * it fraudulent (`markArticleTipFraudulent`), in the same mutation. Pass the
 * row as it was before the change. Writes nothing for any other row.
 */
export async function reverseV1TipTotals(
  ctx: MutationCtx,
  userId: Id<'users'>,
  table: TipTable,
  rowBefore: TipRow
): Promise<void> {
  const delta = tipRowTotals(rowBefore)
  if (delta?.v1TipCount !== 1) return
  await creditRowTotals(ctx, userId, table, rowBefore, negateTotals(delta))
}

function negateTotals(d: Partial<LifetimeTotals>): Partial<LifetimeTotals> {
  const units = (record: BaseUnits | undefined) =>
    record
      ? Object.fromEntries(
          Object.entries(record).map(([token, n]) => [
            token,
            (-BigInt(n)).toString(),
          ])
        )
      : undefined
  return {
    v1TipCount: d.v1TipCount && -d.v1TipCount,
    v1EarnedCents: d.v1EarnedCents && -d.v1EarnedCents,
    v1ShareStroops: d.v1ShareStroops && (-BigInt(d.v1ShareStroops)).toString(),
    v1UnpricedTipCount: d.v1UnpricedTipCount && -d.v1UnpricedTipCount,
    tabTipCount: d.tabTipCount && -d.tabTipCount,
    tabEarnedCents: d.tabEarnedCents && -d.tabEarnedCents,
    tabSettledBaseUnits: units(d.tabSettledBaseUnits),
    walletEarnedBaseUnits: units(d.walletEarnedBaseUnits),
  }
}

/**
 * Adds one row's totals (or takes them out), after the row is updated and
 * after `creditAuthorEarnings`, in the mutation that credits the tip. A
 * rebuild in progress gets the same change when it has read the row.
 */
async function creditRowTotals(
  ctx: MutationCtx,
  userId: Id<'users'>,
  table: TipTable,
  row: TipRow,
  delta: Partial<LifetimeTotals>
): Promise<void> {
  const earnings = await earningsRow(ctx, userId)
  if (!earnings) return
  const r = earnings.lifetimeRebuild
  await ctx.db.patch(earnings._id, {
    ...addLifetimeTotals(readLifetimeTotals(earnings), delta),
    ...(r && rebuildHasRead(r, table, row._creationTime)
      ? {
          lifetimeRebuild: { ...r, totals: addLifetimeTotals(r.totals, delta) },
        }
      : {}),
  })
}

/**
 * Records a change of a tab pair's `earnedNet` for a rebuild in progress, so
 * the wallet part of `earnedBaseUnits` comes out right at its end. A pair the
 * rebuild will still read needs nothing.
 */
export async function notePairEarned(
  ctx: MutationCtx,
  pair: Doc<'tabVouchers'>,
  delta: bigint
): Promise<void> {
  const earnings = await earningsRow(ctx, pair.authorId)
  const r = earnings?.lifetimeRebuild
  if (!earnings || !r) return
  const units = { [pair.tokenContractId]: delta.toString() }
  const at = r.writers.indexOf(pair.writerAddress)
  let next: LifetimeRebuild | null = null
  if (at === -1) {
    // Not listed: dropped if a tab row adds the address later (its pairs are
    // then read whole), otherwise added at the end.
    next = {
      ...r,
      unlistedPairNet: {
        ...r.unlistedPairNet,
        [pair.writerAddress]: addUnits(
          r.unlistedPairNet[pair.writerAddress],
          units
        ),
      },
    }
  } else if (
    r.phase === 'pairs' &&
    (at < r.writerIndex ||
      (at === r.writerIndex &&
        r.lastCreationTime !== null &&
        pair._creationTime <= r.lastCreationTime))
  ) {
    next = { ...r, pairNet: addUnits(r.pairNet, units) }
  }
  if (next) await ctx.db.patch(earnings._id, { lifetimeRebuild: next })
}

/**
 * The summary figures from totals. XLM counts native XLM only
 * (`TOKEN_CONTRACT_ID`); `xlmToken` is null before payments v2. `v1Stroops`
 * is the v1 part of the XLM; `unpriced` counts legacy v1 tips without a
 * trusted USD amount.
 */
export function lifetimeFigures(
  totals: LifetimeTotals,
  wallet: { v2EarnedCents?: number; v2TipCount?: number } | null,
  xlmToken: string | null
): {
  stroops: bigint
  cents: number
  tipCount: number
  v1Stroops: string
  unpriced: number
} {
  const units = (record: BaseUnits) =>
    xlmToken ? BigInt(record[xlmToken] ?? '0') : BigInt(0)
  return {
    stroops:
      BigInt(totals.v1ShareStroops) +
      units(totals.walletEarnedBaseUnits) +
      units(totals.tabSettledBaseUnits),
    cents: roundCents(
      totals.v1EarnedCents +
        (wallet?.v2EarnedCents ?? 0) +
        totals.tabEarnedCents
    ),
    tipCount:
      totals.v1TipCount + (wallet?.v2TipCount ?? 0) + totals.tabTipCount,
    v1Stroops: totals.v1ShareStroops,
    unpriced: totals.v1UnpricedTipCount,
  }
}

/**
 * Totals from a history read (`tipRowTotals` over the rows) and the earned
 * net of the user's tab pairs: the wallet XLM is the rest of
 * `earnedBaseUnits`. The rebuild's last step and the summary use it.
 */
export function totalsFromHistory(
  rows: LifetimeTotals,
  tabPairsNet: BaseUnits,
  earnedBaseUnits: BaseUnits | undefined
): LifetimeTotals {
  return {
    ...rows,
    walletEarnedBaseUnits: subtractUnits(earnedBaseUnits ?? {}, tabPairsNet),
  }
}

/** Every lifetime field unset: the shape of a row from before #552. */
export function clearedLifetimeTotals() {
  return {
    v1TipCount: undefined,
    v1EarnedCents: undefined,
    v1ShareStroops: undefined,
    v1UnpricedTipCount: undefined,
    tabTipCount: undefined,
    tabEarnedCents: undefined,
    tabSettledBaseUnits: undefined,
    walletEarnedBaseUnits: undefined,
  }
}

/** The totals that differ between two sets, by field name. */
export function changedLifetimeFields(
  a: LifetimeTotals,
  b: LifetimeTotals
): string[] {
  const key = (value: unknown) =>
    value && typeof value === 'object'
      ? JSON.stringify(
          Object.entries(value)
            .filter(([, n]) => n !== '0')
            .sort()
        )
      : String(value)
  return (Object.keys(a) as (keyof LifetimeTotals)[]).filter(
    (field) => key(a[field]) !== key(b[field])
  )
}

/**
 * The figures as the summary computed them before the lifetime totals (#552),
 * for a row that is not rebuilt yet: the v1 rows read (at most
 * AGGREGATE_LIMIT per table; `complete` is false beyond), plus
 * `v2EarnedCents`, `v2TipCount` and `earnedBaseUnits` as stored.
 */
export async function previousFigures(
  db: DatabaseReader,
  userId: Id<'users'>,
  earnings: Doc<'authorEarnings'> | null,
  xlmToken: string | null
): Promise<{
  stroops: bigint
  cents: number
  tipCount: number
  v1Stroops: string
  unpriced: number
  complete: boolean
}> {
  let complete = true
  let v1Stroops = BigInt(0)
  let v1Cents = 0
  let v1Count = 0
  let unpriced = 0
  for (const table of ['tips', 'highlightTips'] as const) {
    const rows: TipRow[] = await db
      .query(table)
      .withIndex('by_author', (q) => q.eq('authorId', userId))
      .take(AGGREGATE_LIMIT + 1)
    if (rows.length > AGGREGATE_LIMIT) complete = false
    for (const row of rows.slice(0, AGGREGATE_LIMIT)) {
      if (contractVersionOf(row) !== 'v1' || !countsAsPaid(row)) continue
      v1Count += 1
      v1Stroops += writerShareStroops(row) ?? BigInt(0)
      if ('amountUsdSuspicious' in row && row.amountUsdSuspicious) {
        unpriced += 1
      } else {
        v1Cents += writerShareCents(row.amountCents, row.expectedAmountStroops)
      }
    }
  }
  const v2Xlm = xlmToken
    ? BigInt(earnings?.earnedBaseUnits?.[xlmToken] ?? '0')
    : BigInt(0)
  return {
    stroops: v1Stroops + v2Xlm,
    cents: roundCents(v1Cents + (earnings?.v2EarnedCents ?? 0)),
    tipCount: v1Count + (earnings?.v2TipCount ?? 0),
    v1Stroops: v1Stroops.toString(),
    unpriced,
    complete,
  }
}

/** `a − b` per token, never below zero. */
export function subtractUnits(a: BaseUnits, b: BaseUnits): BaseUnits {
  const out: BaseUnits = {}
  for (const token of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const left = BigInt(a[token] ?? '0') - BigInt(b[token] ?? '0')
    if (left > BigInt(0)) out[token] = left.toString()
  }
  return out
}
