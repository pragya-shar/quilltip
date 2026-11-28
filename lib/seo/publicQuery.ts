import { ConvexHttpClient } from 'convex/browser'
import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from 'convex/server'

/** A public read that ran out of time; its request was aborted (#609). */
export class ReadTimeout extends Error {
  constructor(limitMs: number) {
    super(`Public read took longer than ${limitMs} ms`)
    this.name = 'ReadTimeout'
  }
}

/**
 * Runs one anonymous public query that gives up after `limitMs`. The request
 * itself is aborted at the limit, so a read that loses the time limit does
 * not keep a connection open (`fetchQuery` from `convex/nextjs` takes no
 * signal; `ConvexHttpClient` takes a custom `fetch`, convex 1.48).
 *
 * Used by the proxy's checks and by the public pages' server reads. The
 * client sends no auth token, so it sees only what any reader can see.
 */
export async function publicQuery<Query extends FunctionReference<'query'>>(
  limitMs: number,
  query: Query,
  ...args: OptionalRestArgs<Query>
): Promise<FunctionReturnType<Query>> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) throw new Error('NEXT_PUBLIC_CONVEX_URL is not set')
  const signal = AbortSignal.timeout(Math.max(1, Math.round(limitMs)))
  const client = new ConvexHttpClient(url, {
    // Local and fixture backends run on 127.0.0.1.
    skipConvexDeploymentUrlCheck: true,
    logger: false,
    fetch: (input, init) => fetch(input, { ...init, signal }),
  })
  try {
    return await client.query(query, ...args)
  } catch (error) {
    if (signal.aborted) throw new ReadTimeout(limitMs)
    throw error
  }
}
