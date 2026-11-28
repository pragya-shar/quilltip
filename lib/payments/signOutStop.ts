/**
 * Before a sign-out ends the session, Quilltip is told to stop accepting
 * tips under this browser's quick-tips keys (no wallet step). The payments
 * engine, which holds the server client and this device's keys, registers
 * the stop while it runs; the sign-out calls it within the shell's short
 * bound and never waits beyond it. The keys themselves are deleted after
 * the sign-out either way (shell/signOut/pocket.ts), so a missed stop
 * leaves nothing usable here. No imports: safe in any first load.
 */
type Stop = () => Promise<void>

let current: Stop | null = null

export const signOutStop = {
  /** The engine's stop; returns the call that removes it. */
  set(stop: Stop): () => void {
    current = stop
    return () => {
      if (current === stop) current = null
    }
  },
  /** Stops this browser's keys in Quilltip, when an engine is running. */
  async run(): Promise<void> {
    await current?.()
  },
}
