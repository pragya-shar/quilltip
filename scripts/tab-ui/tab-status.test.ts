import { describe, expect, it } from 'vitest'
import {
  WITHDRAW_DELAY_LEDGERS,
  closeUnlockEstimate,
  pauseBlocks,
  settlementHealth,
  tabBalances,
  tabPaused,
  tabShortBy,
  tabStatusView,
} from '../../lib/tab-ui/tab-status'
import type { ChainConfigView, MyTab } from '../../lib/tab-ui/types'

const config = (o: Partial<ChainConfigView> = {}) =>
  ({
    network: 'TESTNET',
    chainEpoch: 'e',
    v2Enabled: true,
    coreContractId: null,
    tabContractId: 'CTAB',
    nftContractId: null,
    tokenContractId: 'CTOKEN',
    minTip: '1',
    feeBps: 250,
    nftThreshold: null,
    paused: {},
    refreshedAt: 0,
    ...o,
  }) as ChainConfigView
const tab = (o: Partial<MyTab> = {}) =>
  ({
    tabContractId: 'CTAB',
    readerAddress: 'G',
    status: 'OPEN',
    confirmedBalance: '100',
    outstanding: '30',
    available: '70',
    acceptedToday: '0',
    acceptedDay: '2026-11-27',
    withdrawUnlockLedger: null,
    onChain: true,
    keys: [],
    pairs: [],
    ...o,
  }) as MyTab
const clock = { sequence: 1_000, closedAt: Date.UTC(2026, 10, 27, 12) }

describe('tabStatusView', () => {
  it('waits for both reads, and reports v2 off before anything else', () => {
    expect(
      tabStatusView({ tab: undefined, chainConfig: config(), clock })
    ).toEqual({ kind: 'loading' })
    expect(tabStatusView({ tab: null, chainConfig: undefined, clock })).toEqual(
      { kind: 'loading' }
    )
    expect(
      tabStatusView({
        tab: null,
        chainConfig: config({ v2Enabled: false }),
        clock,
      })
    ).toEqual({ kind: 'unavailable' })
    expect(
      tabStatusView({
        tab: null,
        chainConfig: config({ tabContractId: null }),
        clock,
      })
    ).toEqual({ kind: 'unavailable' })
    expect(tabStatusView({ tab: null, chainConfig: config(), clock })).toEqual({
      kind: 'none',
    })
    expect(
      tabStatusView({ tab: tab(), chainConfig: config(), clock }).kind
    ).toBe('open')
    // Prepared, with no Tab event indexed yet: no tab to show (#547).
    expect(
      tabStatusView({
        tab: tab({ onChain: false, confirmedBalance: '0', available: '0' }),
        chainConfig: config(),
        clock,
      }).kind
    ).toBe('none')
    expect(
      tabStatusView({
        tab: tab({ status: 'CLOSED' }),
        chainConfig: config(),
        clock,
      }).kind
    ).toBe('closed')
  })
  it('estimates the unlock date from ledgers and says when it has passed', () => {
    const waiting = tabStatusView({
      tab: tab({ status: 'CLOSING', withdrawUnlockLedger: 1_000 + 17_280 }),
      chainConfig: config(),
      clock,
      locale: 'en-GB',
    })
    expect(waiting).toMatchObject({ kind: 'closing', ready: false })
    if (waiting.kind !== 'closing') return
    expect(waiting.unlocksAt?.getTime()).toBe(clock.closedAt + 17_280 * 5_000)
    expect(waiting.unlocksAround).toBe('Saturday 28 November')
    expect(
      tabStatusView({
        tab: tab({ status: 'CLOSING', withdrawUnlockLedger: 999 }),
        chainConfig: config(),
        clock,
      })
    ).toMatchObject({ kind: 'closing', ready: true })
    // Ready at the unlock ledger itself, not one ledger before it.
    const at = (unlock: number) =>
      tabStatusView({
        tab: tab({ status: 'CLOSING', withdrawUnlockLedger: unlock }),
        chainConfig: config(),
        clock,
      })
    expect(at(clock.sequence)).toMatchObject({ ready: true })
    expect(at(clock.sequence + 1)).toMatchObject({ ready: false })
    expect(
      tabStatusView({
        tab: tab({ status: 'CLOSING', withdrawUnlockLedger: 999 }),
        chainConfig: config(),
        clock: null,
      })
    ).toMatchObject({ kind: 'closing', ready: false, unlocksAround: null })
  })

  it('says "soon" once the estimate has passed and the ledger has not (#671)', () => {
    const view = (unlock: number, now: number, at = clock) =>
      tabStatusView({
        tab: tab({ status: 'CLOSING', withdrawUnlockLedger: unlock }),
        chainConfig: config(),
        clock: at,
        now,
      })
    const unlock = clock.sequence + 100
    const estimate = clock.closedAt + 100 * 5_000
    // Before the estimate: a date, not overdue.
    expect(view(unlock, estimate - 1)).toMatchObject({
      ready: false,
      overdue: false,
    })
    // A clock past the estimate, a ledger below the unlock: overdue.
    expect(view(unlock, estimate + 1)).toMatchObject({
      ready: false,
      overdue: true,
    })
    // An old clock read: the estimated day is in the past.
    expect(
      view(unlock, clock.closedAt + 3 * 86_400_000, {
        sequence: clock.sequence,
        closedAt: clock.closedAt,
      })
    ).toMatchObject({ ready: false, overdue: true })
    // Once the ledger is reached it is ready, never overdue.
    expect(view(clock.sequence, estimate + 86_400_000)).toMatchObject({
      ready: true,
      overdue: false,
    })
    // No clock: no estimate, so nothing is overdue.
    expect(
      tabStatusView({
        tab: tab({ status: 'CLOSING', withdrawUnlockLedger: unlock }),
        chainConfig: config(),
        clock: null,
        now: estimate + 86_400_000,
      })
    ).toMatchObject({ overdue: false, unlocksAround: null })
  })
})

