import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEY_LIFETIME_LEDGERS,
  deviceKeyView,
  keyPlan,
  pendingLocalKey,
} from '../../lib/tab-ui/key-plan'
import { DAY_LEDGERS, type LocalSessionKeyInfo } from '../../lib/stellar/v2/tab'
import { xlm } from '../../lib/tab-ui/amounts'

const LEDGER = 1_000_000
const local = (
  publicKey: string,
  keyIds: number[],
  extra: Partial<LocalSessionKeyInfo> = {}
): LocalSessionKeyInfo => ({
  tabContractId: 'C'.repeat(56),
  readerAddress: 'G'.repeat(56),
  publicKey,
  keyIds,
  extractable: false,
  backend: 'webcrypto',
  createdAt: 1,
  unusable: null,
  ...extra,
})
const server = (
  keyId: number,
  publicKey: string,
  o: { validUntil?: number; revoked?: boolean } = {}
) => ({
  keyId,
  publicKey,
  validUntilLedger: o.validUntil ?? LEDGER + 7 * DAY_LEDGERS,
  revoked: o.revoked ?? false,
})

describe('keyPlan', () => {
  it('uses a 7-day lifetime and min(balance, 50 XLM)', () => {
    expect(keyPlan({ latestLedger: LEDGER, tabBalanceAfter: xlm(10) })).toEqual(
      {
        validUntil: LEDGER + DEFAULT_KEY_LIFETIME_LEDGERS,
        spendLimit: xlm(10),
      }
    )
    expect(
      keyPlan({ latestLedger: LEDGER, tabBalanceAfter: xlm(80) }).spendLimit
    ).toBe(xlm(50))
    expect(
      keyPlan({ latestLedger: LEDGER, tabBalanceAfter: '0' }).spendLimit
    ).toBe(xlm(50))
  })
})

describe('deviceKeyView', () => {
  const base = { currentLedger: LEDGER, seenKeyIds: [] as number[] }
  it('is ready with this browser’s key, and asks to renew within 2 days of the stop', () => {
    expect(
      deviceKeyView({
        ...base,
        serverKeys: [server(3, 'aa')],
        localKeys: [local('aa', [3])],
      })
    ).toEqual({ kind: 'ready', keyId: 3, renewSoon: false })
    expect(
      deviceKeyView({
        ...base,
        serverKeys: [server(3, 'aa', { validUntil: LEDGER + 3 * DAY_LEDGERS })],
        localKeys: [local('aa', [3])],
      })
    ).toEqual({ kind: 'ready', keyId: 3, renewSoon: true })
  })
  it('tells a lost key from a key on another device', () => {
    const input = { ...base, serverKeys: [server(3, 'aa')], localKeys: [] }
    expect(deviceKeyView(input)).toEqual({ kind: 'other-device', keyId: 3 })
    expect(deviceKeyView({ ...input, seenKeyIds: [3] })).toEqual({
      kind: 'gone',
      keyId: 3,
    })
  })
  it('reports pending, none, expired, revoked, stopped and blocked storage', () => {
    expect(
      deviceKeyView({ ...base, serverKeys: [], localKeys: [local('aa', [])] })
    ).toEqual({ kind: 'pending' })
    expect(deviceKeyView({ ...base, serverKeys: [], localKeys: [] })).toEqual({
      kind: 'none',
    })
    expect(
      deviceKeyView({
        ...base,
        serverKeys: [server(1, 'aa', { validUntil: LEDGER + 100 })],
        localKeys: [local('aa', [1])],
      })
    ).toEqual({ kind: 'expired', keyId: 1 })
    expect(
      deviceKeyView({
        ...base,
        serverKeys: [server(1, 'aa', { revoked: true })],
        localKeys: [local('aa', [1])],
      })
    ).toEqual({ kind: 'revoked', keyId: 1 })
    expect(
      deviceKeyView({
        ...base,
        serverKeys: [server(1, 'aa')],
        localKeys: [
          local('aa', [1], { unusable: { reason: 'ledger_mismatch', at: 1 } }),
        ],
      })
    ).toEqual({ kind: 'stopped', keyId: 1 })
    expect(deviceKeyView({ ...base, serverKeys: [], localKeys: null })).toEqual(
      { kind: 'storage-unavailable' }
    )
  })
  it('prefers a ready key over a newer key held elsewhere', () => {
    expect(
      deviceKeyView({
        ...base,
        serverKeys: [server(1, 'aa'), server(2, 'bb')],
        localKeys: [local('aa', [1])],
      }).kind
    ).toBe('ready')
  })
})

describe('pendingLocalKey', () => {
  it('returns the newest unbound, usable key', () => {
    expect(
      pendingLocalKey([
        local('aa', [], { createdAt: 1 }),
        local('bb', [], { createdAt: 2 }),
        local('cc', [1], { createdAt: 3 }),
        local('dd', [], { createdAt: 4, unusable: { reason: 'x', at: 1 } }),
      ])?.publicKey
    ).toBe('bb')
    expect(pendingLocalKey([])).toBeNull()
  })
})
