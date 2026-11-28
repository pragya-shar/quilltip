import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createSessionKeyStore } from '@/lib/stellar/v2/tab'
import { deviceKeyView } from '@/lib/tab-ui/key-plan'
import { tipButtonWords } from '@/lib/addMoney/plan'
import { seenKeyIds } from '@/lib/tab-ui/device-memory'
import {
  forgetDeviceKeys,
  noteRetiredKeyIds,
  retiredKeyIds,
} from '@/lib/addMoney/forgetKeys'

const TAB = 'C'.padEnd(56, 'A')
const OTHER_TAB = 'C'.padEnd(56, 'B')
const READER = 'G'.padEnd(56, 'A')
const READER_2 = 'G'.padEnd(56, 'B')

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

describe('sign-out ends quick tips in this browser', () => {
  it("deletes every reader's keys for this site's contract, and only those", async () => {
    const indexedDB = new IDBFactory()
    const store = createSessionKeyStore({ indexedDB, forceFallback: true })
    await store.generate({ tabContractId: TAB, readerAddress: READER })
    await store.generate({ tabContractId: TAB, readerAddress: READER_2 })
    await store.generate({ tabContractId: OTHER_TAB, readerAddress: READER })
    const storage = memoryStorage()
    storage.setItem(`quilltip-tab-seen-keys:${TAB}|${READER}`, '[1]')
    storage.setItem(`quilltip-tab-seen-keys:${OTHER_TAB}|${READER}`, '[2]')
    storage.setItem('unrelated', 'kept')

    await forgetDeviceKeys(TAB, { indexedDB, storage })

    expect(
      await store.list({ tabContractId: TAB, readerAddress: READER })
    ).toEqual([])
    expect(
      await store.list({ tabContractId: TAB, readerAddress: READER_2 })
    ).toEqual([])
    expect(
      await store.list({ tabContractId: OTHER_TAB, readerAddress: READER })
    ).toHaveLength(1)
    expect(
      storage.getItem(`quilltip-tab-seen-keys:${TAB}|${READER}`)
    ).toBeNull()
    expect(
      storage.getItem(`quilltip-tab-seen-keys:${OTHER_TAB}|${READER}`)
    ).toBe('[2]')
    expect(storage.getItem('unrelated')).toBe('kept')
  })

  it('leaves a reader who signs back in with no usable key: the next tip asks for setup', async () => {
    const indexedDB = new IDBFactory()
    const store = createSessionKeyStore({ indexedDB, forceFallback: true })
    const scope = { tabContractId: TAB, readerAddress: READER }
    const key = await store.generate(scope)
    const server = {
      keyId: 7,
      publicKey: key.info.publicKey,
      validUntilLedger: 10_000_000,
      revoked: false,
    }
    await store.bindKeyIds(scope, [server])
    const storage = memoryStorage()
    storage.setItem(`quilltip-tab-seen-keys:${TAB}|${READER}`, '[7]')
    const before = deviceKeyView({
      serverKeys: [server],
      localKeys: (await store.list(scope)).map((k) => k.info),
      currentLedger: 1000,
      seenKeyIds: seenKeyIds(TAB, READER, storage),
    })
    expect(before.kind).toBe('ready')

    await forgetDeviceKeys(TAB, { indexedDB, storage })

    const after = deviceKeyView({
      serverKeys: [server],
      localKeys: (await store.list(scope)).map((k) => k.info),
      currentLedger: 1000,
      seenKeyIds: seenKeyIds(TAB, READER, storage),
    })
    expect(after.kind).toBe('other-device')
    expect(tipButtonWords(after.kind)).toBe('Set up to tip')
  })

  it('runs again harmlessly, and with no IndexedDB at all', async () => {
    const indexedDB = new IDBFactory()
    await forgetDeviceKeys(TAB, { indexedDB, storage: null })
    await forgetDeviceKeys(TAB, { indexedDB, storage: null })
    const broken = {
      open: () => {
        throw new Error('blocked')
      },
    } as unknown as IDBFactory
    await expect(
      forgetDeviceKeys(TAB, { indexedDB: broken, storage: null })
    ).resolves.toBeUndefined()
  })

  it('notes keys replaced by a newer approval, per reader', () => {
    const storage = memoryStorage()
    noteRetiredKeyIds(TAB, READER, [3, 4], storage)
    noteRetiredKeyIds(TAB, READER, [4, 5], storage)
    expect(retiredKeyIds(TAB, READER, storage)).toEqual([3, 4, 5])
    expect(retiredKeyIds(TAB, READER_2, storage)).toEqual([])
  })
})
