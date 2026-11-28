/**
 * Ends quick tips in this browser: deletes the device keys (and their local
 * ledgers) for this site's Tab contract from IndexedDB, and the notes kept
 * beside them. A key with no key material cannot sign a tip.
 *
 * Signing out runs it. The sign-out cleanups run after the session token is
 * gone, when the reader's address may no longer be known, so it deletes the
 * keys of every reader of this contract in this browser: any key left here
 * belongs to a reader who is signed out, which is what the rule ends.
 *
 * The approval itself still exists on Stellar testnet until its end, with
 * what is left of its limit; nobody can use it without the key, and Quilltip
 * stops accepting it when the server is told (best effort, before sign-out).
 */
import {
  KEYS_STORE,
  LEDGER_STORE,
  inTransaction,
  request,
  type TabDbOptions,
} from '@/lib/stellar/v2/tab/idb'

/** The highest string a key path compares with ('￿'). */
const TOP = '￿'

/** The localStorage notes kept per reader beside the keys. */
const NOTE_PREFIXES = ['quilltip-tab-seen-keys:', 'quilltip-tab-retired-keys:']

export async function forgetDeviceKeys(
  tabContractId: string,
  options: TabDbOptions & { storage?: Storage | null } = {}
): Promise<void> {
  try {
    await inTransaction(
      options,
      [KEYS_STORE, LEDGER_STORE],
      'readwrite',
      async (tx) => {
        await request(
          tx
            .objectStore(KEYS_STORE)
            .delete(
              IDBKeyRange.bound(
                [tabContractId, '', ''],
                [tabContractId, TOP, TOP]
              )
            )
        )
        // `[]` sorts after every string and number.
        await request(
          tx
            .objectStore(LEDGER_STORE)
            .delete(IDBKeyRange.bound([tabContractId, ''], [tabContractId, []]))
        )
      }
    )
  } catch {
    // No IndexedDB here (some private windows): no key was kept either.
  }
  const storage =
    options.storage === undefined ? safeLocalStorage() : options.storage
  if (!storage) return
  try {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (
        key &&
        NOTE_PREFIXES.some((p) => key.startsWith(`${p}${tabContractId}|`))
      )
        keys.push(key)
    }
    keys.forEach((key) => storage.removeItem(key))
  } catch {
    // A blocked store holds no notes.
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const retiredKey = (tab: string, reader: string) =>
  `quilltip-tab-retired-keys:${tab}|${reader}`

/**
 * The key ids this browser replaced with a newer approval: off in Quilltip,
 * key material deleted, and so never offered for a wallet step in Balance.
 */
export function retiredKeyIds(
  tab: string,
  reader: string,
  storage: Storage | null = safeLocalStorage()
): number[] {
  try {
    const raw = storage?.getItem(retiredKey(tab, reader))
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(ids)
      ? ids.filter((id): id is number => Number.isInteger(id))
      : []
  } catch {
    return []
  }
}

export function noteRetiredKeyIds(
  tab: string,
  reader: string,
  ids: number[],
  storage: Storage | null = safeLocalStorage()
): void {
  if (!storage || ids.length === 0) return
  try {
    const all = [...new Set([...retiredKeyIds(tab, reader, storage), ...ids])]
    storage.setItem(retiredKey(tab, reader), JSON.stringify(all.slice(-200)))
  } catch {
    // A convenience only.
  }
}
