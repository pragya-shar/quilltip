import { useQueries } from 'convex/react'
import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from 'convex/server'
import type { Value } from 'convex/values'
import { useEffect, useMemo, useRef } from 'react'
import { isPausedDeploymentMessage } from '@/lib/convex/pausedDeployment'

/**
 * What a reading query shows for one result (#609). A paused deployment
 * answers every live subscription with an error; a reader in the middle of
 * an article keeps what they had (the last live value, or `undefined`, so the
 * page keeps its server copy) and the content updates again once the
 * deployment resumes. Any other error still throws, as `useQuery` does.
 */
export function keepThroughPause<T>(
  result: T | undefined | Error,
  last: T | undefined
): T | undefined {
  if (result instanceof Error) {
    if (isPausedDeploymentMessage(result.message)) return last
    throw result
  }
  return result
}

/**
 * `useQuery` for public reading: the same result, except that a paused
 * deployment keeps the last value for the same query and arguments instead
 * of throwing into the page's error boundary.
 */
export function useReadingQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  args: FunctionArgs<Query> | 'skip'
): FunctionReturnType<Query> | undefined {
  const key =
    args === 'skip' ? null : `${getFunctionName(query)}:${JSON.stringify(args)}`
  type Request = Parameters<typeof useQueries>[0]
  const queries = useMemo((): Request => {
    if (args === 'skip') return {}
    return { result: { query, args: args as Record<string, Value> } }
    // The key holds the function and its arguments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const results = useQueries(queries)
  const last = useRef<{ key: string; value: FunctionReturnType<Query> } | null>(
    null
  )
  const previous = last.current?.key === key ? last.current.value : undefined
  const value =
    key === null
      ? undefined
      : keepThroughPause<FunctionReturnType<Query>>(results.result, previous)
  useEffect(() => {
    if (key !== null && value !== undefined) last.current = { key, value }
  }, [key, value])
  return value
}
