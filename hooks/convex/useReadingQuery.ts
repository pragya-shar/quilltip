import { useQueries } from 'convex/react'
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server'
import type { Value } from 'convex/values'
import { useMemo } from 'react'
import { PAUSED_DEPLOYMENT_SENTENCE } from '@/lib/convex/pausedSentence'

/**
 * What a reading query shows for one result (#609). A paused deployment
 * answers every live subscription with an error; the reading query then
 * shows nothing new (`undefined`), so the page keeps its server copy, and
 * the content updates again once the deployment resumes. Any other error
 * still throws, as `useQuery` does.
 *
 * It keeps no live value of its own: during a pause the page shows its
 * server copy, and a change of arguments can never show another query's
 * value.
 */
export function readThroughPause<T>(result: T | undefined | Error) {
  if (!(result instanceof Error)) return result
  if (result.message.includes(PAUSED_DEPLOYMENT_SENTENCE)) return undefined
  throw result
}

/**
 * `useQuery` for public reading: the same result, except that a paused
 * deployment shows nothing new instead of throwing into the page's error
 * boundary. It is in every reading page's first load, so it stays small.
 */
export function useReadingQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  args: FunctionArgs<Query> | 'skip'
): FunctionReturnType<Query> | undefined {
  const key = args === 'skip' ? '' : JSON.stringify(args)
  const queries = useMemo(
    (): Parameters<typeof useQueries>[0] =>
      key ? { r: { query, args: args as Record<string, Value> } } : {},
    // The key holds the arguments; the query is fixed at each call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )
  return readThroughPause<FunctionReturnType<Query>>(useQueries(queries).r)
}
