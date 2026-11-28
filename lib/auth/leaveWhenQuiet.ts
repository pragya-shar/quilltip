/**
 * Leaving the sign-in page after a successful sign-in, without the
 * browser's "Leave page?".
 *
 * Code on the page may warn before it unloads while something of its own
 * is on its way: the backend client while one of its requests is pending,
 * and the auth library while it refreshes the session token, which it
 * starts the moment the backend confirms a sign-in. The sign-in page
 * therefore asks the page itself whether leaving now would warn: it
 * dispatches a `beforeunload` that can be cancelled and looks whether any
 * listener cancelled it. It asks again every PROBE_EVERY_MS until nothing
 * objects, at most QUIET_WAIT_MS, then navigates. No warning is ever
 * silenced; past the limit the navigation goes anyway, and on a very slow
 * connection the browser may then still ask.
 */
export const QUIET_WAIT_MS = 2_000
export const PROBE_EVERY_MS = 25

/**
 * Set on every probe, so a listener can tell a probe from a real unload.
 * A probe is a real event to every `beforeunload` listener on the page, up
 * to QUIET_WAIT_MS / PROBE_EVERY_MS times: a listener with side effects (a
 * save, a beacon) must not be on a page that uses this, or must return
 * early for an event that has this property. On /signin today the only
 * listeners are the backend client's request guard and the auth library's
 * refresh guard, which only look.
 */
export const UNLOAD_PROBE = 'quilltipUnloadProbe'

/** Whether an unload now would be warned about, by any listener. */
export function wouldWarn(target: EventTarget): boolean {
  const probe = new Event('beforeunload', { cancelable: true })
  Object.defineProperty(probe, UNLOAD_PROBE, { value: true })
  target.dispatchEvent(probe)
  return probe.defaultPrevented
}

export async function leaveWhenQuiet(
  go: () => void,
  limitMs = QUIET_WAIT_MS,
  target: EventTarget | null = typeof window === 'undefined' ? null : window
): Promise<void> {
  const started = Date.now()
  while (target && wouldWarn(target) && Date.now() - started < limitMs)
    await new Promise((resolve) => setTimeout(resolve, PROBE_EVERY_MS))
  go()
}
