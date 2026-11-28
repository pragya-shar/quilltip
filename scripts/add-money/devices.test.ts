import { describe, expect, it } from 'vitest'
import { quickTipsRows, thisDevice } from '@/lib/addMoney/devices'
import type { DeviceKey, Reading } from '@/lib/addMoney/services'

const DAY = 17_280
const NOW = Date.UTC(2026, 10, 28, 12)
const clock = { sequence: 100_000, closedAt: NOW }

function key(over: Partial<DeviceKey>): DeviceKey {
  return {
    keyId: 0,
    publicKey: 'aa'.repeat(32),
    validUntilLedger: 100_000 + 7 * DAY,
    revoked: false,
    spendLimit: '500000000',
    acceptedTotal: '0',
    here: false,
    retired: false,
    ...over,
  }
}

function reading(over: Partial<Reading>): Reading {
  return {
    userId: 'u',
    address: 'G'.padEnd(56, 'A'),
    status: 'open',
    confirmed: '100000000',
    available: '100000000',
    priceUsd: 0.1,
    priceAt: NOW,
    accepting: true,
    keys: [],
    device: 'none',
    deviceKeyId: null,
    ledger: clock,
    ...over,
  }
}

describe('quick tips in Balance', () => {
  it('lists this device first, then the others newest first', () => {
    const rows = quickTipsRows(
      reading({
        keys: [
          key({ keyId: 0 }),
          key({ keyId: 1, here: true }),
          key({ keyId: 2 }),
        ],
      }),
      NOW
    )
    expect(rows.map((r) => r.key.keyId)).toEqual([1, 2, 0])
  })

  it('leaves out approvals past their end, and those the wallet already turned off', () => {
    const rows = quickTipsRows(
      reading({
        keys: [
          key({ keyId: 0, validUntilLedger: 100_000 + DAY / 2 }),
          key({ keyId: 1, revoked: true, validUntilLedger: 99_000 }),
          key({ keyId: 2 }),
        ],
      }),
      NOW
    )
    expect(rows.map((r) => r.key.keyId)).toEqual([2])
  })

  it('leaves out an approval this browser replaced with a newer one', () => {
    const rows = quickTipsRows(
      reading({
        keys: [
          key({ keyId: 4, revoked: true, retired: true }),
          key({ keyId: 5, here: true }),
        ],
      }),
      NOW
    )
    expect(rows.map((r) => r.key.keyId)).toEqual([5])
  })

  it('keeps an approval turned off in Quilltip and not yet confirmed by the wallet, marked', () => {
    const rows = quickTipsRows(
      reading({ keys: [key({ keyId: 3, revoked: true })] }),
      NOW
    )
    expect(rows).toEqual([
      { key: expect.objectContaining({ keyId: 3 }), unconfirmed: true },
    ])
  })

  it('reads this device as ready, renewing soon, needing setup, checking or unavailable', () => {
    expect(
      thisDevice(
        reading({ device: 'ready', deviceKeyId: 0, keys: [key({})] }),
        NOW
      )
    ).toMatchObject({ kind: 'ready', renewSoon: false })
    expect(
      thisDevice(
        reading({
          device: 'ready',
          deviceKeyId: 0,
          keys: [key({ validUntilLedger: 100_000 + 2 * DAY })],
        }),
        NOW
      )
    ).toMatchObject({ kind: 'ready', renewSoon: true })
    expect(thisDevice(reading({ device: 'expired' }), NOW)).toEqual({
      kind: 'needs-setup',
      verb: 'renew',
    })
    expect(thisDevice(reading({ device: 'unchecked' }), NOW)).toEqual({
      kind: 'checking',
    })
    expect(thisDevice(reading({ device: 'storage-unavailable' }), NOW)).toEqual(
      { kind: 'unavailable' }
    )
  })
})
