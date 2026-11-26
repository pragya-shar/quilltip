import { describe, expect, it } from 'vitest'

import {
  createLocalLedger,
  decideStepTwo,
  matchLedger,
  type LedgerRecord,
  type SignedEntry,
} from '../../lib/stellar/v2/tab'
import { SCOPE, WRITER_C, WRITER_G, freshDb } from './helpers'

const L = (n: number) => n.toString(16).padStart(2, '0').repeat(32)

function entry(
  seq: number,
  leaf: string,
  cumulativeAfter: string
): SignedEntry {
  return {
    seq,
    cumulativeAfter,
    leafHash: leaf,
    prepareId: `p${seq}`,
    signature: 'ee'.repeat(64),
    createdAt: 1,
  }
}

function record(partial: Partial<LedgerRecord>): LedgerRecord {
  return {
    tab: SCOPE.tabContractId,
    reader: SCOPE.readerAddress,
    keyId: 0,
    writer: WRITER_G,
    committed: null,
    signed: [],
    mismatchAt: null,
    updatedAt: 0,
    ...partial,
  }
}

const committed2 = record({
  committed: { seq: 2, cumulative: '30', leafHashes: [L(1), L(2)] },
})

describe('matchLedger', () => {
  it('no local record: the server must be at 0 with no leaves', () => {
    expect(
      matchLedger(null, { cumulativeBefore: '0', leafHashes: [] })
    ).toEqual({
      ok: true,
      state: { seq: 0, cumulative: '0', leafHashes: [] },
      promoted: [],
    })
    expect(
      matchLedger(null, { cumulativeBefore: '5', leafHashes: [] })
    ).toEqual({
      ok: false,
      reason: 'cumulative_mismatch',
    })
    expect(
      matchLedger(null, { cumulativeBefore: '5', leafHashes: [L(1)] })
    ).toEqual({ ok: false, reason: 'unknown_leaf' })
  })

  it('a local record: cumulative and leaves must equal it', () => {
    expect(
      matchLedger(committed2, {
        cumulativeBefore: '30',
        leafHashes: [L(1), L(2).toUpperCase()],
      }).ok
    ).toBe(true)
    expect(
      matchLedger(committed2, {
        cumulativeBefore: '31',
        leafHashes: [L(1), L(2)],
      })
    ).toEqual({ ok: false, reason: 'cumulative_mismatch' })
    expect(
      matchLedger(committed2, {
        cumulativeBefore: '30',
        leafHashes: [L(1), L(9)],
      })
    ).toEqual({ ok: false, reason: 'leaf_mismatch' })
    expect(
      matchLedger(committed2, { cumulativeBefore: '10', leafHashes: [L(1)] })
    ).toEqual({ ok: false, reason: 'server_behind' })
    expect(
      matchLedger(committed2, {
        cumulativeBefore: '40',
        leafHashes: [L(1), L(2), L(3)],
      })
    ).toEqual({ ok: false, reason: 'unknown_leaf' })
    expect(
      matchLedger(committed2, {
        cumulativeBefore: 'x',
        leafHashes: [L(1), L(2)],
      })
    ).toEqual({ ok: false, reason: 'cumulative_mismatch' })
  })

  it('promotes entries signed here that the server shows as accepted', () => {
    const local = {
      ...committed2,
      signed: [
        entry(3, L(3), '45'),
        entry(3, L(7), '99'),
        entry(4, L(4), '50'),
      ],
    }
    const m = matchLedger(local, {
      cumulativeBefore: '50',
      leafHashes: [L(1), L(2), L(3), L(4)],
    })
    expect(m).toEqual({
      ok: true,
      state: { seq: 4, cumulative: '50', leafHashes: [L(1), L(2), L(3), L(4)] },
      promoted: [local.signed[0], local.signed[2]],
    })
    // A signed leaf with the wrong cumulative still fails.
    expect(
      matchLedger(local, {
        cumulativeBefore: '46',
        leafHashes: [L(1), L(2), L(3)],
      })
    ).toEqual({ ok: false, reason: 'cumulative_mismatch' })
  })
})

