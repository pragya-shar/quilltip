import { describe, expect, it } from 'vitest'

import {
  commitAcceptedTip,
  createLocalLedger,
  createSessionKeyStore,
  signTabTip,
  type LocalLedger,
  type PreparedTabTip,
  type SignTabTipDeps,
} from '../../lib/stellar/v2/tab'
import {
  FakeTabServer,
  READER,
  SCOPE,
  WRITER_C,
  WRITER_G,
  depsFor,
  freshDb,
} from './helpers'

async function setup(forceFallback = false) {
  const db = freshDb()
  const keys = createSessionKeyStore({ ...db, forceFallback })
  const key = await keys.generate(SCOPE)
  await keys.bindKeyIds(SCOPE, [{ keyId: 0, publicKey: key.info.publicKey }])
  const deps = depsFor(db, { keys })
  const server = new FakeTabServer(new Map([[0, key.info.publicKey]]))
  return { db, deps, key, keys, server }
}

async function tip(
  server: FakeTabServer,
  deps: SignTabTipDeps,
  writer: string,
  amount: number
) {
  const prepared = server.prepare({ keyId: 0, writer, amount: BigInt(amount) })
  const result = await signTabTip(prepared, deps)
  if (result.kind !== 'signed') throw new Error(`not signed: ${result.kind}`)
  const accepted = server.submit(result.submit)
  await commitAcceptedTip(accepted, deps)
  return { prepared, result, accepted }
}

describe('signTabTip: sequences', () => {
  for (const forceFallback of [false, true]) {
    it(`many receipts to two writers (${forceFallback ? 'fallback' : 'WebCrypto'} key)`, async () => {
      const { deps, server } = await setup(forceFallback)
      let g = 0
      let c = 0
      for (let i = 1; i <= 12; i++) {
        const writer = i % 3 === 0 ? WRITER_C : WRITER_G
        const { accepted } = await tip(server, deps, writer, i * 1000)
        if (writer === WRITER_G) g += i * 1000
        else c += i * 1000
        expect(accepted.voucher.cumulative).toBe(
          String(writer === WRITER_G ? g : c)
        )
      }
      const ledgerG = await deps.ledger.read(SCOPE, 0, WRITER_G)
      const ledgerC = await deps.ledger.read(SCOPE, 0, WRITER_C)
      expect(ledgerG?.committed).toMatchObject({
        seq: 8,
        cumulative: String(g),
      })
      expect(ledgerC?.committed).toMatchObject({
        seq: 4,
        cumulative: String(c),
      })
      expect(ledgerG?.committed?.leafHashes).toEqual(
        server.pairs.get(`0|${WRITER_G}`)?.leaves
      )
    })
  }

  it('a highlight receipt signs like any other', async () => {
    const { deps, server } = await setup()
    const prepared = server.prepare({
      keyId: 0,
      writer: WRITER_G,
      amount: BigInt(5),
      highlightId: '33'.repeat(32),
    })
    const result = await signTabTip(prepared, deps)
    expect(result.kind).toBe('signed')
    if (result.kind === 'signed')
      expect(server.submit(result.submit).receipt.highlightId).toBe(
        '33'.repeat(32)
      )
  })
})

