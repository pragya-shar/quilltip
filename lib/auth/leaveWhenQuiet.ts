/**
 * The backend client warns before a page unloads while a request of its own
 * is still on its way (the browser's "Leave page?"). Right after a sign-in
 * that can be the case for a moment, so the sign-in page waits for the
 * client to have nothing in flight, at most QUIET_WAIT_MS, before it sends
 * the reader on: they never meet a "Leave page?" for the page that is
 * taking them back.
 */
export const QUIET_WAIT_MS = 2_000

type Client = {
  connectionState(): { hasInflightRequests: boolean }
} | null

export async function leaveWhenQuiet(
  client: Client,
  go: () => void,
  limitMs = QUIET_WAIT_MS
): Promise<void> {
  const started = Date.now()
  while (
    client?.connectionState().hasInflightRequests &&
    Date.now() - started < limitMs
  )
    await new Promise((resolve) => setTimeout(resolve, 25))
  go()
}
