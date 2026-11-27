import type { Redirect } from './types'

/**
 * The today package's redirects (rebuild plan 5.3). Owned by that package.
 * The reading room (`/articles`) goes to Today, or to search when it carried
 * a query; the writer introduction (`/demo/write`) goes to the editor.
 */
export const redirects: readonly Redirect[] = [
  {
    from: '/articles',
    to: (url) => {
      const q = url.searchParams.get('q')?.trim()
      return q ? `/search?q=${encodeURIComponent(q)}` : '/'
    },
  },
  { from: '/demo/write', to: '/write' },
]
