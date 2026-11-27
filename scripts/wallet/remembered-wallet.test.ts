import { describe, expect, test } from 'vitest'
import {
  REMEMBERED_WALLET_KEY,
  WALLET_KIT_STORAGE_KEYS,
  forgetRememberedWallet,
  readRememberedWallet,
  rememberWallet,
} from '../../lib/wallet/remembered-wallet'
import { WALLET_CATALOG } from '../../lib/stellar/wallet-catalog'

const ADDRESS = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'

function memory(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    storage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  }
}

describe('the remembered wallet (#562)', () => {
  test('stores the wallet ID and the public address, nothing else', () => {
    const mem = memory()
    rememberWallet(mem.storage, { walletId: 'varial', address: ADDRESS })
    expect([...mem.store.entries()]).toEqual([
      [
        REMEMBERED_WALLET_KEY,
        JSON.stringify({ walletId: 'varial', address: ADDRESS }),
      ],
    ])
    expect(readRememberedWallet(mem.storage)).toEqual({
      walletId: 'varial',
      address: ADDRESS,
    })
  })

  test('refuses to store a value that is not a wallet ID and an account ID', () => {
    const mem = memory()
    rememberWallet(mem.storage, { walletId: 'varial', address: 'SSECRET' })
    rememberWallet(mem.storage, { walletId: '<img>', address: ADDRESS })
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
      const mem = memory({ [REMEMBERED_WALLET_KEY]: raw })
      expect(readRememberedWallet(mem.storage)).toBeNull()
      expect(mem.store.has(REMEMBERED_WALLET_KEY)).toBe(false)
    })
  }

  test('forgetting removes the record and the kit’s copy, and leaves other keys', () => {
    const mem = memory({
      [REMEMBERED_WALLET_KEY]: JSON.stringify({
        walletId: 'varial',
        address: ADDRESS,
      }),
      ...Object.fromEntries(WALLET_KIT_STORAGE_KEYS.map((key) => [key, 'x'])),
      'quilltip:other': 'kept',
    })
    forgetRememberedWallet(mem.storage)
    expect([...mem.store.keys()]).toEqual(['quilltip:other'])
  })

  test('storage that throws is ignored', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readRememberedWallet(broken)).toBeNull()
    expect(() =>
      rememberWallet(broken, { walletId: 'varial', address: ADDRESS })
    ).not.toThrow()
    expect(() => forgetRememberedWallet(broken)).not.toThrow()
    expect(readRememberedWallet(null)).toBeNull()
  })

  test('only Varial and the WalletConnect session restore without a prompt', () => {
    expect(
      WALLET_CATALOG.filter((entry) => entry.silentRestore).map(
        (entry) => entry.id
      )
    ).toEqual(['varial', 'wallet_connect'])
  })
})
