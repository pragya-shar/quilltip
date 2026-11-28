/**
 * The reconciliation's chain read (#573): the Tab contract's
 * `account(reader)` and `paid(reader, key_id, writer)`, all at one ledger.
 */
import { describe, expect, it } from 'vitest'
import { nativeToScVal, xdr } from '@stellar/stellar-sdk'
import {
  INDEXER_POLL_MS,
  INDEXER_WAIT_MS,
  RECONCILE_ATTEMPTS,
  coveredLedgerOf,
  endOfLedgerEventId,
  readTabChainState,
  reconcileWhenIndexed,
  type ChainRead,
  type ReconcileResult,
  type ReconcileSteps,
} from '../../convex/chain/tabReconcile'
import type { Id } from '../../convex/_generated/dataModel'
import type { RpcClient } from '../../convex/lib/chain/rpc'
import shared from '../../contracts/shared/test-vectors.json'
import { rpcEventId } from './coreEvents'
import { seedAddress } from './fixtures'

const PASSPHRASE = shared.network.passphrase
const TAB = shared.tab_contract
const READER = shared.vouchers[0]!.reader
const WRITER = shared.vouchers[0]!.writer
const OTHER = seedAddress(41)

const accountValue = (balance: bigint) =>
  xdr.ScVal.scvMap(
    [
      ['balance', nativeToScVal(balance, { type: 'i128' })],
      ['next_key_id', nativeToScVal(1, { type: 'u32' })],
      ['withdraw_unlock', nativeToScVal(0, { type: 'u32' })],
    ].map(
      ([key, val]) =>
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol(key as string),
          val: val as xdr.ScVal,
        })
    )
  )

type Answer = { ledger: number; value: xdr.ScVal }

/** An RPC client that answers each view call from `answers`, in order. */
function fakeRpc(answers: Answer[]) {
  const calls: string[] = []
  const rpc = {
    async simulateTransaction(txXdr: string) {
      expect(typeof txXdr).toBe('string')
      calls.push(txXdr)
      const next = answers.shift()
      if (!next) throw new Error('no answer left')
      return {
        latestLedger: next.ledger,
        retvalXdr: next.value.toXDR('base64'),
      }
    },
  } as unknown as RpcClient
  return { rpc, calls }
}

const chain = { passphrase: PASSPHRASE }
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' })
const pairs = [
  { keyId: 0, writer: WRITER },
  { keyId: 2, writer: OTHER },
]

describe('reconciliation chain read (#573)', () => {
  it('reads the balance and every pair at one ledger', async () => {
    const { rpc, calls } = fakeRpc([
      { ledger: 900, value: accountValue(BigInt(5_000_000)) },
      { ledger: 900, value: i128(BigInt(1_000_000)) },
      { ledger: 900, value: i128(BigInt(600_000)) },
    ])
    expect(await readTabChainState(rpc, chain, TAB, READER, pairs)).toEqual({
      ledger: 900,
      balance: '5000000',
      paid: [
        { keyId: 0, writer: WRITER, paid: '1000000' },
        { keyId: 2, writer: OTHER, paid: '600000' },
      ],
    })
    expect(calls).toHaveLength(3)
  })

  it('reads again when the ledger moved between calls', async () => {
    const { rpc, calls } = fakeRpc([
      { ledger: 900, value: accountValue(BigInt(5_000_000)) },
      { ledger: 901, value: i128(BigInt(1_000_000)) },
      { ledger: 901, value: i128(BigInt(600_000)) },
      { ledger: 902, value: accountValue(BigInt(4_000_000)) },
      { ledger: 902, value: i128(BigInt(2_000_000)) },
      { ledger: 902, value: i128(BigInt(600_000)) },
    ])
    expect(await readTabChainState(rpc, chain, TAB, READER, pairs)).toEqual({
      ledger: 902,
      balance: '4000000',
      paid: [
        { keyId: 0, writer: WRITER, paid: '2000000' },
        { keyId: 2, writer: OTHER, paid: '600000' },
      ],
    })
    expect(calls).toHaveLength(6)
  })

  it('gives up when every read spans ledgers', async () => {
    const answers: Answer[] = []
    for (let i = 0; i < 3; i++) {
      answers.push(
        { ledger: 900 + 2 * i, value: accountValue(BigInt(1)) },
        { ledger: 901 + 2 * i, value: i128(BigInt(0)) }
      )
    }
    const { rpc } = fakeRpc(answers)
    await expect(
      readTabChainState(rpc, chain, TAB, READER, [pairs[0]!])
    ).rejects.toThrow(/chain moved/)
  })

  it('a reader without an account on chain has balance 0', async () => {
    const { rpc } = fakeRpc([
      { ledger: 900, value: xdr.ScVal.scvVoid() },
      { ledger: 900, value: i128(BigInt(1_000_000)) },
    ])
    expect(
      await readTabChainState(rpc, chain, TAB, READER, [pairs[0]!])
    ).toMatchObject({ balance: '0', ledger: 900 })
  })

  it('the reconciliation balance sorts after every event of its ledger and before the next', () => {
    const id = endOfLedgerEventId(7_000_000)
    expect(id).toHaveLength(rpcEventId(7_000_000, 1, 1, 0).length)
    expect(id > rpcEventId(7_000_000, 1, 1, 0)).toBe(true)
    expect(id > rpcEventId(7_000_000, 1_048_575, 4095, 9)).toBe(true)
    expect(id < rpcEventId(7_000_001, 1, 1, 0)).toBe(true)
  })
})