describe('signTabTip: prepare checks (no key marking)', () => {
  const cases: [string, (p: PreparedTabTip) => PreparedTabTip, string][] = [
    ['wrong_tab', (p) => ({ ...p, tabContractId: 'C'.padEnd(56, 'A') }), ''],
    ['wrong_reader', (p) => ({ ...p, readerAddress: WRITER_G }), ''],
    ['malformed', (p) => ({ ...p, writer: 'GNOPE' }), 'writer'],
    ['malformed', (p) => ({ ...p, keyId: -1 }), 'keyId'],
    ['malformed', (p) => ({ ...p, leafHashes: ['zz'], seq: 2 }), 'leaves'],
    ['malformed', (p) => ({ ...p, seq: 0, leafHashes: [] }), 'seq'],
    ['malformed', (p) => ({ ...p, amount: '0' }), 'zero'],
    ['malformed', (p) => ({ ...p, amount: '-5' }), 'negative'],
    [
      'malformed',
      (p) => ({ ...p, receipt: { ...p.receipt, articleId: 'ab' } }),
      'articleId',
    ],
    ['inconsistent', (p) => ({ ...p, seq: 2 }), 'seq vs leaves'],
    [
      'inconsistent',
      (p) => ({ ...p, receipt: { ...p.receipt, cumulativeAfter: '999' } }),
      'cumulativeAfter',
    ],
    [
      'inconsistent',
      (p) => ({ ...p, receipt: { ...p.receipt, amount: '7' } }),
      'receipt amount',
    ],
    [
      'pair_full',
      (p) => ({
        ...p,
        seq: 257,
        leafHashes: Array.from({ length: 256 }, () => '44'.repeat(32)),
      }),
      '',
    ],
    ['expired', (p) => ({ ...p, expiresAt: 1_000 }), ''],
  ]
  for (const [reason, mutate, label] of cases) {
    it(`${reason}${label ? ` (${label})` : ''}`, async () => {
      const { deps, server, keys } = await setup()
      const prepared = mutate(
        server.prepare({ keyId: 0, writer: WRITER_G, amount: BigInt(10) })
      )
      const result = await signTabTip(prepared, deps)
      expect(result).toMatchObject({ kind: 'stop', reason })
      expect((await keys.get(SCOPE, 0))?.info.unusable).toBeNull()
    })
  }

  it('above_limit with maxAmount', async () => {
    const { deps, server } = await setup()
    const prepared = server.prepare({
      keyId: 0,
      writer: WRITER_G,
      amount: BigInt(51),
    })
    expect(
      await signTabTip(prepared, { ...deps, maxAmount: BigInt(50) })
    ).toMatchObject({ kind: 'stop', reason: 'above_limit' })
  })
})

describe('signTabTip: keys', () => {
  it('key_missing when this browser lacks the key (eviction)', async () => {
    const { server } = await setup()
    const emptyBrowser = depsFor(freshDb())
    const prepared = server.prepare({
      keyId: 0,
      writer: WRITER_G,
      amount: BigInt(10),
    })
    expect(await signTabTip(prepared, emptyBrowser)).toMatchObject({
      kind: 'stop',
      reason: 'key_missing',
      message: "This device's quick-tip key is gone.",
    })
  })

  it('key_unusable after the key was stopped', async () => {
    const { deps, server, key, keys } = await setup()
    await keys.markUnusable(SCOPE, key.info.publicKey, 'ledger_mismatch')
    const prepared = server.prepare({
      keyId: 0,
      writer: WRITER_G,
      amount: BigInt(10),
    })
    expect(await signTabTip(prepared, deps)).toMatchObject({
      kind: 'stop',
      reason: 'key_unusable',
    })
  })
})

