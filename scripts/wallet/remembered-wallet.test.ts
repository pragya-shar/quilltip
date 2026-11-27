import { describe, expect, test } from 'vitest'
import {
  WALLET_KIT_STORAGE_KEYS,
  forgetAllRememberedWallets,
  forgetRememberedWallet,
  readRememberedWallet,
  rememberWallet,
  rememberedWalletKey,
} from '../../lib/wallet/remembered-wallet'
import { WALLET_CATALOG } from '../../lib/stellar/wallet-catalog'

const ADDRESS = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const USER = 'j57abc123def456'
const KEY = `quilltip:wallet:v1:${USER}`

function memory(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    storage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size
      },
    },
  }
}

describe('the remembered wallet (#562)', () => {
  test('stores the wallet ID and the public address under the reader’s key, nothing else', () => {
    const mem = memory()
    rememberWallet(mem.storage, USER, { walletId: 'varial', address: ADDRESS })
    expect([...mem.store.entries()]).toEqual([
      [KEY, JSON.stringify({ walletId: 'varial', address: ADDRESS })],
    ])
    expect(readRememberedWallet(mem.storage, USER)).toEqual({
      walletId: 'varial',
      address: ADDRESS,
    })
    expect(readRememberedWallet(mem.storage, 'another-reader')).toBeNull()
  })

  test('no reader, or an ID that cannot be one: nothing stored or read', () => {
    const mem = memory()
    for (const userId of [null, undefined, '', '../x', 'a b']) {
      rememberWallet(mem.storage, userId, {
        walletId: 'varial',
        address: ADDRESS,
      })
      expect(readRememberedWallet(mem.storage, userId)).toBeNull()
      expect(rememberedWalletKey(userId)).toBeNull()
    }
    expect(mem.store.size).toBe(0)
  })

  test('refuses to store a value that is not a wallet ID and an account ID', () => {
    const mem = memory()
    rememberWallet(mem.storage, USER, {
      walletId: 'varial',
      address: 'SSECRET',
    })
    rememberWallet(mem.storage, USER, { walletId: '<img>', address: ADDRESS })
    expect(mem.store.size).toBe(0)
  })

  for (const [name, raw] of [
    ['not JSON', '{'],
    ['null', 'null'],
    ['a string', '"varial"'],
    ['a list', JSON.stringify(['varial', ADDRESS])],
    ['a missing address', JSON.stringify({ walletId: 'varial' })],
    [
      'an extra field',
      JSON.stringify({ walletId: 'varial', address: ADDRESS, secret: 'x' }),
    ],
    [
      'an extra field after the wallet ID',
      JSON.stringify({ walletId: 'varial', address: ADDRESS, zz: 'x' }),
    ],
    [
      'a secret key',
      JSON.stringify({ walletId: 'varial', address: 'S' + ADDRESS.slice(1) }),
    ],
    [
      'a lowercase address',
      JSON.stringify({ walletId: 'varial', address: ADDRESS.toLowerCase() }),
    ],
    [
      'a wallet ID with markup',
      JSON.stringify({ walletId: '<x>', address: ADDRESS }),
    ],
    [
      'a number for the wallet ID',
      JSON.stringify({ walletId: 1, address: ADDRESS }),
    ],
  ] as const) {
    test(`a malformed record (${name}) reads as none and is removed`, () => {
      const mem = memory({ [KEY]: raw })
      expect(readRememberedWallet(mem.storage, USER)).toBeNull()
      expect(mem.store.has(KEY)).toBe(false)
    })
  }

  test('forgetting a reader removes their record and the kit’s copy, and leaves other readers', () => {
    const mem = memory({
      [KEY]: JSON.stringify({ walletId: 'varial', address: ADDRESS }),
      'quilltip:wallet:v1:other': JSON.stringify({
        walletId: 'varial',
        address: ADDRESS,
      }),
      ...Object.fromEntries(WALLET_KIT_STORAGE_KEYS.map((key) => [key, 'x'])),
      'quilltip:other': 'kept',
    })
    forgetRememberedWallet(mem.storage, USER)
    expect([...mem.store.keys()].sort()).toEqual([
      'quilltip:other',
      'quilltip:wallet:v1:other',
    ])
  })

  test('the sign-in pages forget every reader’s record and the kit’s copy', () => {
    const mem = memory({
      [KEY]: 'x',
      'quilltip:wallet:v1:other': 'x',
      ...Object.fromEntries(WALLET_KIT_STORAGE_KEYS.map((key) => [key, 'x'])),
      'quilltip:other': 'kept',
    })
    forgetAllRememberedWallets(mem.storage)
    expect([...mem.store.keys()]).toEqual(['quilltip:other'])
  })

  test('storage that throws is ignored', () => {
    const fail = () => {
      throw new Error('blocked')
    }
    const broken = {
      getItem: fail,
      setItem: fail,
      removeItem: fail,
      key: fail,
      length: 1,
    }
    expect(readRememberedWallet(broken, USER)).toBeNull()
    expect(() =>
      rememberWallet(broken, USER, { walletId: 'varial', address: ADDRESS })
    ).not.toThrow()
    expect(() => forgetRememberedWallet(broken, USER)).not.toThrow()
    expect(() => forgetAllRememberedWallets(broken)).not.toThrow()
    expect(readRememberedWallet(null, USER)).toBeNull()
  })

  test('only Varial restores on load without a prompt', () => {
    expect(
      WALLET_CATALOG.filter((entry) => entry.silentRestore).map(
        (entry) => entry.id
      )
    ).toEqual(['varial'])
  })
})
