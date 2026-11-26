/**
 * Small per-browser notes the tab screens keep outside the key store:
 *
 * - The key ids this browser has bound. A key that Convex lists as active and
 *   this browser no longer holds is "gone" when its id is here (the key store
 *   was cleared or evicted) and "on another device" otherwise.
 * - The tab operation in flight, so a reload in the middle resumes it
 *   instead of offering to start again.
 *
 * Neither note holds key material or anything that confirms a payment: the
 * indexed tab state decides that. Storage can be missing or blocked; every
 * access is guarded and a failure reads as "nothing noted".
 */

export type NoteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function safeStorage(kind: 'local' | 'session'): NoteStorage | null {
  try {
    const storage =
      kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage
    return storage ?? null
  } catch {
    return null
  }
}

function read<T>(storage: NoteStorage | null, key: string): T | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(storage: NoteStorage | null, key: string, value: unknown) {
  if (!storage) return
  try {
    if (value === null) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or a blocked store: the note is a convenience only.
  }
}

const seenKey = (tab: string, reader: string) =>
  `quilltip-tab-seen-keys:${tab}|${reader}`

export function seenKeyIds(
  tab: string,
  reader: string,
  storage: NoteStorage | null = safeStorage('local')
): number[] {
  const ids = read<unknown>(storage, seenKey(tab, reader))
  return Array.isArray(ids)
    ? ids.filter((id): id is number => Number.isInteger(id))
    : []
}

export function noteSeenKeyIds(
  tab: string,
  reader: string,
  keyIds: readonly number[],
  storage: NoteStorage | null = safeStorage('local')
): void {
  const known = new Set(seenKeyIds(tab, reader, storage))
  const before = known.size
  for (const id of keyIds) known.add(id)
  if (known.size !== before) {
    write(
      storage,
      seenKey(tab, reader),
      [...known].sort((a, b) => a - b).slice(-64)
    )
  }
}

/** A wallet-signed tab operation that was started in this browser tab. */
export type PendingOperation = {
  flow:
    | 'tab-open'
    | 'tab-top-up'
    | 'tab-new-key'
    | 'tab-revoke-key'
    | 'tab-close'
    | 'tab-withdraw'
    | 'collect'
  reader: string
  /** What confirms it: a balance before, a key's public key or id. */
  before?: string
  publicKey?: string
  keyId?: number
  amount?: string
  /** Set once `sendTransaction` accepted it. */
  hash?: string
  /** Unix seconds; the transaction's upper time bound. */
  maxTime: number
  startedAt: number
}

const PENDING_KEY = 'quilltip-tab-pending-operation'

export function readPendingOperation(
  storage: NoteStorage | null = safeStorage('session')
): PendingOperation | null {
  const value = read<PendingOperation>(storage, PENDING_KEY)
  return value &&
    typeof value.flow === 'string' &&
    typeof value.maxTime === 'number'
    ? value
    : null
}

export function writePendingOperation(
  value: PendingOperation | null,
  storage: NoteStorage | null = safeStorage('session')
): void {
  write(storage, PENDING_KEY, value)
}
