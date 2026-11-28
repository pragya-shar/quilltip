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

/** Whether an unload now would be warned about, by any listener. */
export function wouldWarn(target: EventTarget): boolean {
  const probe = new Event('beforeunload', { cancelable: true })
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
