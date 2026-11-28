import { describe, expect, it } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519'

import {
  TabClientError,
  closeTabDb,
  createLocalLedger,
  createSessionKeyStore,
  sessionKeyStatus,
  supportsWebCryptoEd25519,
  tabKeyState,
  type LocalSessionKeyInfo,
  type ServerSessionKey,
} from '../../lib/stellar/v2/tab'
import { bytesToHex } from '../../lib/stellar/v2/tab/bytes'
import { SCOPE, WRITER_G, freshDb } from './helpers'

const message = new TextEncoder().encode('quilltip')

function verifies(signature: Uint8Array, publicKey: Uint8Array): boolean {
  return ed25519.verify(signature, message, publicKey)
}

/** A `Crypto` whose `subtle` lacks Ed25519, like an older engine. */
function cryptoWithoutEd25519(): Crypto {
  const subtle = new Proxy(crypto.subtle, {
    get(target, prop) {
      if (prop === 'generateKey')
        return () =>
          Promise.reject(
            new DOMException('Unrecognized name', 'NotSupportedError')
          )
      const value = Reflect.get(target, prop)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return {
    subtle,
    getRandomValues: crypto.getRandomValues.bind(crypto),
  } as unknown as Crypto
}

describe('generate', () => {
  it('uses a non-extractable WebCrypto key where Ed25519 is supported', async () => {
    expect(await supportsWebCryptoEd25519()).toBe(true)
    const store = createSessionKeyStore(freshDb())
    const key = await store.generate(SCOPE)
    expect(key.info.backend).toBe('webcrypto')
    expect(key.info.extractable).toBe(false)
    expect(key.info.keyIds).toEqual([])
    expect(key.info.publicKey).toBe(bytesToHex(key.publicKey()))
    expect(verifies(await key.sign(message), key.publicKey())).toBe(true)
    expect(JSON.stringify(key)).not.toMatch(/seed|privateKey/)
  })

  it('falls back to @noble/curves, flagged extractable, without WebCrypto Ed25519', async () => {
    const fake = cryptoWithoutEd25519()
    expect(await supportsWebCryptoEd25519(fake)).toBe(false)
    const store = createSessionKeyStore({ ...freshDb(), crypto: fake })
    const key = await store.generate(SCOPE)
    expect(key.info.backend).toBe('noble')
    expect(key.info.extractable).toBe(true)
    expect(verifies(await key.sign(message), key.publicKey())).toBe(true)
  })

  it('falls back when the engine cannot store a CryptoKey in IndexedDB', async () => {
    let calls = 0
    const subtle = new Proxy(crypto.subtle, {
      get(target, prop) {
        if (prop === 'generateKey')
          return async (...args: Parameters<SubtleCrypto['generateKey']>) => {
            calls += 1
            const pair = (await target.generateKey(...args)) as CryptoKeyPair
            // The support probe (call 1) gets a real key. Later keys carry a
            // function, which IndexedDB refuses with DataCloneError, like an
            // engine that cannot clone a CryptoKey.
            if (calls === 1) return pair
            return {
              privateKey: { sign: () => undefined },
              publicKey: pair.publicKey,
            }
          }
        const value = Reflect.get(target, prop)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const fake = {
      subtle,
      getRandomValues: crypto.getRandomValues.bind(crypto),
    } as unknown as Crypto
    const store = createSessionKeyStore({ ...freshDb(), crypto: fake })
    const key = await store.generate(SCOPE)
    expect(calls).toBe(2)
    expect(key.info.backend).toBe('noble')
    expect(key.info.extractable).toBe(true)
    expect((await store.list(SCOPE)).length).toBe(1)
    expect(verifies(await key.sign(message), key.publicKey())).toBe(true)
  })

  it('forceFallback skips WebCrypto', async () => {
    const store = createSessionKeyStore({ ...freshDb(), forceFallback: true })
    const key = await store.generate(SCOPE)
    expect(key.info.backend).toBe('noble')
    expect(key.info.extractable).toBe(true)
  })

  it('refuses a malformed scope', async () => {
    const store = createSessionKeyStore(freshDb())
    await expect(
      store.generate({ tabContractId: 'nope', readerAddress: 'G' })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('reports missing IndexedDB and missing crypto as typed errors', async () => {
    const original = globalThis.indexedDB
    try {
      // @ts-expect-error simulate an engine without IndexedDB
      delete globalThis.indexedDB
      const store = createSessionKeyStore({ dbName: 'none' })
      await expect(store.list(SCOPE)).rejects.toMatchObject({
        code: 'STORAGE_UNAVAILABLE',
      })
    } finally {
      globalThis.indexedDB = original
    }
    const noCrypto = createSessionKeyStore({
      ...freshDb(),
      crypto: {} as Crypto,
    })
    await expect(noCrypto.generate(SCOPE)).rejects.toBeInstanceOf(
      TabClientError
    )
    await expect(noCrypto.generate(SCOPE)).rejects.toMatchObject({
      code: 'CRYPTO_UNAVAILABLE',
    })
  })
})

describe('persistence and binding', () => {
  for (const forceFallback of [false, true]) {
    it(`a ${forceFallback ? 'fallback' : 'WebCrypto'} key survives a reload and still signs`, async () => {
      const db = freshDb()
      const first = createSessionKeyStore({ ...db, forceFallback })
      const key = await first.generate(SCOPE)
      await first.bindKeyIds(SCOPE, [
        { keyId: 4, publicKey: key.info.publicKey },
      ])
      await closeTabDb(db)
      const reloaded = createSessionKeyStore(db)
      const again = await reloaded.get(SCOPE, 4)
      expect(again?.info.publicKey).toBe(key.info.publicKey)
      expect(again?.info.keyIds).toEqual([4])
      expect(verifies(await again!.sign(message), key.publicKey())).toBe(true)
    })
  }

  it('binds pending keys by public key and ignores other keys', async () => {
    const store = createSessionKeyStore(freshDb())
    const a = await store.generate(SCOPE)
    const b = await store.generate(SCOPE)
    expect(await store.get(SCOPE, 0)).toBeNull()
    const bound = await store.bindKeyIds(SCOPE, [
      { keyId: 0, publicKey: a.info.publicKey.toUpperCase() },
      { keyId: 1, publicKey: null },
      { keyId: 2, publicKey: 'ab'.repeat(32) },
    ])
    expect(bound.map((k) => k.info.publicKey)).toEqual([a.info.publicKey])
    expect((await store.get(SCOPE, 0))?.info.publicKey).toBe(a.info.publicKey)
    expect(
      await store.bindKeyIds(SCOPE, [{ keyId: 0, publicKey: a.info.publicKey }])
    ).toEqual([])
    // One public key registered twice gets both ids.
    await store.bindKeyIds(SCOPE, [
      { keyId: 3, publicKey: b.info.publicKey },
      { keyId: 5, publicKey: b.info.publicKey },
    ])
    expect((await store.get(SCOPE, 3))?.info.keyIds).toEqual([3, 5])
    expect((await store.get(SCOPE, 5))?.info.publicKey).toBe(b.info.publicKey)
    expect((await store.list(SCOPE)).length).toBe(2)
    expect(
      await store.list({ ...SCOPE, readerAddress: 'G'.padEnd(56, 'A') })
    ).toEqual([])
    expect(
      (await store.getByPublicKey(SCOPE, b.info.publicKey))?.info.keyIds
    ).toEqual([3, 5])
  })

  it('markUnusable keeps the first reason; forget removes the key and its ledgers', async () => {
    const db = freshDb()
    const store = createSessionKeyStore({ ...db, now: () => 7 })
    const ledger = createLocalLedger(db)
    const key = await store.generate(SCOPE)
    await store.bindKeyIds(SCOPE, [{ keyId: 9, publicKey: key.info.publicKey }])
    await store.markUnusable(SCOPE, key.info.publicKey, 'ledger_mismatch')
    await store.markUnusable(SCOPE, key.info.publicKey, 'other')
    expect((await store.get(SCOPE, 9))?.info.unusable).toEqual({
      reason: 'ledger_mismatch',
      at: 7,
    })
    await ledger.markMismatch(SCOPE, 9, WRITER_G)
    await ledger.markMismatch(SCOPE, 10, WRITER_G)
    await (await store.get(SCOPE, 9))!.forget()
    expect(await store.get(SCOPE, 9)).toBeNull()
    expect(await ledger.read(SCOPE, 9, WRITER_G)).toBeNull()
    expect(await ledger.read(SCOPE, 10, WRITER_G)).not.toBeNull()
    await expect(
      store.markUnusable(SCOPE, key.info.publicKey, 'x')
    ).rejects.toMatchObject({ code: 'KEY_NOT_FOUND' })
    await store.forget(SCOPE, key.info.publicKey) // no-op
  })
})

describe('status', () => {
  const local: LocalSessionKeyInfo = {
    tabContractId: SCOPE.tabContractId,
    readerAddress: SCOPE.readerAddress,
    publicKey: 'aa'.repeat(32),
    keyIds: [2],
    extractable: false,
    backend: 'webcrypto',
    createdAt: 1,
    unusable: null,
  }
  const server: ServerSessionKey = {
    keyId: 2,
    publicKey: 'AA'.repeat(32),
    validUntilLedger: 100_000,
    revoked: false,
  }
  const at = (currentLedger: number) => currentLedger

  it('distinguishes ready, missing, expired, revoked, unusable, pending, none', () => {
    const s = (
      serverKey: ServerSessionKey | null,
      localKey: LocalSessionKeyInfo | null,
      ledger = 1_000
    ) => sessionKeyStatus({ serverKey, localKey, currentLedger: at(ledger) })
    expect(s(server, local)).toBe('ready')
    expect(s(server, null)).toBe('missing')
    expect(s(server, { ...local, publicKey: 'bb'.repeat(32) })).toBe('missing')
    expect(s(server, { ...local, keyIds: [] })).toBe('missing')
    expect(s({ ...server, publicKey: null }, local)).toBe('missing')
    expect(s({ ...server, revoked: true }, local)).toBe('revoked')
    expect(s({ ...server, revoked: true }, null)).toBe('revoked')
    // Convex stops one day (17,280 ledgers) before valid_until.
    expect(s(server, local, 100_000 - 17_281)).toBe('ready')
    expect(s(server, local, 100_000 - 17_280)).toBe('expired')
    expect(s(server, null, 200_000)).toBe('expired')
    expect(
      s(server, { ...local, unusable: { reason: 'ledger_mismatch', at: 1 } })
    ).toBe('unusable')
    expect(s(null, { ...local, keyIds: [] })).toBe('pending')
    expect(s(null, local)).toBe('none')
    expect(s(null, null)).toBe('none')
  })

  it('tabKeyState picks the state the UI shows', () => {
    const state = (
      serverKeys: ServerSessionKey[],
      localKeys: LocalSessionKeyInfo[]
    ) => tabKeyState({ serverKeys, localKeys, currentLedger: 1_000 })
    const old = { ...server, keyId: 1, publicKey: 'cc'.repeat(32) }
    expect(state([old, server], [local])).toEqual({ status: 'ready', keyId: 2 })
    expect(state([old, server], [])).toEqual({ status: 'missing', keyId: 2 })
    expect(
      state(
        [server],
        [{ ...local, unusable: { reason: 'ledger_mismatch', at: 1 } }]
      )
    ).toEqual({ status: 'unusable', keyId: 2 })
    expect(
      state([{ ...server, revoked: true }], [{ ...local, keyIds: [] }])
    ).toEqual({
      status: 'pending',
      keyId: null,
    })
    expect(state([{ ...server, validUntilLedger: 10 }], [local])).toEqual({
      status: 'expired',
      keyId: 2,
    })
    expect(state([], [])).toEqual({ status: 'none', keyId: null })
  })

  it('the store reads the local key for status()', async () => {
    const store = createSessionKeyStore(freshDb())
    const key = await store.generate(SCOPE)
    const serverKey = { ...server, publicKey: key.info.publicKey }
    expect(await store.status(SCOPE, serverKey, 1_000)).toBe('missing')
    await store.bindKeyIds(SCOPE, [serverKey])
    expect(await store.status(SCOPE, serverKey, 1_000)).toBe('ready')
    expect((await store.get(SCOPE, 2))!.status(serverKey, 99_999)).toBe(
      'expired'
    )
  })
})
