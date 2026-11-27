import type { Redirect } from './types'

/**
 * The today package's redirects (rebuild plan 5.3). Owned by that package.
 * The reading room (`/articles`, with any query: `search=`, `q=`, pages,
 * tags) goes to Today; the search surface adds the query redirect when
 * `/search` exists. The writer introduction (`/demo/write`) goes to the
 * editor.
 */
export const redirects: readonly Redirect[] = [
  { from: '/articles', to: '/' },
  { from: '/demo/write', to: '/write' },
]