describe('signTabTip: the ledger rule', () => {
  it('mismatch: retry_prepare, then stop and mark the key unusable', async () => {
    const { deps, server, keys } = await setup()
    await tip(server, deps, WRITER_G, 10)
    // Convex now claims a higher cumulative than this browser signed.
    server.pairs.get(`0|${WRITER_G}`)!.cumulative = BigInt(500)
    const first = await signTabTip(
      server.prepare({ keyId: 0, writer: WRITER_G, amount: BigInt(1) }),
      deps
    )
    expect(first).toEqual({
      kind: 'retry_prepare',
      reason: 'cumulative_mismatch',
    })
    expect((await keys.get(SCOPE, 0))?.info.unusable).toBeNull()
    const second = await signTabTip(
      server.prepare({ keyId: 0, writer: WRITER_G, amount: BigInt(1) }),
      deps
    )
    expect(second).toMatchObject({ kind: 'stop', reason: 'ledger_mismatch' })
    expect((await keys.get(SCOPE, 0))?.info.unusable?.reason).toBe(
      'ledger_mismatch'
    )
    // Every later tip with this key stops, whatever the writer.
    expect(
      await signTabTip(
        server.prepare({ keyId: 0, writer: WRITER_C, amount: BigInt(1) }),
        deps
      )
    ).toMatchObject({ kind: 'stop', reason: 'key_unusable' })
  })

  it('a rewritten leaf list is a mismatch even with the right cumulative', async () => {
    const { deps, server } = await setup()
    await tip(server, deps, WRITER_G, 10)
    server.pairs.get(`0|${WRITER_G}`)!.leaves = ['55'.repeat(32)]
    expect(
      await signTabTip(
        server.prepare({ keyId: 0, writer: WRITER_G, amount: BigInt(1) }),
        deps
      )
    ).toMatchObject({ kind: 'retry_prepare', reason: 'leaf_mismatch' })
  })

  it('no local record: a non-zero server pair is a mismatch', async () => {
    const { deps, server } = await setup()
    server.pairs.set(`0|${WRITER_G}`, {
      leaves: ['66'.repeat(32)],
      cumulative: BigInt(10),
      seq: 1,
    })
    expect(
      await signTabTip(
        server.prepare({ keyId: 0, writer: WRITER_G, amount: BigInt(1) }),
        deps
      )
    ).toMatchObject({ kind: 'retry_prepare', reason: 'unknown_leaf' })
  })

  it('a match after the retry clears the first mismatch', async () => {
    const { deps, server, keys } = await setup()
    await tip(server, deps, WRITER_G, 10)
    const pair = server.pairs.get(`0|${WRITER_G}`)!
    pair.cumulative = BigInt(500)
    expect(
      (
        await signTabTip(
          server.prepare({ keyId: 0, writer: WRITER_G, amount: BigInt(1) }),
          deps
        )
      ).kind
    ).toBe('retry_prepare')
    pair.cumulative = BigInt(10)
    await tip(server, deps, WRITER_G, 2)
    expect((await deps.ledger.read(SCOPE, 0, WRITER_G))?.mismatchAt).toBeNull()
    expect((await keys.get(SCOPE, 0))?.info.unusable).toBeNull()
  })

  it('another tab commits after the check: the write-ahead refuses', async () => {
    const { deps, server } = await setup()
    await tip(server, deps, WRITER_G, 10)
    const prepared = server.prepare({
      keyId: 0,
      writer: WRITER_G,
      amount: BigInt(1),
    })
    const real = deps.ledger
    let reads = 0
    const otherTabLands: LocalLedger = {
      ...real,
      read: async (scope, keyId, writer) => {
        reads += 1
        const record = await real.read(scope, keyId, writer)
        // The other tab's tip is accepted and committed right after this read.
        await tip(server, deps, WRITER_G, 5)
        return record
      },
    }
    // The check passes on the stale read; the compare-and-set catches it.
    expect(
      await signTabTip(prepared, { ...deps, ledger: otherTabLands })
    ).toEqual({ kind: 'retry_prepare', reason: 'concurrent_update' })
    expect(reads).toBe(1)
    expect((await real.read(SCOPE, 0, WRITER_G))?.committed?.cumulative).toBe(
      '15'
    )
  })

  it('re-read that matches proceeds', async () => {
    const { deps, server } = await setup()
    await tip(server, deps, WRITER_G, 10)
    const real = deps.ledger
    let reads = 0
    const lagging: LocalLedger = {
      ...real,
      read: async (scope, keyId, writer) => {
        reads += 1
        return reads === 1 ? null : real.read(scope, keyId, writer)
      },
    }
    const result = await signTabTip(
      server.prepare({ keyId: 0, writer: WRITER_G, amount: BigInt(1) }),
      { ...deps, ledger: lagging }
    )
    expect(result.kind).toBe('signed')
    expect(reads).toBe(2)
  })

  it('a lost submit response: the next prepare promotes the signed entry', async () => {
    const { deps, server } = await setup()
    await tip(server, deps, WRITER_G, 10)
    const prepared = server.prepare({
      keyId: 0,
      writer: WRITER_G,
      amount: BigInt(7),
    })
    const signed = await signTabTip(prepared, deps)
    if (signed.kind !== 'signed') throw new Error('not signed')
    server.submit(signed.submit) // accepted; the response never arrives
    const { accepted } = await tip(server, deps, WRITER_G, 3)
    expect(accepted.voucher.cumulative).toBe('20')
    expect(
      (await deps.ledger.read(SCOPE, 0, WRITER_G))?.committed
    ).toMatchObject({ seq: 3, cumulative: '20' })
  })

  it('resubmitting the same prepared tip reuses the signature', async () => {
    const { deps, server } = await setup()
    const prepared = server.prepare({
      keyId: 0,
      writer: WRITER_G,
      amount: BigInt(9),
    })
    const first = await signTabTip(prepared, deps)
    if (first.kind !== 'signed') throw new Error('not signed')
    const accepted = server.submit(first.submit)
    await commitAcceptedTip(accepted, deps)
    // The UI lost track and prepares with the same requestId again.
    const again = await signTabTip(
      server.prepareAgain(prepared.prepareId),
      deps
    )
    expect(again).toMatchObject({ kind: 'signed', replay: true })
    if (again.kind !== 'signed') return
    expect(again.submit).toEqual(first.submit)
    expect(server.submit(again.submit).alreadyAccepted).toBe(true)
    expect((await commitAcceptedTip(accepted, deps)).status).toBe(
      'already_committed'
    )
  })

  it('two tabs sign the same seq: one is accepted, the loser re-prepares', async () => {
    const { db, deps, server, keys } = await setup()
    const tabB = {
      ...deps,
      keys: createSessionKeyStore(db),
      ledger: createLocalLedger(db),
    }
    const pa = server.prepare({ keyId: 0, writer: WRITER_G, amount: BigInt(4) })
    const pb = server.prepare({ keyId: 0, writer: WRITER_G, amount: BigInt(6) })
    const [ra, rb] = await Promise.all([
      signTabTip(pa, deps),
      signTabTip(pb, tabB),
    ])
    if (ra.kind !== 'signed' || rb.kind !== 'signed') throw new Error('x')
    const accepted = server.submit(rb.submit)
    expect(() => server.submit(ra.submit)).toThrow('TAB_STALE_PREPARE')
    await commitAcceptedTip(accepted, tabB)
    // Tab A's next tip builds on tab B's accepted one.
    const { accepted: next } = await tip(server, deps, WRITER_G, 1)
    expect(next.voucher.cumulative).toBe('7')
    expect((await keys.get(SCOPE, 0))?.info.unusable).toBeNull()
  })

  it('concurrent_update when the pair moved between check and write', async () => {
    const { deps, server } = await setup()
    const real = deps.ledger
    const racing: LocalLedger = {
      ...real,
      recordPending: async () => false,
    }
    expect(
      await signTabTip(
        server.prepare({ keyId: 0, writer: WRITER_G, amount: BigInt(1) }),
        { ...deps, ledger: racing }
      )
    ).toEqual({ kind: 'retry_prepare', reason: 'concurrent_update' })
  })

  it('commitAcceptedTip refuses another tab contract or reader', async () => {
    const { deps, server } = await setup()
    const { accepted } = await tip(server, deps, WRITER_G, 1)
    await expect(
      commitAcceptedTip(
        { ...accepted, voucher: { ...accepted.voucher, reader: WRITER_G } },
        deps
      )
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(READER).not.toBe(WRITER_G)
  })
})
