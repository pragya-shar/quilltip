import { ConvexError } from 'convex/values'

/**
 * The message a Convex function refused with, for the person who saw the
 * refusal: a `ConvexError`'s string data, or its data's `message`. Null for
 * anything else.
 *
 * Never show `error.message` of a Convex call. The client wraps it: the
 * WebSocket client sends `[CONVEX M(<function>)] <server message>\n  Called
 * by client`, and the HTTP client the server message. A development
 * deployment's server message carries the request id and a stack; a
 * production deployment redacts it to the request id and "Server Error".
 * Only `data` holds the function's own words, in both.
 */
export function convexErrorMessage(error: unknown): string | null {
  if (!(error instanceof ConvexError)) return null
  const data: unknown = error.data
  if (typeof data === 'string') return data.trim() || null
  if (data && typeof data === 'object') {
    const message = (data as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return null
}
