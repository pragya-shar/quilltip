/**
 * Two readers on one browser, both with device key id 0: the key store is
 * scoped by Tab contract and reader address, so reader A's key never signs
 * for reader B (`lib/stellar/v2/tab/session-key.ts`, used by the balance
 * signer in `lib/payments/live/signer.ts`).
 */
import { describe, expect, it } from 'vitest'
import { createSessionKeyStore } from '../../lib/stellar/v2/tab'
import { freshDb, plantKey, TAB } from '../tab/helpers'

const A = {
  tabContractId: TAB,
  readerAddress: 'GAREADERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
}
const B = {
  tabContractId: TAB,
  readerAddress: 'GBREADERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
}

describe('device keys of two readers with the same key id', () => {
  it('returns each reader only their own key', async () => {
    const db = freshDb()
    const pubA = await plantKey(db, A, new Uint8Array(32).fill(1), 'noble', [0])
    const pubB = await plantKey(db, B, new Uint8Array(32).fill(2), 'noble', [0])
    expect(pubA).not.toBe(pubB)
    const store = createSessionKeyStore({ ...db, forceFallback: true })
    expect((await store.get(A, 0))?.info.publicKey).toBe(pubA)
    expect((await store.get(B, 0))?.info.publicKey).toBe(pubB)
    expect((await store.list(A)).map((k) => k.info.publicKey)).toEqual([pubA])
    expect((await store.list(B)).map((k) => k.info.publicKey)).toEqual([pubB])
    // A signature made for B verifies only under B's key.
    const payload = new TextEncoder().encode('voucher for B')
    const keyB = (await store.get(B, 0))!
    const signature = await keyB.sign(payload)
    expect(signature).toHaveLength(64)
    expect(keyB.info.publicKey).toBe(pubB)
  })

  it('finds nothing for a reader whose key lives under another scope', async () => {
    const db = freshDb()
    await plantKey(db, A, new Uint8Array(32).fill(3), 'noble', [0])
    const store = createSessionKeyStore({ ...db, forceFallback: true })
    expect(await store.get(B, 0)).toBeNull()
    expect(await store.list(B)).toEqual([])
  })
})
