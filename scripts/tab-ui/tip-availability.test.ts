import { describe, expect, it } from 'vitest'
import {
  tabTipAvailability,
  type AvailabilityInput,
} from '../../lib/tab-ui/tip-availability'
import type { MyTab } from '../../lib/tab-ui/types'

const tab = { available: '700', status: 'OPEN' } as MyTab
const base: AvailabilityInput = {
  status: { kind: 'open' },
  access: { gate: { kind: 'ready' }, address: 'GREADER' },
  device: { kind: 'ready', keyId: 4, renewSoon: false },
  tab,
  settlement: { settlementEnabled: true },
  recipientCount: 1,
}

describe('tabTipAvailability', () => {
  it('is ready with the key and the free balance', () => {
    expect(tabTipAvailability(base)).toEqual({
      kind: 'ready',
      keyId: 4,
      free: '700',
    })
  })
  it('needs no connected wallet, only a verified address', () => {
    expect(
      tabTipAvailability({
        ...base,
        access: { gate: { kind: 'disconnected' }, address: 'GREADER' },
      }).kind
    ).toBe('ready')
    expect(
      tabTipAvailability({
        ...base,
        access: { gate: { kind: 'disconnected' }, address: null },
      })
    ).toEqual({ kind: 'gate', gate: { kind: 'unverified' } })
    expect(
      tabTipAvailability({
        ...base,
        access: { gate: { kind: 'signed-out' }, address: null },
      })
    ).toEqual({ kind: 'gate', gate: { kind: 'signed-out' } })
  })
  it('reports a tab whose tips still settling exceed its balance (#617)', () => {
    const short = { ...base, tab: { ...tab, available: '-300' } }
    expect(tabTipAvailability(short)).toEqual({
      kind: 'tab-short',
      short: '300',
    })
    // Whatever this device holds: no quick tip is accepted until a top-up.
    expect(tabTipAvailability({ ...short, device: undefined })).toEqual({
      kind: 'tab-short',
      short: '300',
    })
    expect(
      tabTipAvailability({ ...short, device: { kind: 'gone', keyId: 1 } }).kind
    ).toBe('tab-short')
    // Closing and no tab still come first; nothing free is still ready.
    expect(
      tabTipAvailability({
        ...short,
        status: {
          kind: 'closing',
          unlockLedger: 1,
          ready: false,
          unlocksAround: null,
          unlocksAt: null,
        },
      }).kind
    ).toBe('tab-closing')
    expect(
      tabTipAvailability({ ...base, tab: { ...tab, available: '0' } })
    ).toEqual({ kind: 'ready', keyId: 4, free: '0' })
  })
  it('refuses articles with co-author splits first', () => {
    expect(
      tabTipAvailability({
        ...base,
        recipientCount: 2,
        status: { kind: 'unavailable' },
      })
    ).toEqual({ kind: 'splits' })
  })
  it('reports v2 off, settlement off, no tab, closing and key states', () => {
    expect(
      tabTipAvailability({ ...base, status: { kind: 'unavailable' } }).kind
    ).toBe('unavailable')
    const off = { ...base, settlement: { settlementEnabled: false } }
    expect(tabTipAvailability(off).kind).toBe('settlement-off')
    // Off is stated before a reader has a tab, too.
    expect(
      tabTipAvailability({ ...off, status: { kind: 'none' }, tab: null }).kind
    ).toBe('settlement-off')
    expect(tabTipAvailability({ ...base, settlement: undefined }).kind).toBe(
      'loading'
    )
    expect(
      tabTipAvailability({ ...base, device: { kind: 'unchecked', keyId: 4 } })
    ).toEqual({ kind: 'key', device: { kind: 'unchecked', keyId: 4 } })
    expect(
      tabTipAvailability({ ...base, status: { kind: 'none' }, tab: null }).kind
    ).toBe('tab-none')
    expect(
      tabTipAvailability({ ...base, status: { kind: 'closed' } }).kind
    ).toBe('tab-none')
    expect(
      tabTipAvailability({
        ...base,
        status: {
          kind: 'closing',
          unlockLedger: 1,
          ready: false,
          unlocksAround: null,
          unlocksAt: null,
        },
      }).kind
    ).toBe('tab-closing')
    expect(
      tabTipAvailability({ ...base, device: { kind: 'gone', keyId: 1 } })
    ).toEqual({
      kind: 'key',
      device: { kind: 'gone', keyId: 1 },
    })
    expect(tabTipAvailability({ ...base, device: undefined }).kind).toBe(
      'loading'
    )
    expect(
      tabTipAvailability({ ...base, status: { kind: 'loading' } }).kind
    ).toBe('loading')
    expect(
      tabTipAvailability({
        ...base,
        access: { gate: { kind: 'checking' }, address: null },
      }).kind
    ).toBe('loading')
  })
})
