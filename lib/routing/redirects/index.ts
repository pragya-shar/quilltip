/**
 * Every legacy path that ends in a redirect (rebuild plan 5.3), read by
 * proxy.ts. Each package owns one file here and edits only that file; this
 * index lists the files once. Rules (tested in
 * scripts/rebuild/redirects.test.ts): `from` is an exact path and appears
 * once; a fixed `to` is a path on this site; no redirect leads to another.
 */
import type { Redirect } from './types'
import { redirects as ops } from './ops'
import { redirects as pocket } from './pocket'
import { redirects as read } from './read'
import { redirects as resources } from './resources'
import { redirects as search } from './search'
import { redirects as shelf } from './shelf'
import { redirects as signin } from './signin'
import { redirects as today } from './today'
import { redirects as write } from './write'
import { redirects as writer } from './writer'
import { redirects as you } from './you'

export type { Redirect } from './types'

export const REDIRECT_PACKAGES = {
  ops,
  pocket,
  read,
  resources,
  search,
  shelf,
  signin,
  today,
  write,
  writer,
  you,
} satisfies Record<string, readonly Redirect[]>

export const REDIRECTS: readonly Redirect[] =
  Object.values(REDIRECT_PACKAGES).flat()

/** A lookup over a table: the destination for a request, or null. */
export function makeRedirector(table: readonly Redirect[]) {
  const byPath = new Map(table.map((r) => [r.from, r]))
  return (url: URL): URL | null => {
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const redirect = byPath.get(path)
    if (!redirect) return null
    const to =
      typeof redirect.to === 'function' ? redirect.to(url) : redirect.to
    if (to === null) return null
    const target = new URL(to, url)
    if (target.origin !== url.origin) return null
    if (typeof redirect.to === 'string' && redirect.keepQuery)
      url.searchParams.forEach((value, key) => {
        if (!target.searchParams.has(key))
          target.searchParams.append(key, value)
      })
    return target
  }
}

/** The destination for a request, or null when the path is not redirected. */
export const redirectFor = makeRedirector(REDIRECTS)
