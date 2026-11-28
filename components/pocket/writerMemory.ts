/**
 * Whether this person writes, as the money layer last said, kept through a
 * reload of the figures or an outage, so a writer never sees a reader's
 * sheet while earnings load or fail. Forgotten on sign-out and when the
 * signed-in account changes. No imports: the sign-out cleanup loads it alone.
 */
let last: { owner: string | null; writer: boolean } | null = null

export const writerMemory = {
  /** The last answer, for this account only. */
  get(owner: string | null): boolean | null {
    return last && last.owner === owner ? last.writer : null
  },
  set(owner: string | null, writer: boolean) {
    last = { owner, writer }
  },
  forget() {
    last = null
  },
}
