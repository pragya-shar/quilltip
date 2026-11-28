/**
 * The time a save writes as a draft's `updatedAt`: after `previous`, even in
 * the same millisecond or with a clock behind the stored value, so every save
 * gives the client a new base and a stale base can never match again.
 */
export function nextUpdatedAt(previous: number): number {
  const now = Date.now()
  return now > previous ? now : previous + 1
}