describe('decideStepTwo (spec 5.6 step 2)', () => {
  const server = { cumulativeBefore: '30', leafHashes: [L(1), L(2)] }
  const wrong = { cumulativeBefore: '99', leafHashes: [L(1), L(2)] }

  it('proceeds when the first read matches', () => {
    expect(decideStepTwo({ server, first: committed2 }).action).toBe('proceed')
  })
  it('asks for one re-read on a mismatch', () => {
    expect(decideStepTwo({ server: wrong, first: committed2 })).toEqual({
      action: 'reread',
    })
  })
  it('proceeds when the re-read matches (another tab wrote)', () => {
    const behind = record({
      committed: { seq: 1, cumulative: '10', leafHashes: [L(1)] },
    })
    expect(
      decideStepTwo({ server, first: behind, reread: committed2 }).action
    ).toBe('proceed')
  })
  it('retry_prepare on a first persistent mismatch', () => {
    expect(
      decideStepTwo({ server: wrong, first: committed2, reread: committed2 })
    ).toEqual({ action: 'retry_prepare', reason: 'cumulative_mismatch' })
  })
  it('stop on a second mismatch', () => {
    const flagged = { ...committed2, mismatchAt: 5 }
    expect(
      decideStepTwo({ server: wrong, first: flagged, reread: flagged })
    ).toEqual({ action: 'stop', reason: 'cumulative_mismatch' })
  })
  it('no record and a non-empty server: retry, then stop', () => {
    const s = { cumulativeBefore: '10', leafHashes: [L(1)] }
    expect(decideStepTwo({ server: s, first: null, reread: null }).action).toBe(
      'retry_prepare'
    )
    const flagged = record({ mismatchAt: 1 })
    expect(
      decideStepTwo({ server: s, first: flagged, reread: flagged }).action
    ).toBe('stop')
  })
})

