/** Convex may retry for a long time when offline; cap wait so the UI can show an error. */
export const CONVEX_MUTATION_TIMEOUT_MS = 30_000

export async function mutationWithTimeout<T>(
  mutationPromise: Promise<T>,
  options?: { timeoutMs?: number; message?: string }
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? CONVEX_MUTATION_TIMEOUT_MS
  const message =
    options?.message ?? 'Request timed out. Check your connection.'

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
  })

  try {
    return await Promise.race([mutationPromise, timeoutPromise])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    void mutationPromise.catch(() => {})
  }
}
