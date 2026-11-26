import { describe, expect, it } from 'vitest'
import {
  WITHDRAW_DELAY_LEDGERS,
  closeUnlockEstimate,
  pauseBlocks,
  settlementHealth,
  tabBalances,
  tabPaused,
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
    expect(
      tabStatusView({
        tab: tab({ status: 'CLOSING', withdrawUnlockLedger: 999 }),
        chainConfig: config(),
        clock: null,
      })
    ).toMatchObject({ kind: 'closing', ready: false, unlocksAround: null })
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
  it('reports settlement off only while tips wait', () => {
    const off = { settlementEnabled: false, settleWindowEndsSoon: false }
    expect(
      settlementHealth({ ...off, oldestUnsettledAt: now - hour }, now)
    ).toEqual({ kind: 'off' })
    expect(settlementHealth({ ...off, oldestUnsettledAt: null }, now)).toEqual({
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