describe('waiting for the indexer before the check (#648)', () => {
  const SNAP = {
    tabAccountId: 'account' as Id<'tabAccounts'>,
    readerAddress: READER,
    tabContractId: TAB,
    digest: 'digest',
    pairs: [{ keyId: 0, writer: WRITER }],
  }
  const read = (ledger: number): ChainRead => ({
    ledger,
    balance: '5',
    paid: [{ keyId: 0, writer: WRITER, paid: '10' }],
  })
  const refused = (
    reason: Extract<ReconcileResult, { status: 'refused' }>['reason']
  ): ReconcileResult => ({ status: 'refused', reason, detail: reason })
  const dryRun = (
    ledger: number
  ): Extract<ReconcileResult, { ledger: number }> => ({
    status: 'dry_run',
    ledger,
    before: {
      confirmedBalance: '15',
      outstanding: '0',
      settledUnindexed: '10',
      spendable: '5',
    },
    after: {
      confirmedBalance: '5',
      outstanding: '0',
      settledUnindexed: '0',
      spendable: '5',
    },
    pairs: [],
  })

  /**
   * Steps with a clock that moves only in `sleep`. `covered(now)` is the
   * indexer's covered ledger; `results` answer the checks in order; reads
   * are at 1000, 1001, 1002 ...
   */
  function fake(o: {
    covered: (now: number) => number | null
    results: ReconcileResult[]
    snapshot?: typeof SNAP | null
  }) {
    let now = 0
    const log = {
      snapshots: 0,
      reads: [] as number[],
      checked: [] as Array<{ ledger: number; covered: number | null }>,
      sleeps: [] as number[],
    }
    const steps: ReconcileSteps = {
      snapshot: async () => {
        log.snapshots++
        return o.snapshot === undefined ? SNAP : o.snapshot
      },
      readChain: async () => {
        const r = read(1000 + log.reads.length)
        log.reads.push(r.ledger)
        return r
      },
      coveredLedger: async () => o.covered(now),
      reconcile: async (_snap, r) => {
        log.checked.push({ ledger: r.ledger, covered: o.covered(now) })
        const next = o.results.shift()
        if (!next) throw new Error('no result left')
        return next
      },
      now: () => now,
      sleep: async (ms) => {
        if (log.sleeps.length > 1000) throw new Error('waited without a limit')
        log.sleeps.push(ms)
        now += ms
      },
    }
    return { steps, log }
  }

  it('checks at once when the indexer has applied the ledger read', async () => {
    const { steps, log } = fake({
      covered: () => 1000,
      results: [dryRun(1000)],
    })
    expect(await reconcileWhenIndexed(steps)).toEqual(dryRun(1000))
    expect(log).toMatchObject({ snapshots: 1, reads: [1000], sleeps: [] })
  })

  it('polls every 5 s until the indexer covers the read, then checks', async () => {
    // The indexer's next run, 40 s later, covers ledger 1008.
    const { steps, log } = fake({
      covered: (now) => (now >= 40_000 ? 1008 : 992),
      results: [dryRun(1000)],
    })
    expect(await reconcileWhenIndexed(steps)).toEqual(dryRun(1000))
    expect(log.sleeps).toEqual(Array(8).fill(INDEXER_POLL_MS))
    expect(log.checked).toEqual([{ ledger: 1000, covered: 1008 }])
  })

  it('stops waiting at the limit and leaves the refusal to the check', async () => {
    const { steps, log } = fake({
      covered: () => 990,
      results: [refused('INDEXER_BEHIND')],
    })
    expect(await reconcileWhenIndexed(steps)).toEqual(refused('INDEXER_BEHIND'))
    expect(log.sleeps.reduce((a, b) => a + b, 0)).toBe(INDEXER_WAIT_MS)
    expect(log.checked).toEqual([{ ledger: 1000, covered: 990 }])
    expect(log.reads).toEqual([1000])
  })

  it('does not wait when the indexer cannot catch up', async () => {
    const { steps, log } = fake({
      covered: () => null,
      results: [refused('INDEXER_BEHIND')],
    })
    expect(await reconcileWhenIndexed(steps)).toEqual(refused('INDEXER_BEHIND'))
    expect(log.sleeps).toEqual([])
  })

  it('after CHANGED or STALE_READ: a new snapshot and a new read, at most three times', async () => {
    for (const reason of ['CHANGED', 'STALE_READ'] as const) {
      const ok = fake({
        covered: () => 2000,
        results: [refused(reason), dryRun(1001)],
      })
      expect(await reconcileWhenIndexed(ok.steps)).toEqual(dryRun(1001))
      expect(ok.log).toMatchObject({ snapshots: 2, reads: [1000, 1001] })

      const busy = fake({
        covered: () => 2000,
        results: Array.from({ length: 5 }, () => refused(reason)),
      })
      expect(await reconcileWhenIndexed(busy.steps)).toEqual(refused(reason))
      expect(busy.log.reads).toHaveLength(RECONCILE_ATTEMPTS)
      expect(busy.log.snapshots).toBe(RECONCILE_ATTEMPTS)
    }
  })

  it('returns every other answer at once', async () => {
    for (const answer of [
      refused('INDEXER_BEHIND'),
      refused('EVENTS_UNHANDLED'),
      refused('MISSING_READ'),
      refused('MISMATCH_PAID'),
      refused('BALANCE_MISMATCH'),
      refused('NOT_FOUND'),
      dryRun(1000),
      { ...dryRun(1000), status: 'applied' as const },
      { ...dryRun(1000), status: 'nothing_to_do' as const },
    ]) {
      const { steps, log } = fake({ covered: () => 2000, results: [answer] })
      expect(await reconcileWhenIndexed(steps)).toEqual(answer)
      expect(log.reads).toEqual([1000])
    }
  })

  it('the wait limit holds for all attempts together', async () => {
    // Behind on every read; the account changes every time.
    const { steps, log } = fake({
      covered: () => 990,
      results: [refused('CHANGED'), refused('CHANGED'), refused('CHANGED')],
    })
    expect(await reconcileWhenIndexed(steps)).toEqual(refused('CHANGED'))
    expect(log.reads).toHaveLength(RECONCILE_ATTEMPTS)
    expect(log.sleeps.reduce((a, b) => a + b, 0)).toBe(INDEXER_WAIT_MS)
  })

  it('NOT_FOUND when the reader has no tab account', async () => {
    const { steps, log } = fake({
      covered: () => 2000,
      results: [],
      snapshot: null,
    })
    expect(await reconcileWhenIndexed(steps)).toMatchObject({
      status: 'refused',
      reason: 'NOT_FOUND',
    })
    expect(log.reads).toEqual([])
  })

  it('the covered ledger is used only while the indexer runs in this epoch', () => {
    const cursor = (
      status: 'OK' | 'LAGGING' | 'BEHIND_RETENTION' | 'RESET_DETECTED',
      chainEpoch = 'e1'
    ) => ({ status, chainEpoch, lastLedger: 1000 })
    expect(coveredLedgerOf(cursor('OK'), 'e1')).toBe(1000)
    expect(coveredLedgerOf(cursor('LAGGING'), 'e1')).toBe(1000)
    expect(coveredLedgerOf(cursor('BEHIND_RETENTION'), 'e1')).toBeNull()
    expect(coveredLedgerOf(cursor('RESET_DETECTED'), 'e1')).toBeNull()
    expect(coveredLedgerOf(cursor('OK', 'e0'), 'e1')).toBeNull()
    expect(coveredLedgerOf(null, 'e1')).toBeNull()
  })
})
