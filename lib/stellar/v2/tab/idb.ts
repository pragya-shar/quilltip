/**
 * The one IndexedDB database behind the session keys and the local ledger.
 *
 * Both stores live in one database so an eviction removes both together:
 * a key never survives without its ledger, which would let it sign against a
 * server state the browser cannot check (spec 3.5, item 6).
 *
 * Every read-check-write runs inside one `readwrite` transaction. IndexedDB
 * runs `readwrite` transactions on the same store one at a time across every
 * connection of the origin, so two browser tabs cannot interleave inside one.
 */
import { TabClientError } from './errors'

export const TAB_DB_NAME = 'quilltip-tab'
export const TAB_DB_VERSION = 1
export const KEYS_STORE = 'sessionKeys'
export const LEDGER_STORE = 'ledgers'
/** `sessionKeys` index over `keyRefs` (`"<tab>|<reader>|<keyId>"`). */
export const KEY_REF_INDEX = 'byKeyRef'

export type TabDbOptions = {
  /** Defaults to `globalThis.indexedDB`. Tests pass `fake-indexeddb`. */
  indexedDB?: IDBFactory
  /** Defaults to `TAB_DB_NAME`. */
  dbName?: string
}

const connections = new WeakMap<IDBFactory, Map<string, Promise<IDBDatabase>>>()

function factoryOf(options: TabDbOptions): IDBFactory {
  const factory = options.indexedDB ?? globalThis.indexedDB
  if (!factory)
    throw new TabClientError(
      'STORAGE_UNAVAILABLE',
      'IndexedDB is not available in this browser.'
    )
  return factory
}

function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(KEYS_STORE)) {
    const keys = db.createObjectStore(KEYS_STORE, {
      keyPath: ['tab', 'reader', 'publicKey'],
    })
    keys.createIndex(KEY_REF_INDEX, 'keyRefs', { multiEntry: true })
  }
  if (!db.objectStoreNames.contains(LEDGER_STORE)) {
    db.createObjectStore(LEDGER_STORE, {
      keyPath: ['tab', 'reader', 'keyId', 'writer'],
    })
  }
}

export function openTabDb(options: TabDbOptions = {}): Promise<IDBDatabase> {
  const factory = factoryOf(options)
  const name = options.dbName ?? TAB_DB_NAME
  let byName = connections.get(factory)
  if (!byName) {
    byName = new Map()
    connections.set(factory, byName)
  }
  const cached = byName.get(name)
  if (cached) return cached
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(name, TAB_DB_VERSION)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => upgrade(request.result)
    request.onsuccess = () => {
      const db = request.result
      // A newer version elsewhere, or a deletion, closes this connection;
      // the next call opens a fresh one.
      db.onversionchange = () => {
        db.close()
        byName.delete(name)
      }
      db.onclose = () => byName.delete(name)
      resolve(db)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () =>
      reject(new Error('The tab database is open in an older version.'))
  }).catch((error: unknown) => {
    byName.delete(name)
    throw new TabClientError(
      'STORAGE_UNAVAILABLE',
      'Could not open the tab database.',
      error
    )
  })
  byName.set(name, opening)
  return opening
}

/** Closes and forgets the cached connection (tests and `deleteTabDb`). */
export async function closeTabDb(options: TabDbOptions = {}): Promise<void> {
  const factory = factoryOf(options)
  const name = options.dbName ?? TAB_DB_NAME
  const cached = connections.get(factory)?.get(name)
  connections.get(factory)?.delete(name)
  if (cached) (await cached.catch(() => null))?.close()
}

/** Wraps one request in a promise. Await it only inside its transaction. */
export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Runs `body` in one transaction and resolves with its result once the
 * transaction commits. `body` may await only requests of this transaction:
 * any other await lets the transaction commit early. A throw aborts it.
 */
export async function inTransaction<T>(
  options: TabDbOptions,
  stores: string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => Promise<T>
): Promise<T> {
  const db = await openTabDb(options)
  let tx: IDBTransaction
  try {
    tx = db.transaction(stores, mode)
  } catch (error) {
    throw new TabClientError(
      'STORAGE_UNAVAILABLE',
      'Could not start a tab database transaction.',
      error
    )
  }
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () =>
      reject(
        new TabClientError(
          'STORAGE_UNAVAILABLE',
          'A tab database transaction was aborted.',
          tx.error
        )
      )
  })
  let result: T
  try {
    result = await body(tx)
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // Already finished.
    }
    await done.catch(() => undefined)
    throw error
  }
  await done
  return result
}
