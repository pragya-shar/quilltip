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

/** The backend could not be reached, or answered with a server error. */
export class BackendUnavailable extends Error {
  constructor(detail: string) {
    super(`Backend unavailable: ${detail}`)
    this.name = 'BackendUnavailable'
  }
}

/** Convex's status for a function that threw (convex/browser http_client). */
const FUNCTION_FAILED_STATUS = 560

/**
 * Whether a failed read says the backend is down (#609): a timeout, a
 * network failure or a 5xx. Anything else (a function that threw, a 4xx such
 * as a function this backend does not have yet) means the backend is
 * reachable but answered wrongly: no outage, the page renders and reads for
 * itself.
 */
export function countsAsOutage(error: unknown): boolean {
  return error instanceof ReadTimeout || error instanceof BackendUnavailable
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
  let status: number | undefined
  const client = new ConvexHttpClient(url, {
    // Local and fixture backends run on 127.0.0.1.
    skipConvexDeploymentUrlCheck: true,
    logger: false,
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, signal })
      status = response.status
      return response
    },
  })
  try {
    return await client.query(query, ...args)
  } catch (error) {
    if (signal.aborted) throw new ReadTimeout(limitMs)
    if (status === undefined) throw new BackendUnavailable('no response')
    if (status >= 500 && status !== FUNCTION_FAILED_STATUS)
      throw new BackendUnavailable(`status ${status}`)
    throw error
  }
}
