/**
 * Stand-ins for the `convex/react` hooks the payments runtime uses, over the
 * fixture backend (`backend.ts`). Answers are stable per backend version, as
 * a subscription's are.
 */
import { useCallback, useState, useSyncExternalStore } from 'react'
import { getFunctionName } from 'convex/server'
import * as backend from './backend'

type Ref = Parameters<typeof getFunctionName>[0]

function useBackendVersion() {
  return useSyncExternalStore(backend.subscribe, backend.getVersion, () => 0)
}

export function useConvexAuth() {
  useBackendVersion()
  const s = backend.current()
  return {
    isAuthenticated: !!s.user && !s.authLoading,
    isLoading: s.authLoading,
  }
}

export function useQuery(ref: Ref, args?: Record<string, unknown> | 'skip') {
  useBackendVersion()
  if (args === 'skip') return undefined
  return backend.query(getFunctionName(ref), args ?? {})
}

export function usePaginatedQuery(
  ref: Ref,
  args: Record<string, unknown> | 'skip',
  options: { initialNumItems: number }
) {
  useBackendVersion()
  const [count, setCount] = useState(options.initialNumItems)
  const loadMore = useCallback((n: number) => setCount((c) => c + n), [])
  if (args === 'skip')
    return {
      results: [],
      status: 'LoadingFirstPage',
      isLoading: true,
      loadMore,
    }
  const answer = backend.query(getFunctionName(ref), {
    ...args,
    paginationOpts: { numItems: 1000, cursor: null },
  }) as { page: unknown[] } | undefined
  if (!answer)
    return {
      results: [],
      status: 'LoadingFirstPage',
      isLoading: true,
      loadMore,
    }
  return {
    results: answer.page.slice(0, count),
    status: answer.page.length > count ? 'CanLoadMore' : 'Exhausted',
    isLoading: false,
    loadMore,
  }
}

export function useMutation(ref: Ref) {
  const name = getFunctionName(ref)
  return useCallback(
    (args: Record<string, unknown>) => backend.mutate(name, args),
    [name]
  )
}