describe('closeUnlockEstimate', () => {
  it('is 3 days of ledgers from the latest ledger', () => {
    expect(closeUnlockEstimate(clock, 'en-GB')).toEqual({
      at: new Date(clock.closedAt + WITHDRAW_DELAY_LEDGERS * 5_000),
      day: 'Monday 30 November',
    })
    expect(closeUnlockEstimate(null)).toBeNull()
  })
})

describe('tabBalances', () => {
  it('shows confirmed, settling and free, never a negative free amount', () => {
    expect(tabBalances(tab())).toEqual({
      confirmed: '100',
      committed: '30',
      free: '70',
    })
    expect(tabBalances(tab({ available: '-5' })).free).toBe('0')
  })
})

describe('tabShortBy (#617)', () => {
  it('is how far tips still settling exceed the balance, or null', () => {
    expect(tabShortBy({ available: '-3000000' })).toBe('3000000')
    expect(tabShortBy({ available: '0' })).toBeNull()
    expect(tabShortBy({ available: '70' })).toBeNull()
  })
})

describe('settlementHealth', () => {
  const now = Date.UTC(2026, 10, 27, 12)
  const hour = 3_600_000
  it('is ok during normal settlement and delayed past 8 hours', () => {
    expect(settlementHealth(null, now)).toEqual({ kind: 'ok' })
    const base = { settlementEnabled: true, settleWindowEndsSoon: false }
    expect(
      settlementHealth({ ...base, oldestUnsettledAt: now - 7 * hour }, now)
    ).toEqual({ kind: 'ok' })
    expect(
      settlementHealth({ ...base, oldestUnsettledAt: now - 9 * hour }, now)
    ).toEqual({ kind: 'delayed' })
    expect(
      settlementHealth(
        { ...base, oldestUnsettledAt: now - hour, settleWindowEndsSoon: true },
        now
      )
    ).toEqual({ kind: 'delayed' })
    expect(
      settlementHealth(
        { ...base, oldestUnsettledAt: null, settleWindowEndsSoon: true },
        now
      )
    ).toEqual({ kind: 'ok' })
  })
  it('reports settlement off whenever it is off, with or without a tab', () => {
    const off = { settlementEnabled: false, settleWindowEndsSoon: false }
    expect(
      settlementHealth({ ...off, oldestUnsettledAt: now - hour }, now)
    ).toEqual({ kind: 'off', waiting: true })
    expect(settlementHealth({ ...off, oldestUnsettledAt: null }, now)).toEqual({
      kind: 'off',
      waiting: false,
    })
    // No tab, so no activity: the flag alone decides.
    expect(
      settlementHealth(null, now, { settlementEnabled: false, tabReady: false })
    ).toEqual({
      kind: 'off',
      waiting: false,
    })
    // The flag wins over a stale activity value.
    expect(
      settlementHealth(
        { ...off, settlementEnabled: true, oldestUnsettledAt: null },
        now,
        { settlementEnabled: false, tabReady: false }
      )
    ).toEqual({ kind: 'off', waiting: false })
    expect(
      settlementHealth(null, now, { settlementEnabled: true, tabReady: true })
    ).toEqual({
      kind: 'ok',
    })
  })
})

describe('pause', () => {
  it('blocks only what adds funds or keys (I-27)', () => {
    expect(
      ['tab-open', 'tab-top-up', 'tab-new-key'].every((f) =>
        pauseBlocks(f as never)
      )
    ).toBe(true)
    expect(
      ['tab-revoke-key', 'tab-close', 'tab-withdraw', 'collect'].some((f) =>
        pauseBlocks(f as never)
      )
    ).toBe(false)
    expect(tabPaused(config({ paused: { tab: true } }))).toBe(true)
    expect(tabPaused(config({ paused: { core: true } }))).toBe(false)
    expect(tabPaused(undefined)).toBe(false)
  })
})
