/**
 * Payments v2 rows flagged for review (docs/architecture/v2/06-app-integration.md,
 * section 6.4).
 *
 * A row is flagged (`needsReview`) when a successful transaction paid
 * something other than the prepared values (`field:*`), carried no `Tipped`
 * event (`no_event`), or an event contradicts the recorded state
 * (`event_after_failure`, `event_hash_differs`). The row keeps the decoded
 * on-chain values next to the expected ones. Flagged rows stay out of public
 * counts and earnings until an operator resolves them.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import { internalMutation, query } from '../_generated/server'
import { readChainEnv } from '../lib/chain/env'
import { opsUserIds } from './indexer'

type TipRow = Doc<'tips'> | Doc<'highlightTips'>
type TipTable = 'tips' | 'highlightTips'

/** Statuses a flagged row can have. */
const FLAGGED_STATUSES = ['MISMATCH', 'FAILED', 'SUBMITTED', 'EXPIRED'] as const
const PER_STATUS = 50

/**
 * Mismatch reasons where the decoded event is a payment to the intended
 * article and recipient, so crediting the decoded amounts is meaningful.
 */
export const CREDITABLE_REASONS: readonly string[] = [
  'field:gross',
  'field:token',
  'field:fee',
  'field:tipper',
  'field:highlight_id',
  'field:ledger',
]

const COMPARED_FIELDS = [
  'tipper',
  'author',
  'token',
  'gross',
  'articleKey',
  'highlightKey',
  'clientRef',
] as const

export function expectedValues(row: TipRow) {
  return {
    tipper: row.expectedTipperAddress ?? null,
    author: row.expectedAuthorAddress ?? null,
    token: row.tokenContractId ?? null,
    gross: row.grossBaseUnits ?? null,
    articleKey: row.chainArticleKey ?? null,
    highlightKey: row.chainHighlightKey ?? null,
    clientRef: row.clientRef ?? null,
  }
}

/** Decoded on-chain values, or null when no event was found. */
export function decodedValues(row: TipRow) {
  if (row.onChainGrossBaseUnits === undefined) return null
  return {
    tipper: row.onChainTipperAddress ?? null,
    author: row.onChainAuthorAddress ?? null,
    token: row.onChainTokenContractId ?? null,
    gross: row.onChainGrossBaseUnits ?? null,
    fee: row.feeBaseUnits ?? null,
    net: row.netBaseUnits ?? null,
    articleKey: row.onChainArticleKey ?? null,
    highlightKey: row.onChainHighlightKey ?? null,
    clientRef: row.onChainClientRef ?? null,
  }
}

/** Fields whose decoded value differs from the expected one. */
export function differingFields(row: TipRow): string[] {
  const expected = expectedValues(row)
  const decoded = decodedValues(row)
  if (!decoded) return []
  return COMPARED_FIELDS.filter((field) => expected[field] !== decoded[field])
}

async function requireOps(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx)
  return !!userId && opsUserIds().has(userId)
}

/**
 * Flagged v2 rows with expected and decoded values side by side, for
 * `app/ops/chain`. Null unless the user is in `OPS_USER_IDS`.
 */
export const getFlaggedTips = query({
  args: {},
  handler: async (ctx) => {
    if (!(await requireOps(ctx))) return null
    readChainEnv()
    const rows: Array<{ table: TipTable; row: TipRow }> = []
    for (const table of ['tips', 'highlightTips'] as const) {
      for (const status of FLAGGED_STATUSES) {
        const page = await ctx.db
          .query(table)
          .withIndex('by_status', (q) => q.eq('status', status))
          .order('desc')
          .take(PER_STATUS)
        for (const row of page) {
          if (row.contractVersion === 'v2' && row.needsReview === true) {
            rows.push({ table, row })
          }
        }
      }
    }
    rows.sort((a, b) => b.row.updatedAt - a.row.updatedAt)
    return {
      rows: rows.map(({ table, row }) => ({
        table,
        id: row._id as string,
        submissionId: (row.submissionId ?? null) as string | null,
        status: row.status,
        mismatchReason: row.mismatchReason ?? null,
        txHash: row.stellarTxId ?? null,
        ledger: row.stellarLedger ?? null,
        expected: expectedValues(row),
        decoded: decodedValues(row),
        differing: differingFields(row),
        creditable:
          row.status === 'MISMATCH' &&
          decodedValues(row) !== null &&
          CREDITABLE_REASONS.includes(row.mismatchReason ?? ''),
        updatedAt: row.updatedAt,
      })),
      sampleLimit: PER_STATUS * FLAGGED_STATUSES.length * 2,
    }
  },
})

/**
 * Operator decision on a flagged row:
 * - `credit_decoded`: the decoded payment counts. Public counts and earnings
 *   then use the decoded token, gross and net. Only for a `MISMATCH` whose
 *   reason is in `CREDITABLE_REASONS` and that has decoded values.
 * - `no_credit`: the row stays out of counts and earnings.
 * The row's status does not change, and no retry is offered (I-24).
 */
export const resolveFlaggedTip = internalMutation({
  args: {
    table: v.union(v.literal('tips'), v.literal('highlightTips')),
    rowId: v.string(),
    resolution: v.union(v.literal('credit_decoded'), v.literal('no_credit')),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    readChainEnv()
    const id = ctx.db.normalizeId(args.table, args.rowId)
    const row = id ? ((await ctx.db.get(id)) as TipRow | null) : null
    if (!row || row.contractVersion !== 'v2' || row.needsReview !== true) {
      throw new ConvexError({
        code: 'NOT_FLAGGED',
        message: 'No v2 row flagged for review with this ID.',
      })
    }
    const note = args.note.trim().slice(0, 500)
    if (!note) {
      throw new ConvexError({
        code: 'NOTE_REQUIRED',
        message: 'Record why the row is resolved.',
      })
    }
    if (args.resolution === 'credit_decoded') {
      if (
        row.status !== 'MISMATCH' ||
        decodedValues(row) === null ||
        !CREDITABLE_REASONS.includes(row.mismatchReason ?? '')
      ) {
        throw new ConvexError({
          code: 'NOT_CREDITABLE',
          message: `A ${row.status} row with reason ${row.mismatchReason ?? 'none'} cannot be credited from its decoded values.`,
        })
      }
    }
    const now = Date.now()
    const patch = {
      needsReview: false,
      reviewResolution: args.resolution,
      reviewResolvedAt: now,
      reviewNote: note,
      // The earnings sync handled the row as held; let it handle it again.
      earningsAppliedAt: undefined,
      earningsSkipReason: undefined,
      updatedAt: now,
    }
    if (args.table === 'tips') {
      await ctx.db.patch(row._id as Id<'tips'>, patch)
    } else {
      await ctx.db.patch(row._id as Id<'highlightTips'>, patch)
    }
    return { resolution: args.resolution }
  },
})
