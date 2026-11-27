/**
 * The time limit on a public server read that gates the first byte (D21).
 * Replace with `lib/seo/publicReadTimeout` when the bounded reads of
 * overhaul v2 (pull request 597) arrive by merge: they apply the same
 * 1.5 s limit inside `lib/seo/publicContent.ts`, and this wrapper then goes.
 */
export const READ_LIMIT_MS = 1500

/** Read next is below the article: it never holds the page for long. */
export const READ_NEXT_LIMIT_MS = 400

export class ReadTimeout extends Error {
  constructor(ms: number) {
    super(`Public read took longer than ${ms} ms`)
  }
}

/**
 * Settles with `read`, or rejects with ReadTimeout after `ms`. Applied
 * outside any cache, so a timeout is never stored; a read that finishes
 * later may still fill the cache for the next request.
 */
export async function withinReadLimit<T>(
  read: Promise<T>,
  ms: number = READ_LIMIT_MS
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
