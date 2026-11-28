/**
 * Before a sign-out ends the session, Quilltip is told to stop accepting
 * tips under this browser's quick-tips keys (no wallet step). The payments
 * engine, which holds the server client and this device's keys, registers
 * the stop while it runs; the sign-out calls it within the shell's short
 * bound and never waits beyond it. The keys themselves are deleted after
 * the sign-out either way (shell/signOut/pocket.ts), so a missed stop
 * leaves nothing usable here.
 *
 * A stop that did not finish is noted per reader ("not confirmed") and
 * tried again at that reader's next sign-in in this browser; Balance says
 * so only while the key is still live then. No imports: safe in any first
 * load.
 */
/** The engine's stop, for the reader signing out. */
type Stop = (userId: string) => Promise<void>

let current: Stop | null = null

const PENDING = 'quilltip-signout-unconfirmed:'

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export const signOutStop = {
  /** The engine's stop; returns the call that removes it. */
  set(stop: Stop): () => void {
    current = stop
    return () => {
      if (current === stop) current = null
    }
  },
  /**
   * Stops this browser's keys in Quilltip for the reader signing out, when
   * an engine is running. With no reader named it does nothing: it never
   * guesses whose keys to stop.
   */
  async run(userId: string | null): Promise<void> {
    if (!userId) return
    await current?.(userId)
  },
}

/** The key ids whose stop before a sign-out was not confirmed. */
export function unconfirmedStops(
  userId: string,
  store: Storage | null = storage()
): number[] {
  try {
    const raw = store?.getItem(PENDING + userId)
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(ids)
      ? ids.filter((id): id is number => Number.isInteger(id))
      : []
  } catch {
    return []
  }
}

/** Notes keys as not confirmed (before asking), or clears them (after). */
export function noteUnconfirmedStops(
  userId: string,
  add: number[],
  remove: number[] = [],
  store: Storage | null = storage()
): void {
  if (!store) return
  try {
    const next = [
      ...new Set([...unconfirmedStops(userId, store), ...add]),
    ].filter((id) => !remove.includes(id))
    if (next.length === 0) store.removeItem(PENDING + userId)
    else store.setItem(PENDING + userId, JSON.stringify(next))
  } catch {
    // A convenience: the keys are deleted from this browser either way.
  }
}

/**
 * Stops `keyIds` for `userId`, noting each as not confirmed first and
 * clearing those the server confirmed. Never throws.
 */
export async function stopKeys(
  userId: string,
  keyIds: number[],
  stop: (keyId: number) => Promise<unknown>,
  store: Storage | null = storage()
): Promise<void> {
  if (keyIds.length === 0) return
  noteUnconfirmedStops(userId, keyIds, [], store)
  const done = await Promise.all(
    keyIds.map((keyId) =>
      stop(keyId).then(
        () => keyId,
        () => null
      )
    )
  )
  noteUnconfirmedStops(
    userId,
    [],
    done.filter((id): id is number => id !== null),
    store
  )
}
