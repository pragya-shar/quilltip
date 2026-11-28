/**
 * Bounded server reads for public pages. A public page waits for its
 * reads before the first byte, so a slow or silent backend must not hold it:
 * after the limit the read counts as unreachable and the page shows
 * `ReadingUnavailable` (@/system/components/ReadingUnavailable), which
 * reads with no script.
 *
 * When overhaul v2's bounded reads (pull request 597) arrive by merge, set
 * `READ_LIMIT_MS` from `PUBLIC_READ_TIMEOUT_MS` in lib/seo/publicReadTimeout
 * (the same 1.5 s); the rest stays.
 */
export const READ_LIMIT_MS = 1500

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

/** The page's path and query, for "Try again". */
export function retryHrefFor(
  path: string,
  searchParams: Record<string, string | string[] | undefined>
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams))
    for (const item of Array.isArray(value) ? value : [value])
      if (item !== undefined) query.append(key, item)
  const search = query.toString()
  return search ? `${path}?${search}` : path
}
