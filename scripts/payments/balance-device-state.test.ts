import { describe, expect, it } from 'vitest'
import { deviceReading } from '@/lib/payments/live/signer'
import { deviceKeyView } from '@/lib/tab-ui/key-plan'
import { balanceViewOf } from '@/lib/payments/views'

const key = {
  keyId: 3,
  publicKey: 'ab'.repeat(32),
  validUntilLedger: 1_000_000,
  revoked: false,
}
const held = [
  {
    tabContractId: 'C'.padEnd(56, 'A'),
    readerAddress: 'G'.padEnd(56, 'A'),
    publicKey: 'ab'.repeat(32),
    keyIds: [3],
    extractable: false,
    backend: 'webcrypto' as const,
    createdAt: 1,
    unusable: null,
  },
]

describe('the device state the balance shows', () => {
  it('waits as checking when the ledger cannot be read, never asks for setup, and signs with no key', () => {
    const view = deviceKeyView({
      serverKeys: [key],
      localKeys: held,
      currentLedger: null,
      seenKeyIds: [3],
    })
    expect(view.kind).toBe('unchecked')
    expect(deviceReading(view)).toEqual({
      state: 'checking',
      keyId: null,
      view: 'unchecked',
    })
  })

  it('turns ready with the same key once a ledger answers', () => {
    const view = deviceKeyView({
      serverKeys: [key],
      localKeys: held,
      currentLedger: 1000,
      seenKeyIds: [3],
    })
    expect(deviceReading(view)).toEqual({
      state: 'ready',
      keyId: 3,
      view: 'ready',
    })
  })

  it('maps the others as before: setup, or a browser that cannot keep a key', () => {
    expect(deviceReading({ kind: 'expired', keyId: 3 }).state).toBe(
      'needs-setup'
    )
    expect(deviceReading({ kind: 'none' }).state).toBe('needs-setup')
    expect(deviceReading({ kind: 'storage-unavailable' }).state).toBe(
      'unavailable'
    )
  })

  it('carries the detail to the view for the tip button’s words, null until read', () => {
    const base = {
      authLoading: false,
      signedIn: true,
      session: undefined,
      outbox: [],
      online: true,
      now: 0,
    }
    expect(
      balanceViewOf({ ...base, device: 'checking', deviceKind: 'unchecked' })
    ).toMatchObject({ device: 'checking', deviceKind: 'unchecked' })
    expect(balanceViewOf({ ...base, device: 'loading' }).deviceKind).toBeNull()
  })
})
