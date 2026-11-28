import { legacyReturnPathFrom } from '@/lib/auth/returnPath'
import type { Redirect } from './types'

/**
 * Where an older sign-in link goes: `to`, carrying only a return path that
 * passes the same-site check (as `returnTo`) and nothing else from the
 * query. A reset link's code travels in the fragment, which a browser keeps
 * across a redirect and never sends to a server.
 */
function signInPath(to: string, extra: Record<string, string> = {}) {
  return (url: URL) => {
    const query = new URLSearchParams(extra)
    const back = legacyReturnPathFrom(url.searchParams)
    if (back !== '/') query.set('returnTo', back)
    const text = query.toString()
    return text ? `${to}?${text}` : to
  }
}

/** The signin package's redirects. Owned by that package. */
export const redirects: readonly Redirect[] = [
  { from: '/login', to: signInPath('/signin') },
  { from: '/register', to: signInPath('/signin', { mode: 'create' }) },
  { from: '/forgot-password', to: signInPath('/signin/reset') },
  { from: '/reset-password', to: signInPath('/signin/reset') },
]
