import { useEffect, useState } from 'react'

/**
 * Keeps the previously resolved value visible while a new query is in flight.
 *
 * When `current` is `undefined` (e.g. a Convex `useQuery` re-fetching after
 * args change) but a prior value exists, this returns the prior value and
 * sets `isPaginating` so callers can dim/pulse the stale content. Once
 * `current` resolves to a defined value, `isPaginating` flips back to false.
 */
export function usePaginationTransition<T>(current: T | undefined): {
  data: T | undefined
  isPaginating: boolean
} {
  const [previous, setPrevious] = useState<T | undefined>(current)

  useEffect(() => {
    if (current !== undefined) setPrevious(current)
  }, [current])

  return {
    data: current ?? previous,
    isPaginating: current === undefined && previous !== undefined,
  }
}