describe('the IndexedDB ledger', () => {
  const server0 = { cumulativeBefore: '0', leafHashes: [] }

  it('records pending, commits, and repeats safely', async () => {
    const ledger = createLocalLedger({ ...freshDb(), now: () => 3 })
    expect(await ledger.read(SCOPE, 0, WRITER_G)).toBeNull()
    expect(
      await ledger.recordPending(
        SCOPE,
        0,
        WRITER_G,
        server0,
        entry(1, L(1), '10')
      )
    ).toBe(true)
    const pending = await ledger.read(SCOPE, 0, WRITER_G)
    expect(pending?.committed).toBeNull()
    expect(pending?.signed).toHaveLength(1)
    const accepted = {
      keyId: 0,
      writer: WRITER_G,
      cumulative: '10',
      leafHashes: [L(1)],
    }
    expect(await ledger.commitAccepted(SCOPE, accepted)).toEqual({
      status: 'committed',
      state: { seq: 1, cumulative: '10', leafHashes: [L(1)] },
    })
    expect((await ledger.commitAccepted(SCOPE, accepted)).status).toBe(
      'already_committed'
    )
    // Writers are separate pairs.
    expect(await ledger.read(SCOPE, 0, WRITER_C)).toBeNull()
    expect((await ledger.list(SCOPE, 0)).map((r) => r.writer)).toEqual([
      WRITER_G,
    ])
  })

  it('refuses an acceptance that does not extend what was signed here', async () => {
    const ledger = createLocalLedger(freshDb())
    await expect(
      ledger.commitAccepted(SCOPE, {
        keyId: 0,
        writer: WRITER_G,
        cumulative: '10',
        leafHashes: [L(1)],
      })
    ).rejects.toMatchObject({ code: 'LEDGER_CONFLICT' })
    await ledger.recordPending(
      SCOPE,
      0,
      WRITER_G,
      server0,
      entry(1, L(1), '10')
    )
    await expect(
      ledger.commitAccepted(SCOPE, {
        keyId: 0,
        writer: WRITER_G,
        cumulative: '11',
        leafHashes: [L(1)],
      })
    ).rejects.toMatchObject({ code: 'LEDGER_CONFLICT' })
    await ledger.commitAccepted(SCOPE, {
      keyId: 0,
      writer: WRITER_G,
      cumulative: '10',
      leafHashes: [L(1)],
    })
    await expect(
      ledger.commitAccepted(SCOPE, {
        keyId: 0,
        writer: WRITER_G,
        cumulative: '12',
        leafHashes: [L(1)],
      })
    ).rejects.toMatchObject({ code: 'LEDGER_CONFLICT' })
    await expect(
      ledger.commitAccepted(SCOPE, {
        keyId: 0,
        writer: WRITER_G,
        cumulative: '10',
        leafHashes: [],
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('recordPending is a compare-and-set against the checked state', async () => {
    const ledger = createLocalLedger(freshDb())
    await ledger.recordPending(
      SCOPE,
      0,
      WRITER_G,
      server0,
      entry(1, L(1), '10')
    )
    await ledger.commitAccepted(SCOPE, {
      keyId: 0,
      writer: WRITER_G,
      cumulative: '10',
      leafHashes: [L(1)],
    })
    // A stale check (server at 0) no longer matches the ledger: nothing written.
    expect(
      await ledger.recordPending(
        SCOPE,
        0,
        WRITER_G,
        server0,
        entry(1, L(5), '3')
      )
    ).toBe(false)
    expect((await ledger.read(SCOPE, 0, WRITER_G))?.signed).toHaveLength(1)
  })

  it('keeps the most recent 16 signed entries and clears the mismatch flag', async () => {
    const ledger = createLocalLedger(freshDb())
    await ledger.markMismatch(SCOPE, 0, WRITER_G)
    expect((await ledger.read(SCOPE, 0, WRITER_G))?.mismatchAt).not.toBeNull()
    for (let i = 0; i < 20; i++)
      await ledger.recordPending(
        SCOPE,
        0,
        WRITER_G,
        server0,
        entry(1, L(i + 1), String(i + 1))
      )
    const r = await ledger.read(SCOPE, 0, WRITER_G)
    expect(r?.mismatchAt).toBeNull()
    expect(r?.signed).toHaveLength(16)
    expect(r?.signed[0]?.leafHash).toBe(L(5))
  })

  it('concurrent commits from two browser tabs: one commits, the other sees it', async () => {
    const db = freshDb()
    const tabA = createLocalLedger(db)
    const tabB = createLocalLedger(db)
    await tabA.recordPending(SCOPE, 0, WRITER_G, server0, entry(1, L(1), '10'))
    const accepted = {
      keyId: 0,
      writer: WRITER_G,
      cumulative: '10',
      leafHashes: [L(1)],
    }
    const results = await Promise.all([
      tabA.commitAccepted(SCOPE, accepted),
      tabB.commitAccepted(SCOPE, accepted),
      tabA.commitAccepted(SCOPE, accepted),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([
      'already_committed',
      'already_committed',
      'committed',
    ])
  })

  it('concurrent appends of consecutive tips from two tabs keep every leaf', async () => {
    const db = freshDb()
    const tabs = [createLocalLedger(db), createLocalLedger(db)]
    // Both tips were signed (pending) before either acceptance arrives.
    await tabs[0]!.recordPending(
      SCOPE,
      0,
      WRITER_G,
      server0,
      entry(1, L(1), '10')
    )
    await tabs[1]!.recordPending(
      SCOPE,
      0,
      WRITER_G,
      { cumulativeBefore: '10', leafHashes: [L(1)] },
      entry(2, L(2), '25')
    )
    // The second acceptance lands first; it carries both leaves.
    const [second, first] = await Promise.all([
      tabs[1]!.commitAccepted(SCOPE, {
        keyId: 0,
        writer: WRITER_G,
        cumulative: '25',
        leafHashes: [L(1), L(2)],
      }),
      tabs[0]!.commitAccepted(SCOPE, {
        keyId: 0,
        writer: WRITER_G,
        cumulative: '10',
        leafHashes: [L(1)],
      }),
    ])
    expect([second.status, first.status].sort()).toEqual([
      'already_committed',
      'committed',
    ])
    expect((await tabs[0]!.read(SCOPE, 0, WRITER_G))?.committed).toEqual({
      seq: 2,
      cumulative: '25',
      leafHashes: [L(1), L(2)],
    })
  })

  it('validates its inputs', async () => {
    const ledger = createLocalLedger(freshDb())
    await expect(ledger.read(SCOPE, -1, WRITER_G)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(ledger.read(SCOPE, 0, 'nope')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(
      ledger.recordPending(SCOPE, 0, WRITER_G, server0, {
        ...entry(1, 'zz', '1'),
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})
