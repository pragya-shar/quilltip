/**
 * The longest Today's server read may take (D21): the page waits for it
 * before its first byte, so after this it renders the unreachable state.
 *
 * Replace with `PUBLIC_READ_TIMEOUT_MS` from `lib/seo/publicReadTimeout.ts`
 * when that file arrives by merge from overhaul/v2 (pull request 597): same
 * value, same semantics (a late read is unreachable, applied outside the
 * cache, never stored). Then delete this file and import that one in
 * `data.ts`.
 */
export const TODAY_READ_TIMEOUT_MS = 1500

export class ReadTimeout extends Error {
  constructor(ms: number) {
    super(`Today's read took longer than ${ms} ms`)
  }
}

/**
 * Settles with `read`, or rejects with ReadTimeout after `ms`. A read that
 * finishes later still fills the cache for the next request.
 */
export async function withinLimit<T>(
  read: Promise<T>,
  ms: number = TODAY_READ_TIMEOUT_MS
): Promise<T> {
  // A read that loses the race may still reject; nobody waits for it.
  read.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ReadTimeout(ms)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
