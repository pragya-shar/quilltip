/**
 * The arrival after a first publish (`?live=1`), as the article view reads
 * it. The Write package sets one token in the author's own tab and opens
 * the article with `?live=1`. The view removes the parameter for every
 * visitor and consumes the token, so neither survives a reload, a shared
 * link or history; the arrival runs only when the token names this
 * article, is under a minute old, and the viewer is its author (the tip
 * bar knows: `own-article`). The parameter alone does nothing, and nothing
 * the server sends depends on it.
 */
export const LIVE_PARAM = 'live'
export const JUST_PUBLISHED_KEY = 'quilltip:just-published:v1'
export const JUST_PUBLISHED_MAX_AGE_MS = 60_000

export type LiveArrivalCheck = {
  /** The query without the parameter, when it was there; else null. */
  search: string | null
  /** Whether to consume the token now. */
  consume: boolean
  /** Whether the arrival may run, once the viewer is the author. */
  armed: boolean
}

function tokenFor(token: string | null, articleId: string, now: number) {
  if (!token) return false
  try {
    const value: unknown = JSON.parse(token)
    if (typeof value !== 'object' || value === null) return false
    const { articleId: id, at } = value as Record<string, unknown>
    return (
      id === articleId &&
      typeof at === 'number' &&
      now - at >= 0 &&
      now - at <= JUST_PUBLISHED_MAX_AGE_MS
    )
  } catch {
    return false
  }
}

/** What to do with this address and token, for this article. */
export function liveArrivalCheck(input: {
  search: string
  token: string | null
  articleId: string
  now: number
}): LiveArrivalCheck {
  const params = new URLSearchParams(input.search)
  if (!params.has(LIVE_PARAM))
    return { search: null, consume: false, armed: false }
  const asked = params.get(LIVE_PARAM) === '1'
  params.delete(LIVE_PARAM)
  const rest = params.toString()
  return {
    search: rest ? `?${rest}` : '',
    // Any token is spent on the first `?live=1`: one arrival at most.
    consume: input.token !== null,
    armed: asked && tokenFor(input.token, input.articleId, input.now),
  }
}

/**
 * Reads and clears `?live=1` and the token on this page. Returns whether
 * the arrival is armed. Storage may be blocked: then it is not.
 */
export function takeLiveArrival(articleId: string): boolean {
  let token: string | null = null
  try {
    token = sessionStorage.getItem(JUST_PUBLISHED_KEY)
  } catch {
    token = null
  }
  const check = liveArrivalCheck({
    search: location.search,
    token,
    articleId,
    now: Date.now(),
  })
  if (check.search !== null)
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${check.search}${location.hash}`
    )
  if (check.consume)
    try {
      sessionStorage.removeItem(JUST_PUBLISHED_KEY)
    } catch {
      // Nothing to spend when storage is blocked.
    }
  return check.armed
}
