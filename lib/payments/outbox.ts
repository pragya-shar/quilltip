/**
 * The tips this browser has sent and the server has not answered yet, kept
 * in `localStorage` so a reload, a closed tab or a crash in the middle of a
 * send neither loses nor repeats a tip:
 *
 * - An entry is written at the tap, before anything reaches the server, with
 *   the tip's `requestId`. Prepare is idempotent on it, so sending the entry
 *   again after a reload prepares the same tip.
 * - Once signed, the entry keeps the signed `submitTip` argument; a resume
 *   resubmits exactly that, and the server replays the same acceptance.
 * - The entry is removed when the server lists its `requestId` among the
 *   reader's accepted tips (`balance.session.recentRequestIds`), or on a
 *   refusal (nothing was accepted), or once it is older than the prepare's
 *   lifetime without an answer (the prepared tip expired; nothing exists).
 *
 * An entry is never a record of payment: the screens show it as "Sending"
 * and take every figure from the server once it answers.
 */
import type { PassageRef, TipMeta } from './types'

export type SignedSubmit = {
  prepareId: string
  receipt: {
    amount: string
    articleId: string
    clientRef: string
    contentHash: string
    cumulativeAfter: string
    highlightId: string | null
    seq: number
  }
  signature: string
}

export type OutboxEntry = {
  requestId: string
  userId: string
  articleId: string
  passage: PassageRef | null
  amountCents: number
  /** Base units at the cached price, for the optimistic balance. */
  estimate: string
  createdAt: number
  meta: TipMeta
  submit?: SignedSubmit
}

/** Prepared tips expire after 5 minutes on the server; stop just before. */
export const OUTBOX_TTL_MS = 4.5 * 60 * 1000
const KEY = 'quilltip-balance-outbox'

type Store = Pick<Storage, 'getItem' | 'setItem'>

export type Outbox = {
  list(userId: string): OutboxEntry[]
  put(entry: OutboxEntry): void
  update(requestId: string, patch: Partial<OutboxEntry>): void
  remove(requestId: string): void
  subscribe(listener: () => void): () => void
  /** A stable value per change, for `useSyncExternalStore`. */
  version(): number
}

function isEntry(value: unknown): value is OutboxEntry {
  const e = value as OutboxEntry
  return (
    !!e &&
    typeof e.requestId === 'string' &&
    typeof e.userId === 'string' &&
    typeof e.articleId === 'string' &&
    typeof e.amountCents === 'number' &&
    typeof e.createdAt === 'number'
  )
}

function defaultStore(): Store | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * One outbox per page. Storage that is missing or blocked falls back to
 * memory: tips still send, but a reload in the middle cannot resume them.
 */
export function createOutbox(store: Store | null = defaultStore()): Outbox {
  let memory: OutboxEntry[] = []
  let version = 0
  const listeners = new Set<() => void>()

  const read = (): OutboxEntry[] => {
    if (!store) return memory
    try {
      const raw = store.getItem(KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter(isEntry) : []
    } catch {
      return memory
    }
  }
  const write = (entries: OutboxEntry[]) => {
    memory = entries
    try {
      store?.setItem(KEY, JSON.stringify(entries))
    } catch {
      // Quota or a blocked store: memory still holds the entries.
    }
    version++
    for (const listener of listeners) listener()
  }

  if (typeof window !== 'undefined') {
    // Another tab of this site changed the outbox.
    window.addEventListener('storage', (event) => {
      if (event.key !== KEY) return
      version++
      for (const listener of listeners) listener()
    })
  }

  return {
    list: (userId) => read().filter((e) => e.userId === userId),
    put: (entry) =>
      write([...read().filter((e) => e.requestId !== entry.requestId), entry]),
    update: (requestId, patch) =>
      write(
        read().map((e) => (e.requestId === requestId ? { ...e, ...patch } : e))
      ),
    remove: (requestId) =>
      write(read().filter((e) => e.requestId !== requestId)),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    version: () => version,
  }
}
