/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import schema from '../../convex/schema'
import { internal } from '../../convex/_generated/api'

const modules = import.meta.glob('../../convex/**/*.ts')

const V2_TABLES = [
  'chainConfig',
  'chainArticles',
  'chainSubmissions',
  'chainEvents',
  'chainCursor',
  'chainLeases',
  'tabAccounts',
  'tabSessionKeys',
  'tabReceipts',
  'tabVouchers',
  'tabSettlements',
] as const

/**
 * A deployment that has the v2 code but no v2 settings, as the live
 * deployment is between the code push and the contract set (cutover stage 1).
 * Every payments v2 cron must return without network calls or writes.
 */
describe('payments v2 crons without configuration', () => {
  const fetchSpy = vi.fn()

  beforeEach(() => {
    vi.stubEnv('STELLAR_NETWORK', 'TESTNET')
    for (const name of [
      'CHAIN_V2_ENABLED',
      'CHAIN_EPOCH',
      'CORE_CONTRACT_ID',
      'TAB_CONTRACT_ID',
      'NFT_CONTRACT_ID',
      'TOKEN_CONTRACT_ID',
      'INDEXER_START_LEDGER',
      'SETTLEMENT_ENABLED',
      'TAB_SETTLER_SECRET',
      'TAB_ACCEPTOR_SECRET',
    ]) {
      vi.stubEnv(name, '')
    }
    fetchSpy.mockReset()
    vi.stubGlobal('fetch', fetchSpy)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('do no work, call no RPC and write no rows', async () => {
    const t = convexTest(schema, modules)

    expect(await t.action(internal.chain.indexer.pollEvents, {})).toEqual({
      status: 'skipped',
      reason: 'not_configured',
    })
    expect(
      await t.action(internal.chain.submissions.recheckPending, {})
    ).toEqual({ skipped: false, checked: 0 })
    expect(
      await t.action(internal.chain.config.refreshChainConfig, {})
    ).toEqual({ refreshed: false })
    expect(await t.action(internal.tabSettler.settleDue, {})).toMatchObject({
      status: 'disabled',
    })
    expect(
      await t.mutation(internal.tipEarnings.syncV2TipEarnings, {})
    ).toEqual({ credited: 0, more: false })
    // The earnings rebuild is off until the operator turns it on (#552).
    expect(await t.action(internal.earningsTotalsBackfill.run, {})).toEqual({
      status: 'disabled',
      rebuilt: 0,
      inProgress: 0,
      failed: 0,
    })
    // The fee sponsor's reconciler: off without SPONSOR_ENABLED.
    expect(await t.action(internal.sponsor.reconcile, {})).toEqual({
      checked: 0,
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    const counts = await t.run(async ({ db }) =>
      Promise.all(
        V2_TABLES.map(async (table) => (await db.query(table).collect()).length)
      )
    )
    expect(counts.every((n) => n === 0)).toBe(true)
    // The first import of the Node actions dominates on a loaded machine.
  }, 20_000)
})
